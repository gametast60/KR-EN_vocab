/* Independent, in-memory Visual Recall session. Never writes to SRS/storage. */
(function () {
  'use strict';
  const el = id => document.getElementById(id);
  const show = (id, value) => el(id).classList.toggle('hidden', !value);
  const titles = ['', 'Stage 1 · เรียนรู้ภาพและคำศัพท์', 'Stage 2 · นึกความหมาย', 'Stage 3 · พิมพ์คำศัพท์', 'Stage 4 · เรียนรู้ประโยค', 'Stage 5 · เติมคำในประโยค'];
  const hints = ['', 'ดูภาพ อ่านความหมาย และฟังเสียงให้คุ้นเคยก่อนกดต่อไป',
    'ลองนึกความหมายด้วยตัวเองก่อนเปิดเฉลย แล้วประเมินว่านึกออกหรือไม่',
    'ดูภาพและความหมาย แล้วพิมพ์คำศัพท์โดยไม่เปิดเฉลย',
    'เรียนรู้คำฐาน รูปคำที่ใช้จริง และประโยคเต็ม ฟังซ้ำได้ก่อนกดถัดไป',
    'เติมรูปคำตามประโยคที่เรียนใน Stage 4'];
  let available = [], cards = [], queue = [], results = [], stage = 0, index = 0, phase = 'setup';
  let retryCards = [], nextStage = 0;
  const current = () => queue[index];
  let autoSpeak = true;
  function stopAudio() { window.speechSynthesis?.cancel(); }
  function readCurrent() {
    if (!current() || !['learn', 'answer', 'recognition', 'review'].includes(phase) ||
        (stage >= 3 && phase === 'answer')) return;
    if (!window.speechSynthesis || typeof speak !== 'function') {
      el('vrAudioNotice').textContent = 'เบราว์เซอร์นี้ยังไม่รองรับการอ่านเสียง'; return;
    }
    try {
      const language = current().language === 'en' ? 'en-US' : 'ko-KR';
      if (stage === 4) {
        speakSequence([current().displayWord, current().exercise.targetAnswer, current().exercise.sentence], language);
      } else if (stage === 5) {
        speakSequence([current().exercise.targetAnswer, current().exercise.sentence], language);
      } else speak(current().displayWord, language);
    } catch (_) { el('vrAudioNotice').textContent = 'ยังเล่นเสียงไม่ได้ ลองกดฟังอีกครั้ง'; }
  }

  const totalTasks = () => cards.length * 3 + 2 * cards.filter(card => card.exercise.status === 'ready').length;
  function updateJourney() {
    const total = totalTasks();
    show('vrOverall', phase !== 'setup');
    el('vrOverallText').textContent = `ทำแล้ว ${results.length} / ${total} ข้อ · ${total ? Math.round(results.length / total * 100) : 0}% ของรอบ`;
    el('vrOverallMeter').max = total || 1; el('vrOverallMeter').value = results.length;
    for (let s = 1; s <= 5; s++) {
      const count = s >= 4 ? cards.filter(card => card.exercise.status === 'ready').length : cards.length;
      const done = count > 0 && results.filter(row => row.stage === s).length === count;
      const step = el(`vrStep${s}`);
      const active = phase !== 'setup' && phase !== 'summary' && stage === s && !done;
      step.classList.toggle('is-current', active);
      step.classList.toggle('is-done', done);
      step.classList.toggle('is-unavailable', phase !== 'setup' && s >= 4 && !count);
      if (active) step.setAttribute('aria-current', 'step'); else step.removeAttribute('aria-current');
    }
  }

  function stageResult(s) {
    const rows = results.filter(row => row.stage === s);
    const count = status => rows.filter(row => row.status === status).length;
    const total = s >= 4 ? cards.filter(card => card.exercise.status === 'ready').length : cards.length;
    return s === 1 || s === 4 ? `Stage ${s}: เรียนแล้ว ${rows.length}/${total} ${s === 4 ? 'ประโยค' : 'คำ'}`
      : s === 2 ? `Stage 2: นึกออก ${count('known')} · นึกไม่ออก ${count('unknown')} · ข้าม ${count('skipped')} · ยังไม่ได้ทำ ${total - rows.length}`
      : `Stage ${s}: ถูก ${count('correct')} · ผิด ${count('incorrect')} · เฉลย ${count('revealed')} · ข้าม ${count('skipped')} · ยังไม่ได้ทำ ${total - rows.length}`;
  }

  function stageComplete() {
    stopAudio();
    phase = 'transition'; nextStage = stage + 1;
    const noSentences = nextStage === 4 && !cards.some(card => card.exercise.status === 'ready');
    show('vrPlay', false); show('vrTransition', true);
    el('vrTransitionTitle').textContent = `จบ Stage ${stage} แล้ว`;
    el('vrTransitionResult').textContent = stageResult(stage);
    el('vrTransitionHint').textContent = nextStage > 5 ? 'ครบทุกด่านแล้ว ไปดูผลและเลือกคำที่ต้องการฝึกซ้ำได้เลย'
      : noSentences ? 'ชุดนี้ยังไม่มีโจทย์ประโยคพร้อมใช้ จึงข้าม Stage 4–5 โดยไม่คิดเป็นคำตอบผิด'
      : `${titles[nextStage]} — ${hints[nextStage]}` + (nextStage === 4 ? ` (พร้อม ${cards.filter(card => card.exercise.status === 'ready').length}/${cards.length} คำ)` : '');
    el('vrContinue').textContent = nextStage > 5 || noSentences ? 'ดูผลการเรียน' : `เริ่ม Stage ${nextStage}`;
    updateJourney(); el('vrContinue').focus();
  }

  function prepare() {
    stopAudio();
    phase = 'setup'; stage = 0;
    results = []; cards = []; retryCards = [];
    const level = el('vrLevel').value;
    available = VisualEngine.getCards(level, getTopikVocab(level), window.visualImageMap, window.sentenceExercises);
    const limit = Math.min(Number(el('vrLimit').value), available.length);
    const ready = available.slice(0, limit).filter(card => card.exercise.status === 'ready').length;
    el('vrAvailable').textContent = available.length
      ? `มีภาพ ${available.length} คำ · รอบนี้ ${limit} คำ · Stage 4–5 พร้อม ${ready} คำ (ข้าม ${limit - ready} คำที่ยังไม่มีโจทย์พร้อมใช้)`
      : 'ชุดนี้ยังไม่มีภาพที่จับคู่พร้อมใช้ เลือกชุดคำศัพท์อื่นได้';
    el('vrStart').disabled = !limit;
    show('vrSetup', true); show('vrPlay', false); show('vrSummary', false);
    show('vrTransition', false); updateJourney();
  }

  function open() {
    results = []; cards = [];
    goTo('visualRecall'); el('appTitle').textContent = 'Visual Recall · เรียนศัพท์ด้วยภาพ'; prepare();
  }

  function startStage(next) {
    stage = next; index = 0;
    queue = stage >= 4 ? cards.filter(card => card.exercise.status === 'ready') : cards;
    if (stage > 5 || !queue.length) return finish();
    render();
  }

  function render() {
    stopAudio();
    const card = current(); phase = stage === 1 || stage === 4 ? 'learn' : 'answer';
    show('vrSetup', false); show('vrSummary', false); show('vrPlay', true);
    show('vrTransition', false);
    el('vrStage').textContent = titles[stage];
    el('vrStageHint').textContent = hints[stage];
    el('vrProgress').textContent = `คำที่ ${index + 1} / ${queue.length}`;
    el('vrMeter').max = queue.length; el('vrMeter').value = index;
    el('vrWord').textContent = stage < 3 ? card.displayWord : '';
    el('vrWord').lang = card.language;
    show('vrConjugation', stage === 4);
    el('vrBaseWord').textContent = stage === 4 ? card.displayWord : '';
    el('vrInflectedWord').textContent = stage === 4 ? card.exercise.targetAnswer : '';
    el('vrConjugation').lang = card.language;
    el('vrMeaning').textContent = stage === 1 || stage === 3 ? card.meaning : stage === 5 ? card.exercise.translation : '';
    el('vrSentence').textContent = stage === 5 ? card.exercise.blankedSentence : '';
    if (stage === 4) {
      el('vrMeaning').textContent = card.exercise.translation;
      const before = document.createElement('span'); before.textContent = card.exercise.before;
      const target = document.createElement('mark'); target.textContent = card.exercise.targetAnswer;
      const after = document.createElement('span'); after.textContent = card.exercise.after;
      el('vrSentence').replaceChildren(before, target, after);
    }
    el('vrSentence').lang = card.language;
    show('vrImageWrap', stage === 1 || stage === 3);
    show('vrImageError', false); show('vrImage', true);
    el('vrImage').src = card.file;
    show('vrSpeak', stage === 1 || stage === 2 || stage === 4);
    show('vrForm', stage === 3 || stage === 5);
    el('vrAnswerLabel').textContent = stage === 5 ? 'เติมรูปคำตามประโยคที่เรียน' : 'พิมพ์คำศัพท์จากภาพและความหมาย';
    el('vrAnswer').value = ''; el('vrAnswer').disabled = false; el('vrAnswer').lang = card.language;
    el('vrCheck').disabled = false; el('vrFeedback').textContent = '';
    el('vrFeedback').removeAttribute('data-result');
    el('vrAudioNotice').textContent = '';
    el('vrSpeak').textContent = stage === 5 ? '🔊 ฟังคำตอบและประโยคอีกครั้ง' : '🔊 ฟังอีกครั้ง';
    if (stage === 4) el('vrSpeak').textContent = '🔊 ฟังคำฐาน รูปคำ และประโยค';
    show('vrReveal', phase === 'answer'); show('vrSkip', phase === 'answer');
    show('vrKnown', false); show('vrUnknown', false); show('vrNext', phase === 'learn');
    el('vrNext').textContent = index + 1 === queue.length ? `สรุป Stage ${stage}` : 'คำถัดไป';
    updateJourney();
    if (stage === 3 || stage === 5) el('vrAnswer').focus(); else el(phase === 'learn' ? 'vrNext' : 'vrReveal').focus();
    if (autoSpeak && (stage <= 2 || stage === 4)) readCurrent();
  }

  function revealContent() {
    const card = current();
    el('vrWord').textContent = card.displayWord;
    el('vrMeaning').textContent = card.meaning;
    if (stage === 2) show('vrImageWrap', true);
    if (stage === 5) el('vrSentence').textContent = card.exercise.sentence;
    show('vrSpeak', true);
  }

  function settle(status, answer = '') {
    if (!['answer', 'recognition'].includes(phase)) return;
    phase = 'review';
    const card = current(); results.push({ stage, card, status, answer });
    const labels = { correct: 'ถูกต้อง', incorrect: 'ยังไม่ถูก', known: 'นึกออก', unknown: 'ยังนึกไม่ออก', revealed: 'เปิดเฉลย', skipped: 'ข้ามแล้ว' };
    if (stage === 5) labels.incorrect = 'ยังไม่ตรงกับรูปที่เรียน';
    const target = stage === 5 ? card.exercise.targetAnswer : stage === 2 ? card.meaning : card.displayWord;
    el('vrFeedback').textContent = `${labels[status]} · ${target}`;
    el('vrFeedback').setAttribute('data-result', status);
    revealContent(); el('vrAnswer').disabled = true; el('vrCheck').disabled = true;
    for (const id of ['vrReveal', 'vrSkip', 'vrKnown', 'vrUnknown']) show(id, false);
    el('vrMeter').value = index + 1; show('vrNext', true); el('vrNext').focus();
    updateJourney();
    if (autoSpeak && stage >= 3) readCurrent();
  }

  function finish() {
    stopAudio();
    phase = 'summary';
    show('vrTransition', false); updateJourney();
    show('vrSetup', false); show('vrPlay', false); show('vrSummary', true);
    el('vrSummaryTitle').textContent = results.length === totalTasks() ? 'เรียนครบทั้งรอบแล้ว' : 'สรุปผลก่อนจบรอบ';
    const ready = cards.filter(card => card.exercise.status === 'ready').length;
    el('vrCoverage').textContent = `เรียน ${cards.length} คำ · Stage 4–5 พร้อม ${ready} คำ · ข้ามเพราะโจทย์ยังไม่พร้อม ${cards.length - ready} คำ`;
    const scores = el('vrScores'); scores.replaceChildren();
    for (let s = 1; s <= 5; s++) {
      const li = document.createElement('li');
      li.textContent = stageResult(s);
      scores.appendChild(li);
    }
    const review = el('vrReview'); review.replaceChildren();
    const retryIds = new Set();
    for (const row of results.filter(row => ['incorrect', 'unknown', 'revealed', 'skipped'].includes(row.status))) {
      retryIds.add(row.card.imageId);
      const li = document.createElement('li');
      li.textContent = `Stage ${row.stage}: ${row.card.displayWord} — ${row.card.meaning}` +
        (row.stage === 5 ? ` · คำตอบ ${row.card.exercise.targetAnswer}` : '') +
        (row.status === 'incorrect' ? ` (คุณตอบ: ${row.answer})` : '');
      review.appendChild(li);
    }
    if (!review.children.length) {
      const li = document.createElement('li'); li.textContent = 'ไม่มีรายการที่ต้องฝึกซ้ำจากข้อที่ทำแล้ว'; review.appendChild(li);
    }
    retryCards = cards.filter(card => retryIds.has(card.imageId));
    show('vrRetry', retryCards.length > 0);
    el('vrRetry').textContent = `ฝึกซ้ำ ${retryCards.length} คำที่ยังติดขัด`;
    el('vrSummary').focus();
  }

  el('vrLevel').addEventListener('change', prepare);
  el('vrLimit').addEventListener('change', prepare);
  el('vrStart').addEventListener('click', () => {
    if (phase !== 'setup' || !available.length) return;
    cards = available.slice(0, Number(el('vrLimit').value)); results = []; startStage(1);
  });
  el('vrNext').addEventListener('click', () => {
    if (phase !== 'learn' && phase !== 'review') return;
    if (phase === 'learn') results.push({ stage, card: current(), status: 'learned' });
    index++;
    if (index === queue.length) stageComplete(); else render();
  });
  el('vrContinue').addEventListener('click', () => {
    if (phase === 'transition') startStage(nextStage);
  });
  el('vrTransitionFinish').addEventListener('click', finish);
  el('vrRetry').addEventListener('click', () => {
    if (phase !== 'summary' || !retryCards.length) return;
    cards = retryCards.slice(); results = []; retryCards = []; startStage(1);
  });
  el('vrReveal').addEventListener('click', () => {
    if (phase !== 'answer') return;
    if (stage === 2) {
      phase = 'recognition'; revealContent(); show('vrReveal', false);
      show('vrKnown', true); show('vrUnknown', true); el('vrKnown').focus();
    } else settle('revealed');
  });
  el('vrKnown').addEventListener('click', () => { if (phase === 'recognition') settle('known'); });
  el('vrUnknown').addEventListener('click', () => { if (phase === 'recognition') settle('unknown'); });
  el('vrSkip').addEventListener('click', () => settle('skipped'));
  el('vrForm').addEventListener('submit', event => {
    event.preventDefault(); if (phase !== 'answer' || stage < 3) return;
    const answer = el('vrAnswer').value;
    const result = stage === 5 ? SentenceEngine.checkAnswer(current().exercise, answer) : VisualEngine.checkWord(current(), answer);
    if (result.status === 'empty') { el('vrFeedback').textContent = 'พิมพ์คำตอบก่อน หรือเลือกข้าม'; return; }
    settle(result.status, answer);
  });
  el('vrAnswer').addEventListener('keydown', event => {
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229)) event.preventDefault();
  });
  el('vrSpeak').addEventListener('click', readCurrent);
  el('vrAutoSpeak').addEventListener('click', () => {
    autoSpeak = !autoSpeak;
    el('vrAutoSpeak').setAttribute('aria-pressed', String(autoSpeak));
    el('vrAutoSpeak').textContent = autoSpeak ? '🔊 อ่านอัตโนมัติ: เปิด' : '🔇 อ่านอัตโนมัติ: ปิด';
    if (!autoSpeak) stopAudio();
  });
  el('vrImage').addEventListener('error', () => { show('vrImage', false); show('vrImageError', true); });
  el('vrImage').addEventListener('load', () => { show('vrImage', true); show('vrImageError', false); });
  el('vrFinish').addEventListener('click', finish);
  el('vrAgain').addEventListener('click', prepare);
  window.VisualRecall = Object.freeze({ open, stopAudio });
})();
