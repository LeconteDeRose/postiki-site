import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCEUG7Oy353MkW08l9q8HGXGeEYyw3PcZY",
  authDomain: "postiki-site.firebaseapp.com",
  projectId: "postiki-site",
  storageBucket: "postiki-site.firebasestorage.app",
  messagingSenderId: "807719533241",
  appId: "1:807719533241:web:ee14b121ee83fdefbf7968"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Запоминаем авторизацию на устройстве до явного выхода
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Не удалось включить локальное сохранение сессии:", err);
});

// Ваши профили по UID
export const USERS = {
  "0xDCQqgcYkbelAACbXKyEX4zlhD2": {
    uid: "0xDCQqgcYkbelAACbXKyEX4zlhD2",
    name: "Дрюша",
    partnerUid: "e1Kc7LIZcZMAOgPjIQEEjMGPQ7v2"
  },
  "e1Kc7LIZcZMAOgPjIQEEjMGPQ7v2": {
    uid: "e1Kc7LIZcZMAOgPjIQEEjMGPQ7v2",
    name: "Тёфа",
    partnerUid: "0xDCQqgcYkbelAACbXKyEX4zlhD2"
  }
};

export function isAllowedUser(uid) {
  return Boolean(uid && USERS[uid]);
}

export function getUserInfo(uid) {
  return USERS[uid] || { uid, name: "Участник", partnerUid: null };
}

export function getPartnerInfo(uid) {
  const me = USERS[uid];
  if (!me || !me.partnerUid) return null;
  return USERS[me.partnerUid] || null;
}
