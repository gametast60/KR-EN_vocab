// Imported vocabulary updates also trigger the browser's service-worker update check.
const window = self;
importScripts('flashcard1.js', 'flashcard2.js', 'flashcard_en_a1.js', 'flashcard_en_a2.js',
  'flashcard_en_b1.js', 'flashcard_en_b2.js', 'vocabulary-catalog.js');
// Give each vocabulary revision its own cache, so a failed install cannot mix versions.
const vocabularyRevision = JSON.stringify(Object.values(self.VocabularyCatalog.levels).map(key => self[key]))
  .split('').reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261).toString(16);
const CACHE = "vocab-v6.0.0-" + vocabularyRevision;
const FILES = [
  "index.html","five-stage/app.css","five-stage/app.js",
  "five-stage/scheduler.js","five-stage/store.js","five-stage/session.js","five-stage/audio.js",
  "sentence-engine.js","vocabulary-catalog.js",
  "visual/visual-engine.js",
  ...self.visualImageMap.map(image => image.file),
  "flashcard1.js","flashcard2.js","flashcard_en_a1.js","flashcard_en_a2.js","flashcard_en_b1.js","flashcard_en_b2.js",
  "manifest.json","icon-192.png"
];
self.addEventListener("install", e => {
  // Broken optional images must not prevent the vocabulary/app from working offline.
  e.waitUntil(caches.open(CACHE).then(async cache => {
    await cache.addAll(FILES.filter(file => !file.startsWith('visual/images/')));
    await Promise.allSettled(FILES.filter(file => file.startsWith('visual/images/')).map(file => cache.add(file)));
  }));
});
self.addEventListener('message', e => { if(e.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith('vocab-') && k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  if(e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(e.request);
    if(cached) return cached;
    try { const response = await fetch(e.request); if(response.ok) await cache.put(e.request,response.clone()); return response; }
    catch(error) { if(e.request.mode === 'navigate') return cache.match('index.html'); throw error; }
  }));
});
