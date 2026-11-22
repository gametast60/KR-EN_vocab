// Imported vocabulary updates also trigger the browser's service-worker update check.
const window = self;
importScripts('flashcard1.js', 'flashcard2.js', 'flashcard_en_a1.js', 'flashcard_en_a2.js',
  'flashcard_en_b1.js', 'flashcard_en_b2.js', 'vocabulary-catalog.js');
// Give each vocabulary revision its own cache, so a failed install cannot mix versions.
const vocabularyRevision = JSON.stringify(Object.values(self.VocabularyCatalog.levels).map(key => self[key]))
  .split('').reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16);
const CACHE = "vocab-v5.4.16-" + vocabularyRevision;
const FILES = [
  "index.html","style.css","refresh-loading.css",
  "app.js","game.js","navigation.js",
  "sentence-engine.js","vocabulary-catalog.js",
  "sentence-practice.js","sentence-practice.css",
  "visual/visual-engine.js","visual/visual-recall.js","visual/visual-recall.css",
  ...self.visualImageMap.map(image => image.file),
  "flashcard1.js","flashcard2.js","flashcard_en_a1.js","flashcard_en_a2.js","flashcard_en_b1.js","flashcard_en_b2.js",
  "srs.js","manifest.json", "vocab_editor.js","icon-192.png"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
