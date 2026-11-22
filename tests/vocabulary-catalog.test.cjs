const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(root, 'vocabulary-catalog.js'), 'utf8'), context);
const build = context.window.VocabularyCatalog.build;

test('one entry supplies images and sentences without offsets or separate manifests', () => {
  const data = { flashVocabData1: [{ word: '가다', meaning: 'ไป', imageId: '1001',
    sentense: '학교에 갑니다.', translate: 'ไปโรงเรียน', sentenceAnswer: '갑니다' }] };
  const before = JSON.stringify(data), result = build(data);
  assert.equal(result.issues.length, 0);
  assert.equal(result.images[0].file, 'visual/images/1001.webp');
  assert.equal(result.exercises[0].targetAnswer, '갑니다');
  assert.equal(result.exercises[0].sourceSentence.slice(result.exercises[0].start, result.exercises[0].end), '갑니다');
  assert.equal(JSON.stringify(data), before);
});

test('shared images retain per-language senses and unsupported sentences are not invented', () => {
  const result = build({ flashVocabData1: [{ word: '가게', meaning: 'ร้านค้า', imageId: '0001' }],
    flashVocabDataEnA1: [{ word: 'store', meaning: 'ร้านค้า, เก็บ', imageId: '0001' }] });
  assert.equal(result.images.length, 1); assert.equal(result.images[0].bindings.length, 2);
  assert.equal(result.images[0].bindings[1].meaning, 'ร้านค้า, เก็บ');
  assert.equal(result.exercises.length, 0);
});

test('repeated answer requires an explicit occurrence; sentence-only entries also work', () => {
  const row = { word: 'go', meaning: 'ไป', sentence: 'go then go', sentenceAnswer: 'go' };
  assert.equal(build({ flashVocabDataEnA1: [row] }).issues[0].reason, 'ambiguous_target');
  const result = build({ flashVocabDataEnA1: [{ ...row, sentenceOccurrence: 2 }] });
  assert.equal(result.exercises[0].start, 8); assert.equal(result.images.length, 0);
  assert.equal(build({ flashVocabDataEnA1: [{ ...row, sentenceOccurrence: 3 }] }).exercises.length, 0);
  assert.equal(build({ flashVocabDataEnA1: [{ ...row, sentence: 'went home' }] }).issues[0].reason, 'missing_target');
});

test('invalid IDs, duplicate words and conflicting file types fail closed', () => {
  const bad = build({ flashVocabData1: [{ word: 'a', meaning: 'a', imageId: '../0001' }] });
  assert.equal(bad.images.length, 0);
  const row = { word: 'a', meaning: 'a', imageId: '0001' };
  assert.equal(build({ flashVocabData1: [row, row] }).images.length, 0);
  const conflict = build({ flashVocabData1: [row], flashVocabDataEnA1: [{ ...row, imageExtension: 'png' }] });
  assert.equal(conflict.issues[0].reason, 'conflicting_image_extension');
});

test('service worker derives assets and cache revision from added vocabulary', () => {
  function worker(extra) {
    const ctx = vm.createContext({ self: { addEventListener() {} } });
    ctx.importScripts = (...files) => {
      for (const file of files) {
        if (file === 'vocabulary-catalog.js' && extra) ctx.self.flashVocabData1.push(extra);
        vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
      }
    };
    vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8') + '\nglobalThis.snapshot = { cache: CACHE, files: FILES };', ctx);
    return ctx.snapshot;
  }
  const before = worker(), after = worker({ word: 'test-only', meaning: 'test', imageId: '9999', imageExtension: 'png' });
  assert.notEqual(before.cache, after.cache);
  assert.ok(after.files.includes('visual/images/9999.png'));
  assert.ok(!before.files.includes('visual/images/9999.png'));
});
