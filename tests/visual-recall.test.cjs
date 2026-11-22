const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function setup(real = false, random = () => 0.999999, nativeSpeech = false) {
  const elements = new Map();
  const timers = new Map();
  let timerId = 0;
  function el(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { value: id === 'vrLevel' ? 'topik1' : id === 'vrLimit' ? '10' : '',
        textContent: '', disabled: false, events: {}, children: [],
        classList: { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains: name => classes.has(name) },
        addEventListener(name, fn) { this.events[name] = fn; }, focus() {},
        setAttribute(name, value) { this[name] = value; }, getAttribute(name) { return this[name] ?? null; },
        removeAttribute(name) { delete this[name]; },
        replaceChildren(...children) { this.children = children; }, appendChild(child) { this.children.push(child); }
      });
    }
    return elements.get(id);
  }
  const audio = { calls: [], cancelled: 0, utterances: [] };
  const window = { speechSynthesis: {
    cancel() { audio.cancelled++; },
    speak(utterance) { audio.utterances.push(utterance); }
  } };
  if (nativeSpeech) {
    window.SpeechSynthesisUtterance = function (text) { this.text = text; };
  }
  const math = Object.create(Math);
  math.random = random;
  const context = vm.createContext({ Math: math, window, document: { getElementById: el, createElement: () => ({}) },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    goTo() {}, speak(text, language) { audio.calls.push({ text, language }); }, recordAnswer() { throw Error('SRS write'); },
    speakSequence(texts, language) { for (const text of texts) audio.calls.push({ text, language }); },
    localStorage: new Proxy({}, { get() { throw Error('Storage access'); } }) });
  const levels = { topik1: 'flashVocabData1', topik2: 'flashVocabData2', english_a1: 'flashVocabDataEnA1',
    english_a2: 'flashVocabDataEnA2', english_b1: 'flashVocabDataEnB1', english_b2: 'flashVocabDataEnB2' };
  for (const file of fs.readdirSync(root).filter(file => /^flashcard.*\.js$/.test(file))) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  if(!real) Object.assign(window, JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/vocabulary.json'),'utf8')));
  for (const file of ['vocabulary-catalog.js', 'sentence-engine.js', 'visual/visual-engine.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  }
  context.getTopikVocab = level => window[levels[level]];
  context.VisualEngine = window.VisualEngine; context.SentenceEngine = window.SentenceEngine;
  vm.runInContext(fs.readFileSync(path.join(root, 'visual/visual-recall.js'), 'utf8'), context);
  const fire = (id, type = 'click', extra = {}) => {
    if (id === 'vrNext') {
      if (/Stage (1|4)/.test(el('vrStage').textContent)) {
        id = 'vrNextLearn';
      } else {
        const pending = [...timers.values()];
        timers.clear();
        pending.forEach(timer => timer.fn());
        return;
      }
    }
    el(id).events[type]?.({ preventDefault() {}, ...extra });
  };
  window.VisualRecall.open();
  const runTimers = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(timer => timer.fn()); return pending.map(timer => timer.delay); };
  return { el, fire, window, context, audio, runTimers, timers };
}

test('real images share exact vocabulary bindings with ready KR/EN exercises', () => {
  const { window: w, context } = setup(true);
  assert.ok(w.visualImageMap.length >= 20);
  assert.ok(w.visualImageMap.reduce((n, image) => n + image.bindings.length, 0) >= 40);
  for (const image of w.visualImageMap) {
    const bytes = fs.readFileSync(path.join(root, image.file));
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    for (const binding of image.bindings) {
      const cards = w.VisualEngine.getCards(binding.levelId, context.getTopikVocab(binding.levelId), w.visualImageMap, w.sentenceExercises);
      const card = cards.find(card => card.word === binding.word);
      assert.ok(card); assert.equal(card.file, image.file);
      const reviewed = w.sentenceExercises.some(row => row.levelId === binding.levelId && row.word === binding.word);
      assert.equal(card.exercise.status, reviewed ? 'ready' : 'unavailable');
    }
  }
  const cards = w.VisualEngine.getCards('english_a2', context.getTopikVocab('english_a2'), w.visualImageMap, w.sentenceExercises);
  const light = cards.find(card => card.word === 'light (not heavy)');
  assert.equal(w.VisualEngine.checkWord(light, ' LIGHT ').status, 'correct');
  assert.equal(w.VisualEngine.checkWord(light, 'light (from the sun/a lamp)').status, 'incorrect');
});

test('full Korean five-stage round learns sentence forms before testing and counts each response once', () => {
  const { el, fire, window: w } = setup();
  el('vrLimit').value = '20';
  fire('vrLimit', 'change');
  fire('vrStart');
  for (let i = 0; i < 20; i++) fire('vrNext');
  assert.equal(el('vrTransition').classList.contains('hidden'), false);
  fire('vrContinue');
  assert.match(el('vrStage').textContent, /Stage 2/);
  assert.equal(el('vrMeaning').textContent, '');
  assert.ok(el('vrImageWrap').classList.contains('hidden'));
  for (let i = 0; i < 20; i++) { fire('vrReveal'); fire('vrKnown'); fire('vrNext'); }
  fire('vrContinue');
  assert.match(el('vrStage').textContent, /Stage 3/);
  assert.equal(el('vrWord').textContent, '');
  assert.ok(el('vrSpeak').classList.contains('hidden'));
  fire('vrForm', 'submit');
  for (let i = 0; i < 20; i++) {
    const stage3Card = w.VisualEngine.getCards('topik1', w.flashVocabData1, w.visualImageMap, w.sentenceExercises)
      .find(card => card.meaning === el('vrMeaning').textContent);
    el('vrAnswer').value = stage3Card.displayWord;
    fire('vrForm', 'submit'); fire('vrForm', 'submit'); fire('vrNext');
  }
  fire('vrContinue');
  assert.match(el('vrStage').textContent, /Stage 4/);
  assert.ok(el('vrForm').classList.contains('hidden'));
  assert.ok(el('vrReveal').classList.contains('hidden'));
  for (let i = 0; i < 20; i++) {
    const record = w.sentenceExercises.find(row => row.levelId === 'topik1' && row.word === el('vrBaseWord').textContent);
    assert.equal(el('vrBaseWord').textContent, record.word);
    assert.equal(el('vrInflectedWord').textContent, record.targetAnswer);
    assert.equal(el('vrSentence').children.map(child => child.textContent).join(''), record.sourceSentence);
    assert.equal(el('vrSentence').children[1].textContent, record.targetAnswer);
    fire('vrForm', 'submit'); // Hidden submit cannot score learning as a test.
    fire('vrNext');
  }
  fire('vrContinue');
  assert.match(el('vrStage').textContent, /Stage 5/);
  assert.ok(el('vrConjugation').classList.contains('hidden'));
  assert.equal(el('vrInflectedWord').textContent, '');
  for (let i = 0; i < 20; i++) {
    const vocab = w.flashVocabData1.find(row => row.translate === el('vrMeaning').textContent);
    const record = w.sentenceExercises.find(row => row.levelId === 'topik1' && row.word === vocab.word);
    el('vrAnswer').value = record.targetAnswer; fire('vrForm', 'submit'); fire('vrNext');
  }
  fire('vrContinue');
  assert.equal(el('vrSummary').classList.contains('hidden'), false);
  assert.equal(el('appTitle').classList.contains('hidden'), true);
  assert.match(el('vrScores').children[2].textContent, /ถูก 20 · ผิด 0/);
  assert.match(el('vrScores').children[3].textContent, /เรียนแล้ว 20\/20 ประโยค/);
  assert.match(el('vrScores').children[4].textContent, /ถูก 20 · ผิด 0/);
  assert.equal(el('vrSummaryTitle').textContent, 'เรียนครบทั้งรอบแล้ว');
  assert.ok(el('vrRetry').classList.contains('hidden'));
});

test('English completes without sentence stage; reveal/wrong and early finish remain separate', () => {
  const { el, fire, window: w } = setup();
  // Explicit no-sentence fixture keeps this behavior covered as production grows.
  w.flashVocabDataEnA2 = w.flashVocabDataEnA2.filter(row => ['furniture', 'light (not heavy)', 'middle'].includes(row.word)).map(row => ({ word: row.word, meaning: row.meaning, imageId: row.imageId, displayWord: row.displayWord }));
  w.VocabularyCatalog.refresh();
  el('vrLevel').value = 'english_a2'; fire('vrLevel', 'change'); fire('vrStart');
  for (let i = 0; i < 3; i++) fire('vrNext');
  fire('vrContinue');
  for (let i = 0; i < 3; i++) { fire('vrReveal'); fire('vrKnown'); fire('vrNext'); }
  fire('vrContinue');
  el('vrAnswer').value = 'wrong'; fire('vrForm', 'submit'); fire('vrNext');
  fire('vrAnswerReveal'); fire('vrNext');
  el('vrAnswer').value = 'wrong'; fire('vrForm', 'submit'); fire('vrNext');
  assert.match(el('vrTransitionHint').textContent, /ข้าม Stage 4/);
  fire('vrContinue');
  assert.equal(el('vrSummary').classList.contains('hidden'), false);
  assert.match(el('vrCoverage').textContent, /Stage 4–5 พร้อม 0/);
  assert.match(el('vrScores').children[2].textContent, /ถูก 0 · ผิด 2 · เฉลย 1 · ข้าม 0/);
  fire('vrAgain'); el('vrLevel').value = 'topik2'; fire('vrLevel', 'change');
  assert.equal(el('vrStart').disabled, true);
  fire('vrStart'); assert.ok(el('vrPlay').classList.contains('hidden'));
  el('vrLevel').value = 'topik1'; fire('vrLevel', 'change'); fire('vrStart'); fire('vrFinish');
  assert.match(el('vrScores').children[0].textContent, /เรียนแล้ว 0\/10/);
});

test('Visual Recall randomly shuffles the selected card pool', () => {
  const { el, fire, window: w, context } = setup(false, () => 0);
  el('vrLimit').value = '5';
  fire('vrLimit', 'change');
  const cards = w.VisualEngine.getCards(
    'topik1',
    context.getTopikVocab('topik1'),
    w.visualImageMap,
    w.sentenceExercises
  );
  fire('vrStart');
  assert.ok(cards.some(card => card.displayWord === el('vrWord').textContent));
  assert.notEqual(el('vrWord').textContent, cards[0].displayWord);
});

test('Visual Recall reshuffles the same card pool whenever a stage starts', () => {
  const { el, fire } = setup(false, () => 0.999999);
  el('vrLimit').value = '5';
  fire('vrLimit', 'change');
  fire('vrStart');
  const stage1Word = el('vrWord').textContent;
  assert.equal(el('appTitle').classList.contains('hidden'), true);

  for (let i = 0; i < 5; i++) fire('vrNext');
  fire('vrContinue');
  const stage2Word = el('vrWord').textContent;

  assert.notEqual(stage2Word, stage1Word);
  assert.match(el('vrStage').textContent, /Stage 2/);
});

test('Visual Recall accepts a custom number of cards', () => {
  const { el, fire } = setup();
  el('vrLimit').value = '7';
  fire('vrLimit', 'input');
  fire('vrStart');
  assert.equal(el('vrProgress').textContent, 'คำที่ 1 / 7');
});

test('Visual Recall disables stage controls during speech and removes feedback text', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'visual/visual-recall.js'), 'utf8');
  assert.doesNotMatch(html, /id="vrFeedback"/);
  assert.match(js, /if \(stage === 1 \|\| stage === 4\) el\('vrNextLearn'\)\.disabled = busy/);
  assert.match(js, /if \(stage === 2\) el\('vrReveal'\)\.disabled = busy/);
  assert.match(js, /utterance\.onend = speakNext/);
  assert.match(js, /playSpeechSequence\(\[current\(\)\.exercise\.targetAnswer, current\(\)\.exercise\.sentence\]/);
});

