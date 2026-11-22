import { parsePostText } from "./word-engine.js";
import { getUserInfo } from "./firebase-config.js";

/**
 * Правильное склонение слова «слово» (1 слово, 2 слова, 5 слов).
 */
export function pluralizeWords(n) {
  const abs = Math.abs(Number(n)) % 100;
  const lastDigit = abs % 10;
  if (abs >= 11 && abs <= 19) return `${n} слов`;
  if (lastDigit === 1) return `${n} слово`;
  if (lastDigit >= 2 && lastDigit <= 4) return `${n} слова`;
  return `${n} слов`;
}

/**
 * Короткое всплывающее уведомление в правом нижнем углу.
 */
export function showToast(message) {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transition = "opacity 0.25s ease";
    setTimeout(() => toast.remove(), 260);
  }, 3400);
}

/**
 * Модальное мини-подтверждение (защита от случайного тапа и удаления).
 * Возвращает Promise<boolean>.
 */
export function showConfirmModal({
  title = "Подтверждение",
  message = "",
  okText = "Подтвердить",
  cancelText = "Отмена",
  danger = false
}) {
  const backdrop = document.getElementById("confirm-modal");
  const titleEl = document.getElementById("confirm-title");
  const messageEl = document.getElementById("confirm-message");
  const okBtn = document.getElementById("confirm-ok-btn");
  const cancelBtn = document.getElementById("confirm-cancel-btn");

  titleEl.textContent = title;
  messageEl.textContent = message;
  okBtn.textContent = okText;
  cancelBtn.textContent = cancelText;

  okBtn.classList.toggle("btn-danger", danger);
  okBtn.classList.toggle("btn-primary", !danger);

  backdrop.classList.remove("hidden");

  return new Promise((resolve) => {
    function cleanup(result) {
      backdrop.classList.add("hidden");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      backdrop.removeEventListener("click", onBackdropClick);
      document.removeEventListener("keydown", onKeyDown);
      resolve(result);
    }

    function onOk() {
      cleanup(true);
    }

    function onCancel() {
      cleanup(false);
    }

    function onBackdropClick(event) {
      if (event.target === backdrop) cleanup(false);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") cleanup(false);
    }

    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    backdrop.addEventListener("click", onBackdropClick);
    document.addEventListener("keydown", onKeyDown);
  });
}

/**
 * Баннер уведомления о возврате слов после правок партнёра.
 */
export function renderRefundBanner(pendingRefunds) {
  const banner = document.getElementById("refund-banner");
  const textEl = document.getElementById("refund-banner-text");

  if (!pendingRefunds || pendingRefunds.length === 0) {
    banner.classList.add("hidden");
    textEl.textContent = "";
    return;
  }

  const totalCount = pendingRefunds.reduce((sum, item) => sum + (Number(item.count) || 0), 0);
  const titles = Array.from(
    new Set(pendingRefunds.map((item) => `«${item.postTitle || "Без названия"}»`))
  );

  textEl.textContent =
    `После правки ${titles.length === 1 ? "поста" : "постов"} ${titles.join(", ")} ` +
    `на твой баланс вернулось +${pluralizeWords(totalCount)}.`;
  banner.classList.remove("hidden");
}

/**
 * Отрисовка переключателя списка постов (чипсы).
 */
export function renderPostChips(container, posts, selectedId, onSelect) {
  container.innerHTML = "";

  for (const post of posts) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "post-chip" + (post.id === selectedId ? " active" : "");

    const titleEl = document.createElement("div");
    titleEl.className = "post-chip-title";
    titleEl.textContent = post.title || "Без названия";

    const metaEl = document.createElement("div");
    metaEl.className = "post-chip-meta";
    const openedCount = Array.isArray(post.revealedIndices) ? post.revealedIndices.length : 0;
    metaEl.textContent = post.isFullyRevealed
      ? `${pluralizeWords(post.wordCount)} · открыт целиком`
      : `${pluralizeWords(post.wordCount)} · открыто ${openedCount}`;

    btn.appendChild(titleEl);
    btn.appendChild(metaEl);
    btn.addEventListener("click", () => onSelect(post.id));
    container.appendChild(btn);
  }
}

