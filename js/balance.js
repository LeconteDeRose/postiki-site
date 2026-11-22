import {
  doc,
  collection,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  runTransaction,
  query,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, getUserInfo, getPartnerInfo } from "./firebase-config.js";

/**
 * Создаёт стартовые документы обоих профилей в базе, если их ещё нет.
 */
export async function ensureUserProfiles(myUid) {
  const me = getUserInfo(myUid);
  const partner = getPartnerInfo(myUid);
  const profiles = partner ? [me, partner] : [me];

  for (const profile of profiles) {
    const userRef = doc(db, "users", profile.uid);
    const snap = await getDoc(userRef);

    if (!snap.exists()) {
      await setDoc(userRef, {
        name: profile.name,
        balance: 0,
        pendingRefunds: [],
        updatedAt: serverTimestamp()
      });
    }
  }
}

/**
 * Подписка в реальном времени на свой баланс, баланс партнёра и очередь уведомлений о возвратах.
 */
export function subscribeBalances(myUid, partnerUid, onChange) {
  const state = {
    myBalance: 0,
    partnerBalance: 0,
    pendingRefunds: []
  };

  const emit = () => {
    onChange({
      myBalance: state.myBalance,
      partnerBalance: state.partnerBalance,
      pendingRefunds: [...state.pendingRefunds]
    });
  };

  const unsubMe = onSnapshot(
    doc(db, "users", myUid),
    (snap) => {
      const data = snap.exists() ? snap.data() : {};
      state.myBalance = Number(data.balance) || 0;
      state.pendingRefunds = Array.isArray(data.pendingRefunds) ? data.pendingRefunds : [];
      emit();
    },
    (err) => console.error("Ошибка подписки на свой баланс:", err)
  );

  let unsubPartner = () => {};
  if (partnerUid) {
    unsubPartner = onSnapshot(
      doc(db, "users", partnerUid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        state.partnerBalance = Number(data.balance) || 0;
        emit();
      },
      (err) => console.error("Ошибка подписки на баланс партнёра:", err)
    );
  }

  return () => {
    unsubMe();
    unsubPartner();
  };
}

/**
 * Подарить слова партнёру (в одной транзакции с записью в историю).
 */
export async function giftWords(fromUid, toUid, amount, note = "") {
  const cleanAmount = Math.floor(Number(amount));
  if (!Number.isInteger(cleanAmount) || cleanAmount < 1 || cleanAmount > 500) {
    throw new Error("Можно подарить от 1 до 500 слов за раз.");
  }

  const cleanNote = (note || "").trim().slice(0, 160);
  const targetRef = doc(db, "users", toUid);
  const historyRef = doc(collection(db, "history"));
  const targetInfo = getUserInfo(toUid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(targetRef);
    const currentBalance = snap.exists() ? Number(snap.data().balance) || 0 : 0;
    const currentRefunds = snap.exists() && Array.isArray(snap.data().pendingRefunds)
      ? snap.data().pendingRefunds
      : [];

    tx.set(
      targetRef,
      {
        name: targetInfo.name,
        balance: currentBalance + cleanAmount,
        pendingRefunds: currentRefunds,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    tx.set(historyRef, {
      type: "gift",
      fromUid,
      toUid,
      amount: cleanAmount,
      note: cleanNote,
      createdAt: serverTimestamp()
    });
  });
}

/**
 * Автоматический возврат слов партнёру, если автор удалил уже открытые слова при правке.
 */
export async function refundWordsToPartner(authorUid, partnerUid, postTitle, refundedCount) {
  const count = Math.floor(Number(refundedCount));
  if (!partnerUid || count <= 0) return;

  const partnerRef = doc(db, "users", partnerUid);
  const historyRef = doc(collection(db, "history"));
  const partnerInfo = getUserInfo(partnerUid);
  const safeTitle = (postTitle || "Без названия").trim();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(partnerRef);
    const currentBalance = snap.exists() ? Number(snap.data().balance) || 0 : 0;
    const existingRefunds = snap.exists() && Array.isArray(snap.data().pendingRefunds)
      ? snap.data().pendingRefunds
      : [];

    const nextRefunds = [
      ...existingRefunds,
      {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        postTitle: safeTitle,
        count,
        timestamp: Date.now()
      }
    ].slice(-20);

    tx.set(
      partnerRef,
      {
        name: partnerInfo.name,
        balance: currentBalance + count,
        pendingRefunds: nextRefunds,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    tx.set(historyRef, {
      type: "refund",
      fromUid: authorUid,
      toUid: partnerUid,
      amount: count,
      postTitle: safeTitle,
      note: `Возврат после правки поста «${safeTitle}»`,
      createdAt: serverTimestamp()
    });
  });
}

/**
 * Очищает баннер уведомлений о возврате слов после того, как пользователь нажал «Понятно».
 */
export async function acknowledgePendingRefunds(myUid) {
  const myRef = doc(db, "users", myUid);
  await updateDoc(myRef, {
    pendingRefunds: [],
    updatedAt: serverTimestamp()
  });
}

/**
 * Подписка на последние 50 записей истории подарков и возвратов.
 */
export function subscribeHistory(onChange) {
  const historyQuery = query(
    collection(db, "history"),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  return onSnapshot(
    historyQuery,
    (snapshot) => {
      const items = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      onChange(items);
    },
    (err) => console.error("Ошибка подписки на историю:", err)
  );
}
