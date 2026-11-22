const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({ window: {} });
for (const file of ['flashcard1.js', 'flashcard2.js', 'flashcard_en_a1.js',
  'flashcard_en_a2.js', 'flashcard_en_b1.js', 'flashcard_en_b2.js',
  'vocabulary-catalog.js', 'sentence-engine.js']) {
  if(file === 'vocabulary-catalog.js') Object.assign(context.window, JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/vocabulary.json'),'utf8')));
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
}
const { SentenceEngine: engine, sentenceExercises: records, flashVocabData1: vocab } = context.window;
const create = (word, items = vocab, data = records) => engine.createExercise('topik1', word, items, data);

test('all pilot targets reconstruct their original sentence without mutating source data', () => {
  const before = JSON.stringify({ vocab, records });
  assert.equal(records.filter(row => row.levelId === 'topik1').length, 20);
  for (const record of records.filter(row => row.levelId === 'topik1')) {
    const exercise = create(record.word);
    assert.equal(exercise.status, 'ready');
    assert.equal(exercise.before + exercise.targetAnswer + exercise.after, record.sourceSentence);
    assert.equal(engine.checkAnswer(exercise, record.targetAnswer).status, 'correct');
  }
  assert.equal(JSON.stringify({ vocab, records }), before);
});

test('conjugation, whitespace, Unicode and punctuation', () => {
  const exercise = create('가깝다');
  assert.equal(exercise.blankedSentence, '우리 집은 역에서 _____.');
  assert.equal(engine.checkAnswer(exercise, '가깝다').status, 'incorrect');
  assert.equal(engine.checkAnswer(exercise, ' 가까워요 '.normalize('NFD')).status, 'correct');
  assert.equal(engine.checkAnswer(exercise, '가까워요.').status, 'incorrect');
  assert.equal(engine.checkAnswer(exercise, '  ').status, 'empty');
});

test('missing, unreviewed, duplicate and changed data cannot become playable', () => {
  assert.equal(create('missing').reason, 'missing_word');
  assert.equal(create('가게', [{ word: '가게' }]).reason, 'missing_sentence');
  assert.equal(create('가게', vocab, []).reason, 'needs_review');
  assert.equal(create('가게', [...vocab, vocab[0]]).reason, 'ambiguous_word');
  assert.equal(create('가게', vocab, [...records, records[0]]).reason, 'ambiguous_exercise');
  assert.equal(create('가게', [{ ...vocab[0], sentense: 'changed' }]).reason, 'stale_source');
  assert.equal(create('가게', [{ ...vocab[0], meaning: 'changed' }]).reason, 'stale_source');
  assert.equal(create('가게', vocab, [{ ...records[0], start: -1 }]).reason, 'invalid_target');
  assert.equal(engine.checkAnswer(create('missing'), 'anything').status, 'unavailable');
});

test('sentence alias and explicit repeated-word span (test fixture only)', () => {
  const items = [{ word: 'go', meaning: 'ไป', sentense: ' ', sentence: 'Go, then go.' }];
  const data = [{ levelId: 'english_a1', word: 'go', sourceMeaning: 'ไป',
    sourceSentence: 'Go, then go.', start: 9, end: 11, targetAnswer: 'go', status: 'verified' }];
  const exercise = engine.createExercise('english_a1', 'go', items, data);
  assert.equal(exercise.blankedSentence, 'Go, then _____.');
  assert.equal(engine.checkAnswer(exercise, ' GO ').status, 'correct');
});

test('real catalog skips missing sentences and validates all ready exercises', () => {
  const context = vm.createContext({window:{}});
  for(const file of ['flashcard1.js','flashcard2.js','flashcard_en_a1.js','flashcard_en_a2.js','flashcard_en_b1.js','flashcard_en_b2.js','vocabulary-catalog.js','sentence-engine.js']) vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'), context);
  const engine=context.window.SentenceEngine, records=context.window.sentenceExercises;
  const levels = { topik1: 'flashVocabData1', topik2: 'flashVocabData2',
    english_a1: 'flashVocabDataEnA1', english_a2: 'flashVocabDataEnA2',
    english_b1: 'flashVocabDataEnB1', english_b2: 'flashVocabDataEnB2' };
  let ready = 0;
  for (const [level, key] of Object.entries(levels)) {
    const items = context.window[key];
    for (const item of items) {
      const result = engine.createExercise(level, item.word, items, records);
      if (result.status === 'ready') ready++;
      if (!engine.readSentence(item)) assert.notEqual(result.status, 'ready');
    }
  }
  assert.equal(ready, records.length);
  assert.ok(records.some(record => record.levelId.startsWith('english_')));
});

test('browser scripts and offline cache include both new modules', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  for (const file of ['sentence-engine.js', 'vocabulary-catalog.js']) {
    assert.ok(html.includes('src="' + file + '"'));
    assert.ok(sw.includes('"' + file + '"'));
  }
});