/**
 * Отрисовка «текста-призрака» в режиме читателя (посты партнёра).
 */
export function renderReaderCanvas(container, post, voidMode, onHiddenWordClick) {
  container.innerHTML = "";
  container.classList.remove("void-pure", "void-structure");

  const parsed = parsePostText(post.content || "");
  const revealedSet = new Set(post.revealedIndices || []);
  const isFull = Boolean(post.isFullyRevealed);

  if (!isFull) {
    container.classList.add(voidMode === "structure" ? "void-structure" : "void-pure");
  }

  if (parsed.paragraphs.length === 0 || (post.content || "").trim() === "") {
    const emptyNote = document.createElement("p");
    emptyNote.className = "post-meta";
    emptyNote.textContent = "Пост пока пустой.";
    container.appendChild(emptyNote);
    return parsed;
  }

  const fragment = document.createDocumentFragment();

  for (const paragraph of parsed.paragraphs) {
    const p = document.createElement("p");
    p.className = "post-paragraph" + (paragraph.isEmpty ? " empty-paragraph" : "");

    if (paragraph.isEmpty) {
      p.innerHTML = "&nbsp;";
      fragment.appendChild(p);
      continue;
    }

    for (const token of paragraph.tokens) {
      if (token.type === "space") {
        const spaceSpan = document.createElement("span");
        spaceSpan.className = "space-token";
        spaceSpan.textContent = token.text;
        p.appendChild(spaceSpan);
        continue;
      }

      if (token.type === "decor") {
        const decorSpan = document.createElement("span");
        decorSpan.textContent = token.text;
        if (!isFull) {
          decorSpan.style.color = "transparent";
          decorSpan.style.userSelect = "none";
        }
        p.appendChild(decorSpan);
        continue;
      }

      // Токен слова
      const wordSpan = document.createElement("span");
      wordSpan.dataset.wordIndex = String(token.index);
      wordSpan.textContent = token.text;

      const isRevealed = revealedSet.has(token.index);

      if (isFull) {
        wordSpan.className = isRevealed
          ? "word-token revealed-word was-revealed-in-full"
          : "word-token revealed-word";
        if (isRevealed) {
          wordSpan.title = `Открыто ранее (№ ${token.index})`;
        }
      } else if (isRevealed) {
        wordSpan.className = "word-token revealed-word";
        wordSpan.title = `Слово № ${token.index}`;
      } else {
        wordSpan.className = "word-token hidden-word";
        wordSpan.addEventListener("click", () => onHiddenWordClick(token.index));
      }

      p.appendChild(wordSpan);
    }

    fragment.appendChild(p);
  }

  container.appendChild(fragment);
  return parsed;
}

/**
 * Отрисовка «Взгляда автора» — весь текст с яркой подсветкой слов, открытых партнёром.
 */
export function renderAuthorSpyCanvas(container, post) {
  container.innerHTML = "";
  const parsed = parsePostText(post.content || "");
  const revealedSet = new Set(post.revealedIndices || []);

  if ((post.content || "").trim() === "") {
    const emptyNote = document.createElement("p");
    emptyNote.className = "post-meta";
    emptyNote.textContent = "Текст постика пока пуст.";
    container.appendChild(emptyNote);
    return parsed;
  }

  const fragment = document.createDocumentFragment();

  for (const paragraph of parsed.paragraphs) {
    const p = document.createElement("p");
    p.className = "post-paragraph" + (paragraph.isEmpty ? " empty-paragraph" : "");

    if (paragraph.isEmpty) {
      p.innerHTML = "&nbsp;";
      fragment.appendChild(p);
      continue;
    }

    for (const token of paragraph.tokens) {
      if (token.type === "space" || token.type === "decor") {
        p.appendChild(document.createTextNode(token.text));
        continue;
      }

      const wordSpan = document.createElement("span");
      wordSpan.dataset.wordIndex = String(token.index);
      wordSpan.textContent = token.text;

      if (revealedSet.has(token.index)) {
        wordSpan.className = "word-token author-revealed-word";
        wordSpan.title = `Открыто партнёром (№ ${token.index})`;
      } else {
        wordSpan.className = "word-token";
      }

      p.appendChild(wordSpan);
    }

    fragment.appendChild(p);
  }

  container.appendChild(fragment);
  return parsed;
}

