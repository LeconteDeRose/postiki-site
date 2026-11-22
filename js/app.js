import { getUserInfo, getPartnerInfo } from "./firebase-config.js";
import { initThemeSwitcher, initAuth } from "./auth.js";
import {
  ensureUserProfiles,
  subscribeBalances,
  subscribeHistory,
  giftWords,
  acknowledgePendingRefunds
} from "./balance.js";
import {
  subscribePosts,
  createPost,
  updatePost,
  setPostFullyRevealed,
  deletePost,
  revealWord,
  revealRandomWord
} from "./posts.js";
import { parsePostText, getWordInfoAtCursor } from "./word-engine.js";
import { EditorHistory } from "./editor-history.js";
import {
  pluralizeWords,
  showToast,
  showConfirmModal,
  renderRefundBanner,
  renderPostChips,
  renderReaderCanvas,
  renderAuthorSpyCanvas,
  scrollToWord,
  openNavigatorDrawer,
  closeNavigatorDrawer,
  renderHistory
} from "./ui.js";

const VOID_MODE_KEY = "postiki_void_mode";

// Склонения для имён в интерфейсе
const NAME_FORMS = {
  "Дрюша": { gen: "Дрюши", dat: "Дрюше" },
  "Тёфа": { gen: "Тёфы", dat: "Тёфе" }
};

function getNameForm(name, form) {
  return NAME_FORMS[name]?.[form] || name;
}

const state = {
  user: null,
  me: null,
  partner: null,
  activeTab: "partner",
  voidMode: "pure",
  posts: [],
  myBalance: 0,
  partnerBalance: 0,
  pendingRefunds: [],
  selectedPartnerPostId: null,
  selectedMyPostId: null,
  isCreatingNewPost: false,
  authorSubTab: "edit",
  isEditorDirty: false,
  isRevealing: false,
  pendingScrollWord: null,
  editorParsedText: "",
  editorParsedCache: null,
  unsubscribers: []
};

// Элементы DOM
const el = {
  authScreen: document.getElementById("auth-screen"),
  appScreen: document.getElementById("app-screen"),
  currentUserName: document.getElementById("current-user-name"),
  refundBannerClose: document.getElementById("refund-banner-close"),

  navTabs: document.querySelectorAll(".nav-tab"),
  tabPartnerLabel: document.getElementById("tab-partner-label"),
  views: {
    partner: document.getElementById("view-partner"),
    my: document.getElementById("view-my"),
    gifts: document.getElementById("view-gifts")
  },

  // Вкладка «Посты партнёра»
  partnerBalanceBadge: document.getElementById("partner-balance-badge"),
  partnerPostsList: document.getElementById("partner-posts-list"),
  partnerEmptyState: document.getElementById("partner-empty-state"),
  readerSection: document.getElementById("reader-section"),
  readerTitle: document.getElementById("reader-title"),
  readerStats: document.getElementById("reader-stats"),
  readerFullBadge: document.getElementById("reader-full-badge"),
  readerNavigatorBtn: document.getElementById("reader-navigator-btn"),
  readerNavCount: document.getElementById("reader-nav-count"),
  readerControls: document.getElementById("reader-controls"),
  revealInput: document.getElementById("reveal-input"),
  revealBtn: document.getElementById("reveal-btn"),
  revealRandomBtn: document.getElementById("reveal-random-btn"),
  voidModePureBtn: document.getElementById("void-mode-pure"),
  voidModeStructureBtn: document.getElementById("void-mode-structure"),
  readerCanvas: document.getElementById("reader-canvas"),

  // Вкладка «Мои посты»
  newPostBtn: document.getElementById("new-post-btn"),
  myPostsList: document.getElementById("my-posts-list"),
  myEmptyState: document.getElementById("my-empty-state"),
  authorWorkspace: document.getElementById("author-workspace"),
  authorTabEdit: document.getElementById("author-tab-edit"),
  authorTabSpy: document.getElementById("author-tab-spy"),
  authorFullOpenToggle: document.getElementById("author-full-open-toggle"),
  deletePostBtn: document.getElementById("delete-post-btn"),
  authorEditPane: document.getElementById("author-edit-pane"),
  postTitleInput: document.getElementById("post-title-input"),
  postWordCount: document.getElementById("post-word-count"),
  postCursorWord: document.getElementById("post-cursor-word"),
  editorUndoBtn: document.getElementById("editor-undo-btn"),
  editorRedoBtn: document.getElementById("editor-redo-btn"),
  postContentInput: document.getElementById("post-content-input"),
  savePostBtn: document.getElementById("save-post-btn"),
  closeAuthorWorkspaceBtn: document.getElementById("close-author-workspace-btn"),
  authorSpyPane: document.getElementById("author-spy-pane"),
  spyStats: document.getElementById("spy-stats"),
  authorNavigatorBtn: document.getElementById("author-navigator-btn"),
  authorNavCount: document.getElementById("author-nav-count"),
  authorSpyCanvas: document.getElementById("author-spy-canvas"),

  // Вкладка «Слова и подарки»
  giftsMyBalance: document.getElementById("gifts-my-balance"),
  giftsPartnerLabel: document.getElementById("gifts-partner-label"),
  giftsPartnerBalance: document.getElementById("gifts-partner-balance"),
  giftTargetName: document.getElementById("gift-target-name"),
  giftForm: document.getElementById("gift-form"),
  quickAmountBtns: document.querySelectorAll(".quick-amount-btn"),
  giftAmountInput: document.getElementById("gift-amount-input"),
  giftNoteInput: document.getElementById("gift-note-input"),
  giftSubmitBtn: document.getElementById("gift-submit-btn"),
  historyList: document.getElementById("history-list"),

  // Навигатор
  navigatorOverlay: document.getElementById("navigator-overlay"),
  navigatorCloseBtn: document.getElementById("navigator-close-btn")
};

