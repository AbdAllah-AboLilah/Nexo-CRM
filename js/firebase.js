// ============================================================
//  الاتصال بـ Firebase + التخزين المحلي (Offline / IndexedDB)
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, increment,
  writeBatch, collectionGroup, onSnapshotsInSync, Timestamp,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";

import { firebaseConfig } from "./config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// التخزين المحلي: Firestore بيستخدم IndexedDB جوّه ويزامن أوتوماتيك أول ما النت يرجع
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const fns = getFunctions(app, "us-central1");

setPersistence(auth, browserLocalPersistence).catch(() => {});

// ---------- مراقبة حالة المزامنة ----------
// 🔴 مفيش نت | 🟡 فيه بيانات لسه بترفع | 🟢 كل حاجة متزامنة
const pendingSources = new Set();
let netListeners = [];

export function onNetworkState(cb) {
  netListeners.push(cb);
  cb(currentNetworkState());
  return () => { netListeners = netListeners.filter((f) => f !== cb); };
}

export function currentNetworkState() {
  if (!navigator.onLine) return "offline";
  if (pendingSources.size > 0) return "syncing";
  return "online";
}

function emitNetwork() {
  const s = currentNetworkState();
  netListeners.forEach((f) => f(s));
}

/** كل شاشة بتنادي دي مع أي snapshot عشان نعرف فيه كتابة معلقة ولا لأ */
export function trackSnapshot(key, snap) {
  if (snap?.metadata?.hasPendingWrites) pendingSources.add(key);
  else pendingSources.delete(key);
  emitNetwork();
}

export function markPending(key, isPending) {
  if (isPending) pendingSources.add(key);
  else pendingSources.delete(key);
  emitNetwork();
}

window.addEventListener("online", emitNetwork);
window.addEventListener("offline", emitNetwork);
onSnapshotsInSync(db, emitNetwork);

export {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, increment,
  writeBatch, collectionGroup, Timestamp, httpsCallable,
};
