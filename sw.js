const CACHE = "topik-v1";
const FILES = [
  "index.html", "style.css",
  "app.js", "game.js", "navigation.js",
  "nouns1.js", "flashcard.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES))
  );
});

self.addEventListener("fetch", e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});