// История правок редактора (Назад / Вперёд)
const editorHistory = new EditorHistory({
  maxSteps: 120,
  debounceMs: 600,
  onChange: ({ canUndo, canRedo }) => {
    el.editorUndoBtn.disabled = !canUndo;
    el.editorRedoBtn.disabled = !canRedo;
  }
});

/* ==========================================================================
 * ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ СОСТОЯНИЯ И РЕДАКТОРА
 * ========================================================================== */

function getPartnerPosts() {
  if (!state.partner) return [];
  return state.posts.filter((p) => p.authorId === state.partner.uid);
}

function getMyPosts() {
  if (!state.me) return [];
  return state.posts.filter((p) => p.authorId === state.me.uid);
}

function getSelectedPartnerPost() {
  return getPartnerPosts().find((p) => p.id === state.selectedPartnerPostId) || null;
}

function getSelectedMyPost() {
  return getMyPosts().find((p) => p.id === state.selectedMyPostId) || null;
}

function loadSavedVoidMode() {
  try {
    const saved = localStorage.getItem(VOID_MODE_KEY);
    state.voidMode = saved === "structure" ? "structure" : "pure";
  } catch {
    state.voidMode = "pure";
  }
  updateVoidModeButtons();
}

function setVoidMode(mode) {
  state.voidMode = mode === "structure" ? "structure" : "pure";
  try {
    localStorage.setItem(VOID_MODE_KEY, state.voidMode);
  } catch {
    // игнорируем, если хранилище недоступно
  }
  updateVoidModeButtons();
  renderReaderSection();
}

function updateVoidModeButtons() {
  el.voidModePureBtn.classList.toggle("active", state.voidMode === "pure");
  el.voidModeStructureBtn.classList.toggle("active", state.voidMode === "structure");
}

function switchMainTab(tabName) {
  state.activeTab = tabName;
  el.navTabs.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tabName);
  });
  Object.entries(el.views).forEach(([key, section]) => {
    section.classList.toggle("hidden", key !== tabName);
  });
}

