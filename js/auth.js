import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { auth, isAllowedUser } from "./firebase-config.js";

const THEME_STORAGE_KEY = "postiki_theme";
const VALID_THEMES = new Set(["light", "dark", "book"]);

/**
 * Применяет тему и сохраняет выбор на текущем устройстве.
 */
export function applyTheme(themeName) {
  const safeTheme = VALID_THEMES.has(themeName) ? themeName : "dark";
  document.documentElement.dataset.theme = safeTheme;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, safeTheme);
  } catch (err) {
    console.warn("Не удалось сохранить тему в localStorage:", err);
  }

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.theme === safeTheme);
  });
}

/**
 * Загружает последнюю выбранную тему на устройстве и подключает кнопки в шапке.
 */
export function initThemeSwitcher() {
  let savedTheme = "dark";
  try {
    savedTheme = localStorage.getItem(THEME_STORAGE_KEY) || "dark";
  } catch {
    savedTheme = "dark";
  }

  applyTheme(savedTheme);

  document.querySelectorAll(".theme-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(btn.dataset.theme);
    });
  });
}

function translateAuthError(code) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Неверный логин или пароль.";
    case "auth/invalid-email":
      return "Проверь формат почты (логина).";
    case "auth/too-many-requests":
      return "Слишком много попыток входа. Подожди пару минут.";
    case "auth/network-request-failed":
      return "Нет связи с сервером. Проверь интернет.";
    default:
      return "Не удалось войти. Попробуй ещё раз.";
  }
}

/**
 * Инициализирует форму входа, кнопку выхода и слежение за сессией.
 */
export function initAuth({ onAuthenticated, onSignedOut }) {
  const loginForm = document.getElementById("login-form");
  const emailInput = document.getElementById("login-email");
  const passwordInput = document.getElementById("login-password");
  const errorBox = document.getElementById("login-error");
  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");

  function showError(message) {
    if (!message) {
      errorBox.textContent = "";
      errorBox.classList.add("hidden");
      return;
    }
    errorBox.textContent = message;
    errorBox.classList.remove("hidden");
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showError("");

    const email = emailInput.value.trim();
    const password = passwordInput.value;

    if (!email || !password) {
      showError("Введи логин и пароль.");
      return;
    }

    loginBtn.disabled = true;
    loginBtn.textContent = "Входим...";

    try {
      await signInWithEmailAndPassword(auth, email, password);
      passwordInput.value = "";
    } catch (err) {
      showError(translateAuthError(err.code));
    } finally {
      loginBtn.disabled = false;
      loginBtn.textContent = "Войти";
    }
  });

  logoutBtn.addEventListener("click", async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error("Ошибка при выходе:", err);
    }
  });

  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      onSignedOut();
      return;
    }

    if (!isAllowedUser(user.uid)) {
      showError("Доступ закрыт для этого аккаунта.");
      await signOut(auth);
      return;
    }

    showError("");
    onAuthenticated(user);
  });
}
