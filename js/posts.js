import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, getPartnerInfo } from "./firebase-config.js";
import { parsePostText, remapRevealedIndices } from "./word-engine.js";
import { refundWordsToPartner } from "./balance.js";

/**
 * Подписка в реальном времени на все посты (твои и партнёра).
 */
export function subscribePosts(onChange) {
  const postsQuery = query(
    collection(db, "posts"),
    orderBy("createdAt", "desc")
  );

  return onSnapshot(
    postsQuery,
    (snapshot) => {
      const posts = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();
        return {
          id: docSnap.id,
          authorId: data.authorId || "",
          title: data.title || "Без названия",
          content: data.content || "",
          wordCount: Number(data.wordCount) || 0,
          revealedIndices: Array.isArray(data.revealedIndices) ? data.revealedIndices : [],
          isFullyRevealed: Boolean(data.isFullyRevealed),
          createdAt: data.createdAt || null,
          updatedAt: data.updatedAt || null
        };
      });
      onChange(posts);
    },
    (err) => console.error("Ошибка подписки на посты:", err)
  );
}

/**
 * Создание нового постика.
 */
export async function createPost(authorId, title, content) {
  const cleanTitle = (title || "").trim();
  if (!cleanTitle) {
    throw new Error("Придумай название для постика.");
  }

  const parsed = parsePostText(content || "");

  const docRef = await addDoc(collection(db, "posts"), {
    authorId,
    title: cleanTitle,
    content: content || "",
    wordCount: parsed.wordCount,
    revealedIndices: [],
    isFullyRevealed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  return {
    id: docRef.id,
    wordCount: parsed.wordCount
  };
}

/**
 * Обновление существующего постика с запуском «умного сдвига».
 * Если автор удалил уже открытые партнёром слова (в ещё не открытом целиком посте),
 * слова автоматически возвращаются на баланс партнёра с уведомлением.
 */
export async function updatePost(postId, authorId, newTitle, newContent) {
  const cleanTitle = (newTitle || "").trim();
  if (!cleanTitle) {
    throw new Error("Название постика не может быть пустым.");
  }

  const safeNewContent = newContent || "";
  const postRef = doc(db, "posts", postId);
  let remapSummary = {
    wordCount: 0,
    refundedCount: 0,
    refundedWords: [],
    wasFullyRevealed: false
  };

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(postRef);
    if (!snap.exists()) {
      throw new Error("Пост не найден.");
    }

    const current = snap.data();
    if (current.authorId !== authorId) {
      throw new Error("Редактировать можно только свои посты.");
    }

    const oldContent = current.content || "";
    const oldRevealed = Array.isArray(current.revealedIndices) ? current.revealedIndices : [];
    const wasFullyRevealed = Boolean(current.isFullyRevealed);

    const parsedNew = parsePostText(safeNewContent);
    const remapped = remapRevealedIndices(oldContent, safeNewContent, oldRevealed);

    tx.update(postRef, {
      title: cleanTitle,
      content: safeNewContent,
      wordCount: parsedNew.wordCount,
      revealedIndices: remapped.newRevealedIndices,
      updatedAt: serverTimestamp()
    });

    remapSummary = {
      wordCount: parsedNew.wordCount,
      refundedCount: remapped.refundedCount,
      refundedWords: remapped.refundedWords,
      wasFullyRevealed
    };
  });

  // Возвращаем слова партнёру, только если пост ещё не был открыт целиком
  if (!remapSummary.wasFullyRevealed && remapSummary.refundedCount > 0) {
    const partner = getPartnerInfo(authorId);
    if (partner) {
      await refundWordsToPartner(
        authorId,
        partner.uid,
        cleanTitle,
        remapSummary.refundedCount
      );
    }
  }

  return remapSummary;
}

/**
 * Переключатель «Открыть пост целиком» (только для автора).
 */
export async function setPostFullyRevealed(postId, isFullyRevealed) {
  const postRef = doc(db, "posts", postId);
  await updateDoc(postRef, {
    isFullyRevealed: Boolean(isFullyRevealed),
    updatedAt: serverTimestamp()
  });
}

/**
 * Удаление своего постика.
 * Если пост ещё не был открыт целиком, потраченные на него слова честно возвращаются партнёру.
 */
export async function deletePost(post, authorId) {
  if (!post || post.authorId !== authorId) {
    throw new Error("Удалять можно только свои посты.");
  }

  const spentWords = !post.isFullyRevealed && Array.isArray(post.revealedIndices)
    ? post.revealedIndices.length
    : 0;

  await deleteDoc(doc(db, "posts", post.id));

  if (spentWords > 0) {
    const partner = getPartnerInfo(authorId);
    if (partner) {
      await refundWordsToPartner(authorId, partner.uid, post.title, spentWords);
    }
  }

  return spentWords;
}