/**
 * Кеширует разбор текста редактора, чтобы перемещение курсора работало мгновенно.
 */
function getEditorParsed() {
  const currentText = el.postContentInput.value;
  if (!state.editorParsedCache || state.editorParsedText !== currentText) {
    state.editorParsedText = currentText;
    state.editorParsedCache = parsePostText(currentText);
  }
  return state.editorParsedCache;
}

function updateCursorIndicator(parsedOverride = null) {
  const parsed = parsedOverride || getEditorParsed();
  const cursorPos = el.postContentInput.selectionDirection === "backward"
    ? (el.postContentInput.selectionStart ?? 0)
    : (el.postContentInput.selectionEnd ?? 0);

  const info = getWordInfoAtCursor(el.postContentInput.value, cursorPos, parsed);

  if (info.status === "empty") {
    el.postCursorWord.textContent = "Курсор: —";
    return;
  }

  if (info.status === "on") {
    const preview = info.text.length > 24 ? `${info.text.slice(0, 23)}…` : info.text;
    el.postCursorWord.textContent = `Слово № ${info.index} («${preview}»)`;
    return;
  }

  if (info.status === "before") {
    el.postCursorWord.textContent = "Перед словом № 1";
    return;
  }

  if (info.status === "after") {
    el.postCursorWord.textContent = `После слова № ${info.prevIndex}`;
    return;
  }

  el.postCursorWord.textContent = `Между № ${info.prevIndex} и № ${info.nextIndex}`;
}

function updateEditorMetrics() {
  const parsed = getEditorParsed();
  el.postWordCount.textContent = `Слов: ${parsed.wordCount}`;
  updateCursorIndicator(parsed);
}

function applyHistorySnapshot(snapshot) {
  if (!snapshot) return;

  el.postContentInput.value = snapshot.text;
  state.isEditorDirty = true;
  el.postContentInput.focus();

  const maxPos = snapshot.text.length;
  const start = Math.min(Math.max(0, snapshot.start ?? maxPos), maxPos);
  const end = Math.min(Math.max(0, snapshot.end ?? maxPos), maxPos);
  el.postContentInput.setSelectionRange(start, end);

  updateEditorMetrics();
}

function handleEditorUndo() {
  applyHistorySnapshot(editorHistory.undo());
}

function handleEditorRedo() {
  applyHistorySnapshot(editorHistory.redo());
}

/* ==========================================================================
 * ОТРИСОВКА: ПОСТЫ ПАРТНЁРА (ЧИТАТЕЛЬ)
 * ========================================================================== */

function renderPartnerView() {
  const partnerPosts = getPartnerPosts();

  if (partnerPosts.length === 0) {
    state.selectedPartnerPostId = null;
    el.partnerPostsList.innerHTML = "";
    el.partnerEmptyState.classList.remove("hidden");
    el.readerSection.classList.add("hidden");
    return;
  }

  el.partnerEmptyState.classList.add("hidden");

  if (!partnerPosts.some((p) => p.id === state.selectedPartnerPostId)) {
    state.selectedPartnerPostId = partnerPosts[0].id;
  }

  renderPostChips(
    el.partnerPostsList,
    partnerPosts,
    state.selectedPartnerPostId,
    (postId) => {
      state.selectedPartnerPostId = postId;
      renderPartnerView();
    }
  );

  renderReaderSection();
}

