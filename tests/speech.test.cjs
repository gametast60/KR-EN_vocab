const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('speech queues word then sentence in KR/EN and replay replaces the entire queue', () => {
  let queue = [], cancels = 0;
  const context = vm.createContext({
    currentTopik: 'topik1',
    speechSynthesis: { cancel() { queue = []; cancels++; }, speak(item) { queue.push(item); } },
    SpeechSynthesisUtterance: function (text) { this.text = text; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../game.js'), 'utf8'), context);
  for (const [word, sentence, language] of [
    ['가까워요', '우리 집은 역에서 가까워요.', 'ko-KR'],
    ['went', 'I went home.', 'en-US']
  ]) {
    const before = cancels;
    context.speakSequence([word, sentence], language);
    assert.equal(cancels, before + 1);
    assert.deepEqual(queue.map(item => item.text), [word, sentence]);
    assert.ok(queue.every(item => item.lang === language && item.rate === 0.9));
  }
  context.speak('가게');
  assert.deepEqual(queue.map(item => item.text), ['가게']);
  assert.equal(queue[0].lang, 'ko-KR');
  context.speechSynthesis.cancel();
  assert.equal(queue.length, 0);
});
