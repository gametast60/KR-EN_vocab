const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');

function setup() {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value: id === 'spLevel' ? 'topik1' : '', textContent: '', disabled: false,
        events: {}, children: [],
        classList: { toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
        addEventListener(name, fn) { this.events[name] = fn; }, focus() {},
        replaceChildren() { this.children = []; }, appendChild(child) { this.children.push(child); }
      });
    }
    return elements.get(id);
  }
  const document = { getElementById: element, createElement: () => ({ textContent: '' }) };
  const window = {};
  const context = vm.createContext({ window, document,
    goTo: id => { context.screen = id; },
    getTopikVocab: level => level === 'topik1' ? window.flashVocabData1 : window.flashVocabDataEnA1,
    recordAnswer() { throw Error('SRS write attempted'); },
    localStorage: new Proxy({}, { get() { throw Error('Storage access attempted'); } })
  });
  for (const file of ['flashcard1.js', 'flashcard_en_a1.js', 'sentence-engine.js', 'vocabulary-catalog.js']) {
    if(file === 'vocabulary-catalog.js') Object.assign(window, JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/vocabulary.json'),'utf8')));
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  context.SentenceEngine = window.SentenceEngine;
  vm.runInContext(fs.readFileSync(path.join(root, 'sentence-practice.js'), 'utf8'), context);
  const fire = (id, type = 'click', extra = {}) => element(id).events[type]({ preventDefault() {}, ...extra });
  window.SentencePractice.open();
  return { element, fire, context, window };
}

test('complete round: empty input, correct, wrong, reveal, skip, duplicate submissions and summary', () => {
  const { element: el, fire, window } = setup();
  assert.match(el('spAvailability').textContent, /พร้อมฝึก 20/);
  fire('spStart');
  fire('spForm', 'submit');
  assert.match(el('spFeedback').textContent, /พิมพ์คำตอบก่อน/);
  el('spAnswer').value = '가게'; fire('spForm', 'submit');
  fire('spForm', 'submit'); // Must not score the same answer twice.
  fire('spReveal');
  fire('spNext');
  el('spAnswer').value = 'wrong'; fire('spForm', 'submit'); fire('spNext');
  fire('spReveal'); fire('spNext');
  fire('spSkip'); fire('spNext');
  for (const record of window.sentenceExercises.filter(row => row.levelId === 'topik1').slice(4)) {
    el('spAnswer').value = record.targetAnswer; fire('spForm', 'submit'); fire('spNext');
  }
  assert.equal(el('spScore').textContent, 'ถูก 17 · ผิด 1 · เปิดเฉลย 1 · ข้าม 1 · ยังไม่ได้ทำ 0 ข้อ');
  assert.equal(el('spReview').children.length, 3);
  assert.equal(el('spSummary').classList.contains('hidden'), false);
});

test('early finish, restart, empty level and reopening clear previous results', () => {
  const { element: el, fire, window } = setup();
  fire('spStart'); fire('spFinish');
  assert.match(el('spScore').textContent, /ยังไม่ได้ทำ 20 ข้อ/);
  fire('spAgain');
  window.flashVocabDataEnA1 = [];
  el('spLevel').value = 'english_a1'; fire('spLevel', 'change');
  assert.equal(el('spStart').disabled, true);
  fire('spStart');
  assert.equal(el('spQuestion').classList.contains('hidden'), true);
  el('spLevel').value = 'topik1'; window.SentencePractice.open();
  fire('spStart');
  assert.equal(el('spProgress').textContent, 'ข้อ 1 / 20');
});

test('Korean IME Enter does not submit partial composition', () => {
  const { fire } = setup();
  let prevented = false;
  fire('spAnswer', 'keydown', { key: 'Enter', isComposing: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('UI elements, scripts, styles and offline assets are wired in the app', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const source = fs.readFileSync(path.join(root, 'sentence-practice.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  for (const [, id] of source.matchAll(/(?:el|show)\('(sp\w+)'/g)) assert.ok(html.includes(`id="${id}"`), id);
  for (const file of ['sentence-practice.js', 'sentence-practice.css']) {
    assert.ok(html.includes(file)); assert.ok(sw.includes(file));
  }
});