function renderReaderSection() {
  const post = getSelectedPartnerPost();
  if (!post) {
    el.readerSection.classList.add("hidden");
    return;
  }

  el.readerSection.classList.remove("hidden");
  el.readerTitle.textContent = post.title || "Без названия";

  const revealedCount = Array.isArray(post.revealedIndices) ? post.revealedIndices.length : 0;
  el.readerStats.textContent = post.isFullyRevealed
    ? `Всего ${pluralizeWords(post.wordCount)}`
    : `Всего ${pluralizeWords(post.wordCount)} · открыто ${revealedCount}`;

  el.readerFullBadge.classList.toggle("hidden", !post.isFullyRevealed);
  el.readerControls.classList.toggle("hidden", post.isFullyRevealed);
  el.readerNavCount.textContent = String(revealedCount);

  if (post.wordCount > 0) {
    el.revealInput.max = String(post.wordCount);
    el.revealInput.placeholder = `1 – ${post.wordCount}`;
  } else {
    el.revealInput.removeAttribute("max");
    el.revealInput.placeholder = "№ слова";
  }

  renderReaderCanvas(el.readerCanvas, post, state.voidMode, handleHiddenWordTap);

  if (
    state.pendingScrollWord &&
    state.pendingScrollWord.postId === post.id
  ) {
    const idxToScroll = state.pendingScrollWord.wordIndex;
    state.pendingScrollWord = null;
    requestAnimationFrame(() => {
      scrollToWord(el.readerCanvas, idxToScroll);
    });
  }
}

async function handleHiddenWordTap(wordIndex) {
  const post = getSelectedPartnerPost();
  if (!post || post.isFullyRevealed || state.isRevealing) return;

  if (state.myBalance < 1) {
    showToast("На балансе пока нет свободных слов.");
    return;
  }

  const confirmed = await showConfirmModal({
    title: "Открыть слово?",
    message: `Потратить 1 слово с баланса и открыть слово № ${wordIndex}?`,
    okText: "Открыть"
  });

  if (!confirmed) return;
  await executeRevealByNumber(post.id, wordIndex);
}

async function executeRevealByNumber(postId, wordIndex) {
  if (state.isRevealing) return;
  state.isRevealing = true;
  el.revealBtn.disabled = true;
  el.revealRandomBtn.disabled = true;

  try {
    state.pendingScrollWord = { postId, wordIndex };
    const result = await revealWord(postId, state.me.uid, wordIndex);
    el.revealInput.value = "";
    showToast(`Открыто слово № ${result.wordIndex}: «${result.wordText}»`);
  } catch (err) {
    state.pendingScrollWord = null;
    showToast(err.message || "Не удалось открыть слово.");
  } finally {
    state.isRevealing = false;
    el.revealBtn.disabled = false;
    el.revealRandomBtn.disabled = false;
  }
}

async function handleRevealByInput() {
  const post = getSelectedPartnerPost();
  if (!post || post.isFullyRevealed) return;

  const rawVal = el.revealInput.value.trim();
  const num = Number(rawVal);

  if (!rawVal || !Number.isInteger(num) || num < 1) {
    showToast("Введи целое число от 1 и выше.");
    return;
  }

  if (state.myBalance < 1) {
    showToast("На балансе пока нет свободных слов.");
    return;
  }

  await executeRevealByNumber(post.id, num);
}

async function handleRevealRandom() {
  const post = getSelectedPartnerPost();
  if (!post || post.isFullyRevealed || state.isRevealing) return;

  if (state.myBalance < 1) {
    showToast("На балансе пока нет свободных слов.");
    return;
  }

  state.isRevealing = true;
  el.revealBtn.disabled = true;
  el.revealRandomBtn.disabled = true;

  try {
    const result = await revealRandomWord(post.id, state.me.uid);
    state.pendingScrollWord = { postId: post.id, wordIndex: result.wordIndex };
    requestAnimationFrame(() => {
      if (
        state.pendingScrollWord &&
        state.pendingScrollWord.postId === post.id &&
        el.readerCanvas.querySelector(`[data-word-index="${result.wordIndex}"].revealed-word`)
      ) {
        scrollToWord(el.readerCanvas, result.wordIndex);
        state.pendingScrollWord = null;
      }
    });
    showToast(`Случайное слово № ${result.wordIndex}: «${result.wordText}»`);
  } catch (err) {
    state.pendingScrollWord = null;
    showToast(err.message || "Не удалось открыть случайное слово.");
  } finally {
    state.isRevealing = false;
    el.revealBtn.disabled = false;
    el.revealRandomBtn.disabled = false;
  }
}