/**
 * Открытие конкретного слова по его номеру (1-based) со списанием 1 слова с баланса.
 */
export async function revealWord(postId, readerUid, requestedIndex) {
  const targetIndex = Math.floor(Number(requestedIndex));
  if (!Number.isInteger(targetIndex) || targetIndex < 1) {
    throw new Error("Введи корректный номер слова.");
  }

  const postRef = doc(db, "posts", postId);
  const userRef = doc(db, "users", readerUid);
  let revealedText = "";

  await runTransaction(db, async (tx) => {
    const [postSnap, userSnap] = await Promise.all([
      tx.get(postRef),
      tx.get(userRef)
    ]);

    if (!postSnap.exists()) {
      throw new Error("Пост не найден.");
    }

    const postData = postSnap.data();
    if (postData.authorId === readerUid) {
      throw new Error("Свои посты ты и так видишь целиком.");
    }
    if (postData.isFullyRevealed) {
      throw new Error("Этот пост уже открыт целиком.");
    }

    const parsed = parsePostText(postData.content || "");
    if (parsed.wordCount === 0) {
      throw new Error("В этом посте пока нет слов.");
    }
    if (targetIndex > parsed.wordCount) {
      throw new Error(`В этом посте сейчас всего ${parsed.wordCount} слов.`);
    }

    const currentRevealed = Array.isArray(postData.revealedIndices)
      ? postData.revealedIndices
      : [];

    if (currentRevealed.includes(targetIndex)) {
      throw new Error(`Слово № ${targetIndex} уже открыто.`);
    }

    const currentBalance = userSnap.exists() ? Number(userSnap.data().balance) || 0 : 0;
    if (currentBalance < 1) {
      throw new Error("На балансе пока нет свободных слов.");
    }

    const nextRevealed = [...currentRevealed, targetIndex].sort((a, b) => a - b);
    revealedText = parsed.words[targetIndex - 1]?.text || "";

    tx.update(userRef, {
      balance: currentBalance - 1,
      updatedAt: serverTimestamp()
    });

    // Важно: правилами безопасности партнёру разрешено менять только поле revealedIndices
    tx.update(postRef, {
      revealedIndices: nextRevealed
    });
  });

  return {
    wordIndex: targetIndex,
    wordText: revealedText
  };
}

/**
 * Открытие одного случайного ещё не открытого слова за 1 единицу баланса.
 */
export async function revealRandomWord(postId, readerUid) {
  const postRef = doc(db, "posts", postId);
  const userRef = doc(db, "users", readerUid);
  let pickedIndex = 0;
  let revealedText = "";

  await runTransaction(db, async (tx) => {
    const [postSnap, userSnap] = await Promise.all([
      tx.get(postRef),
      tx.get(userRef)
    ]);

    if (!postSnap.exists()) {
      throw new Error("Пост не найден.");
    }

    const postData = postSnap.data();
    if (postData.authorId === readerUid) {
      throw new Error("Свои посты ты и так видишь целиком.");
    }
    if (postData.isFullyRevealed) {
      throw new Error("Этот пост уже открыт целиком.");
    }

    const parsed = parsePostText(postData.content || "");
    if (parsed.wordCount === 0) {
      throw new Error("В этом посте пока нет слов.");
    }

    const currentRevealed = Array.isArray(postData.revealedIndices)
      ? postData.revealedIndices
      : [];
    const revealedSet = new Set(currentRevealed);

    const available = [];
    for (let i = 1; i <= parsed.wordCount; i++) {
      if (!revealedSet.has(i)) {
        available.push(i);
      }
    }

    if (available.length === 0) {
      throw new Error("Все слова в этом посте уже открыты.");
    }

    const currentBalance = userSnap.exists() ? Number(userSnap.data().balance) || 0 : 0;
    if (currentBalance < 1) {
      throw new Error("На балансе пока нет свободных слов.");
    }

    pickedIndex = available[Math.floor(Math.random() * available.length)];
    revealedText = parsed.words[pickedIndex - 1]?.text || "";
    const nextRevealed = [...currentRevealed, pickedIndex].sort((a, b) => a - b);

    tx.update(userRef, {
      balance: currentBalance - 1,
      updatedAt: serverTimestamp()
    });

    tx.update(postRef, {
      revealedIndices: nextRevealed
    });
  });

  return {
    wordIndex: pickedIndex,
    wordText: revealedText
  };
}
