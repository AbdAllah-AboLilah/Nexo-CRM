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
  writeBatch, collectionGroup, onSnapshotsInSync, Timestamp, waitForPendingWrites,
  startAfter, getCountFromServer,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-functions.js";
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";

import { firebaseConfig } from "./config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// التخزين المحلي: Firestore بيستخدم IndexedDB جوّه ويزامن أوتوماتيك أول ما النت يرجع
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const fns = getFunctions(app, "us-central1");
export const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch(() => {});

// ---------- مراقبة حالة المزامنة ----------
// 🔴 مفيش نت | 🟡 فيه بيانات لسه بترفع | 🟢 كل حاجة متزامنة
//
// ملحوظة: بنعتمد على waitForPendingWrites بتاعة Firestore نفسها بدل ما
// نعدّ الكتابات بإيدينا — لأن العدّ اليدوي بيعلق لو الشاشة اتقفلت
// وفيها كتابة معلّقة، والنقطة تفضل صفرا للأبد.
let syncing = false;
let syncWatcher = null;
let netListeners = [];

export function onNetworkState(cb) {
  netListeners.push(cb);
  cb(currentNetworkState());
  return () => { netListeners = netListeners.filter((f) => f !== cb); };
}

export function currentNetworkState() {
  if (!navigator.onLine) return "offline";
  if (syncing) return "syncing";
  return "online";
}

function emitNetwork() {
  const s = currentNetworkState();
  netListeners.forEach((f) => f(s));
}

/** بيبدأ مراقبة الكتابات المعلّقة لحد ما السيرفر يأكّدها كلها */
function watchPendingWrites() {
  if (syncWatcher || !navigator.onLine) return;
  syncing = true;
  emitNetwork();

  // حد أقصى 20 ثانية عشان المؤشر ما يعلقش لو الشبكة بايظة
  const guard = setTimeout(finish, 20000);
  syncWatcher = waitForPendingWrites(db).then(finish, finish);

  function finish() {
    clearTimeout(guard);
    syncWatcher = null;
    syncing = false;
    emitNetwork();
  }
}

/** كل شاشة بتنادي دي مع أي snapshot عشان نعرف فيه كتابة معلقة ولا لأ */
export function trackSnapshot(_key, snap) {
  if (snap?.metadata?.hasPendingWrites) watchPendingWrites();
}

/** تُنادى يدوياً بعد أي كتابة مباشرة (مش جاية من snapshot) */
export function markPending() {
  watchPendingWrites();
}

window.addEventListener("online", () => { emitNetwork(); watchPendingWrites(); });
window.addEventListener("offline", () => { syncing = false; emitNetwork(); });
onSnapshotsInSync(db, emitNetwork);

export {
  onAuthStateChanged, signInWithEmailAndPassword, signOut, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, increment,
  writeBatch, collectionGroup, Timestamp, httpsCallable,
  startAfter, getCountFromServer,
  storageRef, uploadBytesResumable, getDownloadURL, deleteObject,
};