/* ==========================================================================
 * ОТРИСОВКА: МОИ ПОСТЫ (АВТОР)
 * ========================================================================== */

function renderMyView() {
  const myPosts = getMyPosts();

  el.myEmptyState.classList.toggle("hidden", myPosts.length > 0 || state.isCreatingNewPost);

  renderPostChips(
    el.myPostsList,
    myPosts,
    state.isCreatingNewPost ? null : state.selectedMyPostId,
    async (postId) => {
      if (state.selectedMyPostId === postId && !state.isCreatingNewPost) return;
      if (!(await confirmDiscardUnsavedChanges())) return;
      openExistingMyPost(postId);
    }
  );

  if (state.isCreatingNewPost) {
    renderAuthorWorkspace(null);
    return;
  }

  const currentPost = getSelectedMyPost();
  if (state.selectedMyPostId && !currentPost) {
    state.selectedMyPostId = null;
    state.isEditorDirty = false;
  }

  if (!currentPost) {
    el.authorWorkspace.classList.add("hidden");
    return;
  }

  renderAuthorWorkspace(currentPost);
}

async function confirmDiscardUnsavedChanges() {
  if (!state.isEditorDirty) return true;
  return showConfirmModal({
    title: "Несохранённые правки",
    message: "В редакторе есть несохранённый текст. Уйти без сохранения?",
    okText: "Уйти",
    danger: true
  });
}

function openNewPostEditor() {
  state.isCreatingNewPost = true;
  state.selectedMyPostId = null;
  state.authorSubTab = "edit";
  state.isEditorDirty = false;

  el.postTitleInput.value = "";
  el.postContentInput.value = "";
  editorHistory.reset("", 0, 0);
  updateEditorMetrics();

  renderMyView();
  el.postTitleInput.focus();
}

function openExistingMyPost(postId) {
  const post = getMyPosts().find((p) => p.id === postId);
  if (!post) return;

  state.isCreatingNewPost = false;
  state.selectedMyPostId = post.id;
  state.isEditorDirty = false;

  const content = post.content || "";
  el.postTitleInput.value = post.title || "";
  el.postContentInput.value = content;
  editorHistory.reset(content, 0, 0);
  updateEditorMetrics();

  renderMyView();
}

function setAuthorSubTab(subTab) {
  if (state.isCreatingNewPost && subTab === "spy") return;
  state.authorSubTab = subTab;
  const currentPost = state.isCreatingNewPost ? null : getSelectedMyPost();
  renderAuthorWorkspace(currentPost);
}

function renderAuthorWorkspace(post) {
  el.authorWorkspace.classList.remove("hidden");

  const isNew = !post;
  el.authorTabSpy.disabled = isNew;
  el.authorFullOpenToggle.disabled = isNew;
  el.deletePostBtn.disabled = isNew;

  if (isNew) {
    state.authorSubTab = "edit";
    el.authorFullOpenToggle.checked = false;
  } else {
    el.authorFullOpenToggle.checked = Boolean(post.isFullyRevealed);
  }

  el.authorTabEdit.classList.toggle("active", state.authorSubTab === "edit");
  el.authorTabSpy.classList.toggle("active", state.authorSubTab === "spy");
  el.authorEditPane.classList.toggle("hidden", state.authorSubTab !== "edit");
  el.authorSpyPane.classList.toggle("hidden", state.authorSubTab !== "spy");

  if (!isNew) {
    const revealedCount = Array.isArray(post.revealedIndices) ? post.revealedIndices.length : 0;
    const partnerName = state.partner ? state.partner.name : "Партнёр";
    el.spyStats.textContent =
      `Всего ${pluralizeWords(post.wordCount)} · ${partnerName} открыто: ${revealedCount}`;
    el.authorNavCount.textContent = String(revealedCount);

    if (state.authorSubTab === "spy") {
      renderAuthorSpyCanvas(el.authorSpyCanvas, post);
    }
  }
}

