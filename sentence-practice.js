/* A session lives only in memory. This controller never updates SRS or storage. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  let exercises = [], outcomes = [], index = 0, phase = 'setup';
  const show = (id, visible) => el(id).classList.toggle('hidden', !visible);

  function prepare() {
    phase = 'setup';
    const level = el('spLevel').value;
    const vocabulary = getTopikVocab(level);
    exercises = vocabulary.map(item => SentenceEngine.createExercise(level, item.word, vocabulary, window.sentenceExercises))
      .filter(exercise => exercise.status === 'ready');
    const missing = vocabulary.filter(item => !SentenceEngine.readSentence(item)).length;
    el('spAvailability').textContent = `พร้อมฝึก ${exercises.length} ข้อ · ไม่มีประโยค ${missing} รายการ · รอตรวจคำตอบ ${vocabulary.length - missing - exercises.length} รายการ`;
    el('spStart').disabled = !exercises.length;
    if (!exercises.length) el('spAvailability').textContent += ' — ชุดนี้ยังไม่มีโจทย์พร้อมฝึก';
    show('spSetup', true); show('spQuestion', false); show('spSummary', false);
  }

  function open() {
    outcomes = []; index = 0;
    goTo('sentencePractice');
    el('appTitle').textContent = 'Stage 5 · เติมคำในประโยค';
    prepare();
  }

  function render() {
    phase = 'answering';
    const exercise = exercises[index];
    show('spSetup', false); show('spSummary', false); show('spQuestion', true);
    el('spProgress').textContent = `ข้อ ${index + 1} / ${exercises.length}`;
    el('spMeter').max = exercises.length; el('spMeter').value = outcomes.length;
    el('spSentence').textContent = exercise.blankedSentence;
    el('spSentence').lang = exercise.language;
    el('spTranslation').textContent = exercise.translation;
    el('spAnswer').value = ''; el('spAnswer').disabled = false;
    el('spAnswer').lang = exercise.language;
    el('spFeedback').textContent = ''; el('spFullSentence').textContent = '';
    show('spFullSentence', false); show('spNext', false);
    for (const id of ['spCheck', 'spReveal', 'spSkip']) el(id).disabled = false;
    el('spAnswer').focus();
  }

  function settle(status, answer) {
    if (phase !== 'answering') return;
    phase = 'review';
    const exercise = exercises[index];
    outcomes.push({ exercise, status, answer });
    const labels = { correct: 'ถูกต้อง', incorrect: 'ยังไม่ตรงกับรูปที่เรียน', revealed: 'เปิดเฉลย', skipped: 'ข้ามแล้ว' };
    el('spFeedback').textContent = `${labels[status]} · คำตอบ: ${exercise.targetAnswer}`;
    el('spFullSentence').textContent = exercise.sentence;
    el('spFullSentence').lang = exercise.language;
    show('spFullSentence', true);
    el('spAnswer').disabled = true;
    for (const id of ['spCheck', 'spReveal', 'spSkip']) el(id).disabled = true;
    el('spMeter').value = outcomes.length;
    el('spNext').textContent = index + 1 === exercises.length ? 'ดูผลการฝึก' : 'ข้อต่อไป';
    show('spNext', true); el('spNext').focus();
  }

  function finish() {
    phase = 'summary';
    const count = status => outcomes.filter(item => item.status === status).length;
    el('spScore').textContent = `ถูก ${count('correct')} · ผิด ${count('incorrect')} · เปิดเฉลย ${count('revealed')} · ข้าม ${count('skipped')} · ยังไม่ได้ทำ ${exercises.length - outcomes.length} ข้อ`;
    const list = el('spReview'); list.replaceChildren();
    for (const item of outcomes.filter(item => item.status !== 'correct')) {
      const li = document.createElement('li');
      li.textContent = `${item.exercise.blankedSentence} → ${item.exercise.targetAnswer}` +
        (item.status === 'incorrect' ? ` (คุณตอบ: ${item.answer})` : '');
      list.appendChild(li);
    }
    show('spQuestion', false); show('spSummary', true); el('spSummary').focus();
  }

  el('spLevel').addEventListener('change', prepare);
  el('spStart').addEventListener('click', () => {
    if (phase !== 'setup' || !exercises.length) return;
    outcomes = []; index = 0; render();
  });
  el('spForm').addEventListener('submit', event => {
    event.preventDefault();
    if (phase !== 'answering') return;
    const answer = el('spAnswer').value;
    const result = SentenceEngine.checkAnswer(exercises[index], answer);
    if (result.status === 'empty') {
      el('spFeedback').textContent = 'พิมพ์คำตอบก่อน หรือเลือกข้ามข้อนี้';
      el('spAnswer').focus(); return;
    }
    settle(result.status, answer);
  });
  // Enter during Korean IME composition must not submit a partial syllable.
  el('spAnswer').addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
  });
  el('spReveal').addEventListener('click', () => settle('revealed', ''));
  el('spSkip').addEventListener('click', () => settle('skipped', ''));
  el('spNext').addEventListener('click', () => {
    if (phase !== 'review') return;
    index++;
    if (index === exercises.length) finish(); else render();
  });
  el('spFinish').addEventListener('click', finish);
  el('spAgain').addEventListener('click', prepare);
  window.SentencePractice = Object.freeze({ open });
})();
