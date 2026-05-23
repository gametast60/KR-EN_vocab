const CACHE = "topik-v2-2"; // ← เพิ่มทุกครั้งที่แก้ไฟล์นี้
const FILES = [
  "index.html", "style.css",
  "app.js", "game.js", "navigation.js",
  "nouns1.js", "nouns2.js",
  "flashcard.js", "manifest.json", "icon-192.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting(); // ← บังคับอัปเดตทันที
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});