async function handleSavePost() {
  editorHistory.flush();

  const title = el.postTitleInput.value.trim();
  const content = el.postContentInput.value;

  if (!title) {
    showToast("Введи название для постика.");
    el.postTitleInput.focus();
    return;
  }

  el.savePostBtn.disabled = true;
  el.savePostBtn.textContent = "Сохраняем...";

  try {
    if (state.isCreatingNewPost) {
      const created = await createPost(state.me.uid, title, content);
      state.isCreatingNewPost = false;
      state.selectedMyPostId = created.id;
      state.isEditorDirty = false;
      showToast(`Постик создан (${pluralizeWords(created.wordCount)}).`);
      renderMyView();
    } else if (state.selectedMyPostId) {
      const summary = await updatePost(state.selectedMyPostId, state.me.uid, title, content);
      state.isEditorDirty = false;

      if (!summary.wasFullyRevealed && summary.refundedCount > 0) {
        const partnerDat = state.partner ? getNameForm(state.partner.name, "dat") : "партнёру";
        showToast(
          `Сохранено. Удалено открытых слов: ${summary.refundedCount} — возвращено ${partnerDat}.`
        );
      } else {
        showToast(`Постик сохранён (${pluralizeWords(summary.wordCount)}).`);
      }
    }
  } catch (err) {
    showToast(err.message || "Ошибка при сохранении.");
  } finally {
    el.savePostBtn.disabled = false;
    el.savePostBtn.textContent = "Сохранить";
  }
}

async function handleToggleFullOpen() {
  const post = getSelectedMyPost();
  if (!post) return;

  const wantOpen = el.authorFullOpenToggle.checked;
  const partnerName = state.partner ? state.partner.name : "Партнёр";

  const confirmed = await showConfirmModal({
    title: wantOpen ? "Открыть постик целиком?" : "Снова скрыть постик?",
    message: wantOpen
      ? `${partnerName} сможет прочитать весь текст «${post.title}» целиком. Ранее открытые слова останутся отмечены на память.`
      : `Текст «${post.title}» снова станет скрытым, останутся видны только ранее открытые слова.`,
    okText: wantOpen ? "Открыть целиком" : "Скрыть обратно"
  });

  if (!confirmed) {
    el.authorFullOpenToggle.checked = !wantOpen;
    return;
  }

  try {
    await setPostFullyRevealed(post.id, wantOpen);
    showToast(wantOpen ? "Постик открыт целиком." : "Постик снова скрыт.");
  } catch (err) {
    el.authorFullOpenToggle.checked = !wantOpen;
    showToast(err.message || "Не удалось изменить статус поста.");
  }
}

async function handleDeletePost() {
  const post = getSelectedMyPost();
  if (!post) return;

  const revealedCount = !post.isFullyRevealed && Array.isArray(post.revealedIndices)
    ? post.revealedIndices.length
    : 0;

  const refundHint = revealedCount > 0
    ? ` Потраченные на него ${pluralizeWords(revealedCount)} автоматически вернутся на баланс партнёра.`
    : "";

  const confirmed = await showConfirmModal({
    title: "Удалить постик?",
    message: `Постик «${post.title}» будет удалён безвозвратно.${refundHint}`,
    okText: "Удалить",
    danger: true
  });

  if (!confirmed) return;

  try {
    await deletePost(post, state.me.uid);
    state.selectedMyPostId = null;
    state.isEditorDirty = false;
    editorHistory.reset("", 0, 0);
    el.authorWorkspace.classList.add("hidden");
    showToast("Постик удалён.");
  } catch (err) {
    showToast(err.message || "Не удалось удалить постик.");
  }
}

/* ==========================================================================
 * БАЛАНСЫ И ПОДАРКИ
 * ========================================================================== */

function renderBalancesUI() {
  el.partnerBalanceBadge.textContent = String(state.myBalance);
  el.giftsMyBalance.textContent = String(state.myBalance);
  el.giftsPartnerBalance.textContent = String(state.partnerBalance);
  renderRefundBanner(state.pendingRefunds);
}

