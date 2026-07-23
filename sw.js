// ============================================================
//  Service Worker — تشغيل النظام كتطبيق ودعم العمل بدون نت
//  ملحوظة: بيانات Firestore بتتخزن لوحدها في IndexedDB،
//  الـ SW ده مسؤول عن ملفات الواجهة بس (HTML/CSS/JS)
// ============================================================
const CACHE = "nexo-v2.0.0";
const SHELL = [
  "./",
  "./index.html",
  "./login.html",
  "./css/style.css",
  "./js/app.js",
  "./js/config.js",
  "./js/firebase.js",
  "./js/auth.js",
  "./js/ui.js",
  "./js/router.js",
  "./icon.svg",
  "./manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // أي حاجة خاصة بفايربيز أو جوجل → من الشبكة مباشرة (Firestore بيتولى الأوفلاين بنفسه)
  if (url.hostname.includes("googleapis.com") ||
      url.hostname.includes("firebaseio.com") ||
      url.hostname.includes("gstatic.com") ||
      e.request.method !== "GET") {
    return;
  }

  // ملفات الواجهة: الشبكة الأول، والكاش وقت الطوارئ
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});