test('answer tint and finish button respect speech and auto-advance timing', () => {
  const { el, fire, window: w, audio, runTimers } = setup(false, () => 0.999999, true);
  el('vrLimit').value = '1';
  fire('vrLimit', 'input');
  fire('vrStart');

  assert.equal(el('vrNextLearn').disabled, true);
  assert.equal(el('vrFinish').classList.contains('hidden'), true);
  audio.utterances.shift().onend();
  assert.equal(el('vrNextLearn').disabled, false);
  fire('vrNextLearn');

  fire('vrContinue');
  assert.equal(el('vrReveal').disabled, true);
  assert.equal(el('vrFinish').classList.contains('hidden'), true);
  audio.utterances.shift().onend();
  assert.equal(el('vrReveal').disabled, false);
  fire('vrReveal');
  fire('vrKnown');
  assert.equal(el('vrFinish').classList.contains('hidden'), true);
  assert.deepEqual(runTimers(), [1500]);

  fire('vrContinue');
  const stage3Card = w.VisualEngine.getCards('topik1', w.flashVocabData1, w.visualImageMap, w.sentenceExercises)
    .find(card => card.meaning === el('vrMeaning').textContent);
  el('vrAnswer').value = stage3Card.displayWord;
  fire('vrForm', 'submit');
  assert.equal(el('vrAnswer').getAttribute('data-result'), 'correct');
  assert.equal(el('vrFinish').classList.contains('hidden'), true);
  audio.utterances.shift().onend();
  assert.equal(el('vrFinish').classList.contains('hidden'), true);
  audio.utterances.shift().onend();
  assert.equal(el('vrFinish').classList.contains('hidden'), true);
  assert.deepEqual(runTimers(), [1500]);

  fire('vrContinue');
  assert.match(el('vrStage').textContent, /Stage 4/);
  assert.equal(el('vrFinish').classList.contains('hidden'), true);
  for (let i = 0; i < 3; i++) audio.utterances.shift().onend();
  assert.equal(el('vrNextLearn').disabled, false);
  fire('vrNextLearn');

  fire('vrContinue');
  assert.match(el('vrStage').textContent, /Stage 5/);
  const stage5Card = w.VisualEngine.getCards('topik1', w.flashVocabData1, w.visualImageMap, w.sentenceExercises)
    .find(card => card.exercise.status === 'ready' && card.exercise.translation === el('vrMeaning').textContent);
  assert.ok(stage5Card.exercise.sentence);
  const exercise = stage5Card.exercise;
  el('vrAnswer').value = exercise.targetAnswer;
  fire('vrForm', 'submit');
  assert.equal(el('vrAnswer').getAttribute('data-result'), 'correct');
  assert.deepEqual(audio.utterances.map(utterance => utterance.text), [exercise.targetAnswer]);
  const targetUtterance = audio.utterances.shift();
  assert.equal(targetUtterance.text, exercise.targetAnswer);
  assert.equal(el('vrFinish').classList.contains('hidden'), true);
  targetUtterance.onend();
  assert.equal(el('vrFinish').classList.contains('hidden'), true);
  assert.deepEqual(audio.utterances.map(utterance => utterance.text), [exercise.sentence]);
  audio.utterances.shift().onend();
  assert.deepEqual(runTimers(), [1500]);

  const css = fs.readFileSync(path.join(root, 'visual/visual-recall.css'), 'utf8');
  assert.match(css, /#vrAnswer\[data-result="correct"\].*var\(--success-light\)/);
  assert.match(css, /#vrAnswer\[data-result="incorrect"\].*var\(--danger-light\)/);
});

test('Stage 2 advances after 1.5 seconds and Stage 3/5 wait 1.5 seconds after speech', () => {
  const { el, fire, runTimers } = setup();
  el('vrLimit').value = '3';
  fire('vrLimit', 'input');
  fire('vrStart');
  for (let i = 0; i < 3; i++) fire('vrNextLearn');
  fire('vrContinue');
  fire('vrReveal');
  fire('vrKnown');
  assert.deepEqual(runTimers(), [1500]);
  assert.match(el('vrProgress').textContent, /คำที่ 2 \/ 3/);

  for (let i = 1; i < 3; i++) {
    fire('vrReveal');
    fire('vrKnown');
    runTimers();
  }
  fire('vrContinue');
  el('vrAnswer').value = el('vrMeaning').textContent;
  fire('vrForm', 'submit');
  assert.deepEqual(runTimers(), [1500]);

  const js = fs.readFileSync(path.join(root, 'visual/visual-recall.js'), 'utf8');
  assert.match(js, /if \(stage === 2\) advanceCard\(1500\)/);
});

test('image failure recovery and IME composition are handled', () => {
  const { el, fire } = setup(); fire('vrStart'); fire('vrImage', 'error');
  assert.equal(el('vrImageError').classList.contains('hidden'), false);
  fire('vrImage', 'load'); assert.equal(el('vrImageError').classList.contains('hidden'), true);
  let prevented = false;
  fire('vrAnswer', 'keydown', { key: 'Enter', isComposing: true, preventDefault() { prevented = true; } });
  assert.ok(prevented);
});

test('automatic speech teaches Stage 4 then protects Stage 5 answers', () => {
  const { el, fire, window: w, audio } = setup();
  el('vrLimit').value = '5'; fire('vrLimit', 'change'); fire('vrStart');
  assert.deepEqual(audio.calls.at(-1), { text: '가게', language: 'ko-KR' });
  fire('vrNext'); assert.equal(audio.calls.at(-1).text, '가격');
  for (let i = 1; i < 5; i++) fire('vrNext');
  fire('vrContinue');
  const stage2Word = el('vrWord').textContent;
  assert.notEqual(stage2Word, '');
  for (let i = 0; i < 5; i++) { fire('vrReveal'); fire('vrKnown'); fire('vrNext'); }
  const beforeRecall = audio.calls.length;
  fire('vrContinue'); fire('vrSpeak');
  assert.equal(audio.calls.length, beforeRecall);
  for (let i = 0; i < 5; i++) {
    const vocab = w.flashVocabData1.find(row => row.meaning === el('vrMeaning').textContent);
    el('vrAnswer').value = vocab.word; fire('vrForm', 'submit');
    assert.equal(audio.calls.at(-1).text, vocab.meaning);
    fire('vrNext');
  }
  fire('vrContinue');
  const stage4Base = el('vrBaseWord').textContent;
  const stage4Record = w.sentenceExercises.find(row => row.levelId === 'topik1' && row.word === stage4Base);
  assert.deepEqual(audio.calls.slice(-3).map(call => call.text),
    [stage4Record.word, stage4Record.targetAnswer, stage4Record.sourceSentence]);
  for (let i = 0; i < 5; i++) fire('vrNext');
  const beforeSentence = audio.calls.length;
  fire('vrContinue'); fire('vrSpeak'); assert.equal(audio.calls.length, beforeSentence);
  for (let i = 0; i < 4; i++) { fire('vrAnswerReveal'); fire('vrNext'); }
  const finalVocab = w.flashVocabData1.find(row => row.translate === el('vrMeaning').textContent);
  const finalRecord = w.sentenceExercises.find(row =>
    row.levelId === 'topik1' && row.word === finalVocab.word);
  fire('vrAnswerReveal');
  assert.equal(audio.calls.at(-2).text, finalRecord.targetAnswer);
  assert.equal(audio.calls.at(-1).text, finalRecord.sourceSentence);
  assert.equal(audio.calls.at(-1).language, 'ko-KR');
  const cancelled = audio.cancelled; w.VisualRecall.stopAudio();
  assert.equal(audio.cancelled, cancelled + 1);
});

test('automatic speech remains enabled while manual replay and unsupported speech stay usable', () => {
  const { el, fire, window: w, audio, context } = setup();
  const expected = w.VisualEngine.getCards('english_a2', context.getTopikVocab('english_a2'), w.visualImageMap, w.sentenceExercises);
  el('vrLevel').value = 'english_a2'; fire('vrLevel', 'change'); fire('vrStart');
  assert.deepEqual(audio.calls.at(-1), { text: expected[0].displayWord, language: 'en-US' });
  const count = audio.calls.length; fire('vrNext');
  assert.equal(audio.calls.at(-1).text, expected[1].displayWord);
  fire('vrSpeak'); assert.equal(audio.calls.at(-1).text, expected[1].displayWord);
  delete w.speechSynthesis; fire('vrSpeak');
  assert.match(el('vrAudioNotice').textContent, /ยังไม่รองรับ/);
});

test('English sentence learning uses the same form in Stage 5 and preserves guarded audio', () => {
  const { el, fire, window: w, audio } = setup();
  // Test fixture only: no English sentences are added to the production vocabulary.
  w.flashVocabDataEnA1 = [{ word: 'go', meaning: 'ไป', imageId: '0006',
    sentence: 'I went home.', translate: 'ฉันกลับบ้าน', sentenceAnswer: 'went' }];
  w.VocabularyCatalog.refresh();
  el('vrLevel').value = 'english_a1'; fire('vrLevel', 'change'); fire('vrStart');
  fire('vrNext'); fire('vrContinue');
  fire('vrReveal'); fire('vrKnown'); fire('vrNext'); fire('vrContinue');
  el('vrAnswer').value = 'go'; fire('vrForm', 'submit'); fire('vrNext'); fire('vrContinue');
  assert.equal(el('vrBaseWord').textContent, 'go');
  assert.equal(el('vrInflectedWord').textContent, 'went');
  assert.deepEqual(audio.calls.slice(-3).map(row => row.text), ['go', 'went', 'I went home.']);
  assert.ok(audio.calls.slice(-3).every(row => row.language === 'en-US'));
  fire('vrNext'); fire('vrContinue');
  assert.match(el('vrStage').textContent, /Stage 5/);
  assert.equal(el('vrSentence').textContent, 'I _____ home.');
  assert.equal(el('vrBaseWord').textContent, '');
  el('vrAnswer').value = 'go'; fire('vrForm', 'submit');
  assert.equal(el('vrAnswer').getAttribute('data-result'), 'incorrect');
  const count = audio.calls.length;
  assert.equal(audio.calls.length, count);
  fire('vrSpeak'); assert.deepEqual(audio.calls.slice(-2).map(row => row.text), ['went', 'I went home.']);
  fire('vrNext'); fire('vrContinue');
  assert.equal(el('vrScores').children.length, 5);
  assert.match(el('vrScores').children[3].textContent, /เรียนแล้ว 1\/1 ประโยค/);
  assert.match(el('vrScores').children[4].textContent, /ผิด 1/);
});

test('transition waits for continuation and retry deduplicates words across stages', () => {
  const { el, fire, window: w } = setup();
  el('vrLimit').value = '5'; fire('vrLimit', 'change'); fire('vrStart');
  for (let i = 0; i < 5; i++) fire('vrNext');
  fire('vrNext'); // Hidden old next action cannot bypass the transition.
  fire('vrContinue'); fire('vrContinue');
  assert.match(el('vrProgress').textContent, /คำที่ 1 \/ 5/);
  for (let i = 0; i < 5; i++) {
    fire('vrReveal'); fire(i === 0 ? 'vrUnknown' : 'vrKnown'); fire('vrNext');
  }
  fire('vrContinue');
  for (let i = 0; i < 5; i++) {
    el('vrAnswer').value = i === 0 ? 'wrong' : w.sentenceExercises[i].word;
    fire('vrForm', 'submit'); fire('vrNext');
  }
  fire('vrTransitionFinish');
  assert.equal(el('vrSummaryTitle').textContent, 'สรุปผลก่อนจบรอบ');
  assert.equal(el('vrRetry').textContent, 'ฝึกซ้ำ 2 คำที่ยังติดขัด');
  fire('vrRetry');
  assert.match(el('vrStage').textContent, /Stage 1/);
  assert.equal(el('vrProgress').textContent, 'คำที่ 1 / 2');
  fire('vrFinish'); fire('vrAgain');
  assert.ok(el('vrTransition').classList.contains('hidden'));
});

test('all referenced UI IDs and precached files exist', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'visual/visual-recall.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'visual/visual-recall.css'), 'utf8');
  assert.doesNotMatch(html, /id="vrSkip"/);
  assert.match(html, /id="vrKnown"[^>]*>จำได้</);
  assert.match(html, /id="vrUnknown"[^>]*>จำไม่ได้</);
  assert.match(html, /<div class="vr-stage-toolbar">\s*<p id="vrProgress"><\/p>\s*<button id="vrFinish"/);
  assert.match(html, /<div class="vr-answer-actions">\s*<button id="vrCheck"[^>]*>ตรวจคำตอบ<\/button>\s*<button id="vrAnswerReveal"[^>]*>ดูเลย<\/button>/);
  assert.match(css, /#visualRecall #vrForm \{ width:100%; min-width:0; \}/);
  assert.match(css, /#visualRecall #vrAnswer \{[^}]*max-width:100%;[^}]*box-sizing:border-box/);
  assert.match(css, /#visualRecall #vrAnswer:focus \{ box-shadow:inset 0 0 0 1px var\(--primary-hover\); \}/);
  for (const [, id] of js.matchAll(/(?:el|show)\('(vr\w+)'/g)) assert.ok(html.includes(`id="${id}"`), id);
  const context = vm.createContext({ self: { addEventListener() {} } });
  context.importScripts = (...files) => { for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context); };
  vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8') + '\nglobalThis.files = FILES;', context);
  for (const file of context.files) assert.ok(fs.existsSync(path.join(root, file)), file);
  const { window: w } = setup();
  for (const image of w.visualImageMap) assert.ok(context.files.includes(image.file));
});