/**
 * Плавная прокрутка к слову по его номеру и мягкая вспышка-подсветка.
 */
export function scrollToWord(canvasEl, wordIndex) {
  const target = canvasEl.querySelector(`[data-word-index="${wordIndex}"]`);
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("pulse-highlight");
  // Сбрасываем анимацию, чтобы сработала повторно при повторном клике
  void target.offsetWidth;
  target.classList.add("pulse-highlight");

  setTimeout(() => {
    target.classList.remove("pulse-highlight");
  }, 1900);
}

/**
 * Открытие выдвижного навигатора по всем открытым словам поста.
 */
export function openNavigatorDrawer(post, targetCanvasEl) {
  const overlay = document.getElementById("navigator-overlay");
  const listEl = document.getElementById("navigator-list");
  listEl.innerHTML = "";

  const parsed = parsePostText(post.content || "");
  const revealed = Array.from(new Set(post.revealedIndices || []))
    .map(Number)
    .filter((n) => n >= 1 && n <= parsed.wordCount)
    .sort((a, b) => a - b);

  if (revealed.length === 0) {
    const empty = document.createElement("p");
    empty.className = "post-meta";
    empty.style.padding = "12px";
    empty.textContent = "Пока не открыто ни одного слова.";
    listEl.appendChild(empty);
  } else {
    for (const idx of revealed) {
      const wordObj = parsed.words[idx - 1];
      if (!wordObj) continue;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-word-item";

      const textSpan = document.createElement("span");
      textSpan.className = "nav-word-text";
      textSpan.textContent = wordObj.text;

      const numSpan = document.createElement("span");
      numSpan.className = "nav-word-num";
      numSpan.textContent = `№ ${idx}`;

      btn.appendChild(textSpan);
      btn.appendChild(numSpan);

      btn.addEventListener("click", () => {
        closeNavigatorDrawer();
        scrollToWord(targetCanvasEl, idx);
      });

      listEl.appendChild(btn);
    }
  }

  overlay.classList.remove("hidden");
}

export function closeNavigatorDrawer() {
  const overlay = document.getElementById("navigator-overlay");
  overlay.classList.add("hidden");
}

function formatHistoryDate(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "только что";
  }
  const date = timestamp.toDate();
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

/**
 * Отрисовка ленты истории подарков и возвратов.
 */
export function renderHistory(container, items) {
  container.innerHTML = "";

  if (!items || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "post-meta";
    empty.textContent = "История пока пуста.";
    container.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "history-item";

    const left = document.createElement("div");
    const main = document.createElement("div");
    main.className = "history-main";

    const fromName = getUserInfo(item.fromUid).name;
    const toName = getUserInfo(item.toUid).name;

    if (item.type === "refund") {
      main.textContent = `Возврат для ${toName}: +${pluralizeWords(item.amount)}`;
    } else {
      main.textContent = `${fromName} → ${toName}: +${pluralizeWords(item.amount)}`;
    }

    left.appendChild(main);

    if (item.note) {
      const noteEl = document.createElement("div");
      noteEl.className = "history-note";
      noteEl.textContent = item.note;
      left.appendChild(noteEl);
    }

    const dateEl = document.createElement("div");
    dateEl.className = "history-date";
    dateEl.textContent = formatHistoryDate(item.createdAt);

    row.appendChild(left);
    row.appendChild(dateEl);
    container.appendChild(row);
  }
}