async function handleGiftSubmit(event) {
  event.preventDefault();
  if (!state.me || !state.partner) return;

  const amount = Number(el.giftAmountInput.value);
  const note = el.giftNoteInput.value.trim();

  el.giftSubmitBtn.disabled = true;
  el.giftSubmitBtn.textContent = "Отправляем...";

  try {
    await giftWords(state.me.uid, state.partner.uid, amount, note);
    el.giftAmountInput.value = "1";
    el.giftNoteInput.value = "";
    showToast(`Подарено +${pluralizeWords(amount)} (${getNameForm(state.partner.name, "dat")}).`);
  } catch (err) {
    showToast(err.message || "Не удалось подарить слова.");
  } finally {
    el.giftSubmitBtn.disabled = false;
    el.giftSubmitBtn.textContent = "Подарить";
  }
}

/* ==========================================================================
 * ПОДПИСКИ И СТАРТ ПРИЛОЖЕНИЯ
 * ========================================================================== */

function clearSubscriptions() {
  for (const unsub of state.unsubscribers) {
    try {
      unsub();
    } catch {
      // игнорируем
    }
  }
  state.unsubscribers = [];
}

async function startSession(firebaseUser) {
  clearSubscriptions();

  state.user = firebaseUser;
  state.me = getUserInfo(firebaseUser.uid);
  state.partner = getPartnerInfo(firebaseUser.uid);

  el.currentUserName.textContent = state.me.name;

  if (state.partner) {
    el.tabPartnerLabel.textContent = `Посты ${getNameForm(state.partner.name, "gen")}`;
    el.giftsPartnerLabel.textContent = state.partner.name;
    el.giftTargetName.textContent = getNameForm(state.partner.name, "dat");
  }

  el.authScreen.classList.add("hidden");
  el.appScreen.classList.remove("hidden");

  try {
    await ensureUserProfiles(state.me.uid);
  } catch (err) {
    console.error("Ошибка инициализации профилей:", err);
  }

  const unsubBalances = subscribeBalances(
    state.me.uid,
    state.partner?.uid || null,
    ({ myBalance, partnerBalance, pendingRefunds }) => {
      state.myBalance = myBalance;
      state.partnerBalance = partnerBalance;
      state.pendingRefunds = pendingRefunds;
      renderBalancesUI();
    }
  );

  const unsubPosts = subscribePosts((posts) => {
    state.posts = posts;
    renderPartnerView();
    renderMyView();
  });

  const unsubHistory = subscribeHistory((items) => {
    renderHistory(el.historyList, items);
  });

  state.unsubscribers.push(unsubBalances, unsubPosts, unsubHistory);
}

function endSession() {
  clearSubscriptions();
  closeNavigatorDrawer();

  state.user = null;
  state.me = null;
  state.partner = null;
  state.posts = [];
  state.myBalance = 0;
  state.partnerBalance = 0;
  state.pendingRefunds = [];
  state.selectedPartnerPostId = null;
  state.selectedMyPostId = null;
  state.isCreatingNewPost = false;
  state.isEditorDirty = false;
  state.pendingScrollWord = null;
  state.editorParsedText = "";
  state.editorParsedCache = null;

  editorHistory.reset("", 0, 0);
  renderRefundBanner([]);
  el.appScreen.classList.add("hidden");
  el.authScreen.classList.remove("hidden");
}

function bindEvents() {
  // Главные вкладки
  el.navTabs.forEach((btn) => {
    btn.addEventListener("click", () => switchMainTab(btn.dataset.tab));
  });

  // Закрытие баннера возврата
  el.refundBannerClose.addEventListener("click", async () => {
    if (!state.me) return;
    try {
      await acknowledgePendingRefunds(state.me.uid);
    } catch (err) {
      console.error("Ошибка закрытия уведомления:", err);
    }
  });

  // Режимы пустот
  el.voidModePureBtn.addEventListener("click", () => setVoidMode("pure"));
  el.voidModeStructureBtn.addEventListener("click", () => setVoidMode("structure"));

  // Открытие слов по номеру и рандому
  el.revealBtn.addEventListener("click", handleRevealByInput);
  el.revealInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleRevealByInput();
    }
  });
  el.revealRandomBtn.addEventListener("click", handleRevealRandom);

  // Навигатор по открытым словам (читатель и автор)
  el.readerNavigatorBtn.addEventListener("click", () => {
    const post = getSelectedPartnerPost();
    if (post) openNavigatorDrawer(post, el.readerCanvas);
  });

  el.authorNavigatorBtn.addEventListener("click", () => {
    const post = getSelectedMyPost();
    if (post) openNavigatorDrawer(post, el.authorSpyCanvas);
  });

  el.navigatorCloseBtn.addEventListener("click", closeNavigatorDrawer);
  el.navigatorOverlay.addEventListener("click", (event) => {
    if (event.target === el.navigatorOverlay) closeNavigatorDrawer();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeNavigatorDrawer();
  });

  // Авторский раздел
  el.newPostBtn.addEventListener("click", async () => {
    if (!(await confirmDiscardUnsavedChanges())) return;
    openNewPostEditor();
  });

  el.authorTabEdit.addEventListener("click", () => setAuthorSubTab("edit"));
  el.authorTabSpy.addEventListener("click", () => setAuthorSubTab("spy"));

  el.postTitleInput.addEventListener("input", () => {
    state.isEditorDirty = true;
  });

  // Ввод текста, история правок и счётчик слова под курсором
  el.postContentInput.addEventListener("input", (event) => {
    state.isEditorDirty = true;
    const immediate =
      event.inputType === "insertFromPaste" ||
      event.inputType === "deleteByCut";

    editorHistory.record(
      el.postContentInput.value,
      el.postContentInput.selectionStart ?? 0,
      el.postContentInput.selectionEnd ?? 0,
      { immediate }
    );
    updateEditorMetrics();
  });

  el.postContentInput.addEventListener("click", () => updateCursorIndicator());
  el.postContentInput.addEventListener("keyup", () => updateCursorIndicator());
  el.postContentInput.addEventListener("focus", () => updateCursorIndicator());
  el.postContentInput.addEventListener("select", () => updateCursorIndicator());

  // Надёжное отслеживание курсора на сенсорных экранах (телефонах)
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === el.postContentInput) {
      updateCursorIndicator();
    }
  });

  // Кнопки и горячие клавиши Назад / Вперёд
  el.editorUndoBtn.addEventListener("click", handleEditorUndo);
  el.editorRedoBtn.addEventListener("click", handleEditorRedo);

  el.postContentInput.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod || event.altKey) return;

    if (event.code === "KeyZ" && !event.shiftKey) {
      event.preventDefault();
      handleEditorUndo();
    } else if (
      (event.code === "KeyZ" && event.shiftKey) ||
      (event.code === "KeyY" && !event.shiftKey)
    ) {
      event.preventDefault();
      handleEditorRedo();
    }
  });

  el.savePostBtn.addEventListener("click", handleSavePost);

  el.closeAuthorWorkspaceBtn.addEventListener("click", async () => {
    if (!(await confirmDiscardUnsavedChanges())) return;
    state.isCreatingNewPost = false;
    state.selectedMyPostId = null;
    state.isEditorDirty = false;
    editorHistory.reset("", 0, 0);
    el.authorWorkspace.classList.add("hidden");
    renderMyView();
  });

  el.authorFullOpenToggle.addEventListener("change", handleToggleFullOpen);
  el.deletePostBtn.addEventListener("click", handleDeletePost);

  // Подарки
  el.quickAmountBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      el.giftAmountInput.value = btn.dataset.amount;
    });
  });
  el.giftForm.addEventListener("submit", handleGiftSubmit);
}

// Запуск приложения
initThemeSwitcher();
loadSavedVoidMode();
bindEvents();
initAuth({
  onAuthenticated: startSession,
  onSignedOut: endSession
});
