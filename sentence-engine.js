/* Shared sentence exercises. Pure functions: no DOM, storage, or SRS writes. */
(function (root) {
  'use strict';

  function readSentence(item) {
    if (!item) return '';
    // Preserve the existing popup's field priority, ignoring empty whitespace.
    return [item.sentense, item.sentence].find(value =>
      typeof value === 'string' && value.trim()) || '';
  }

  function normalizeAnswer(value, language) {
    const text = String(value ?? '').normalize('NFC').trim();
    return language === 'en' ? text.toLowerCase() : text;
  }

  function unavailable(reason) {
    return { status: 'unavailable', reason };
  }

  // Vocabulary must be the source array for this level, not an SRS projection.
  function createExercise(levelId, word, vocabulary, records) {
    if (!Array.isArray(vocabulary)) return unavailable('missing_vocabulary');
    const matches = vocabulary.filter(item => item && item.word === word);
    if (matches.length !== 1) return unavailable(matches.length ? 'ambiguous_word' : 'missing_word');
    const item = matches[0];
    const sentence = readSentence(item);
    if (!sentence) return unavailable('missing_sentence');
    const candidates = (Array.isArray(records) ? records : []).filter(record =>
      record && record.levelId === levelId && record.word === word);
    if (candidates.length !== 1) return unavailable(candidates.length ? 'ambiguous_exercise' : 'needs_review');
    const record = candidates[0];
    if (record.status !== 'verified') return unavailable('needs_review');
    if (record.sourceSentence !== sentence || record.sourceMeaning !== item.meaning) {
      return unavailable('stale_source');
    }
    const { start, end, targetAnswer } = record;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start ||
        end > sentence.length || typeof targetAnswer !== 'string' || !targetAnswer.trim() ||
        sentence.slice(start, end) !== targetAnswer) return unavailable('invalid_target');
    const language = levelId.startsWith('english_') ? 'en' : 'ko';
    const alternatives = record.acceptedAnswers || [];
    if (!Array.isArray(alternatives) || alternatives.some(value => typeof value !== 'string' || !value.trim())) {
      return unavailable('invalid_answers');
    }
    return {
      status: 'ready', levelId, word, language, meaning: item.meaning,
      sentence, translation: item.translate || '', targetAnswer,
      before: sentence.slice(0, start), after: sentence.slice(end),
      blankedSentence: sentence.slice(0, start) + '_____' + sentence.slice(end),
      acceptedAnswers: [targetAnswer, ...alternatives]
    };
  }

  function checkAnswer(exercise, answer) {
    if (!exercise || exercise.status !== 'ready') return unavailable('exercise_not_ready');
    const normalized = normalizeAnswer(answer, exercise.language);
    if (!normalized) return { status: 'empty', correct: false };
    const correct = exercise.acceptedAnswers.some(value =>
      normalizeAnswer(value, exercise.language) === normalized);
    return { status: correct ? 'correct' : 'incorrect', correct, targetAnswer: exercise.targetAnswer };
  }

  root.SentenceEngine = Object.freeze({ readSentence, normalizeAnswer, createExercise, checkAnswer });
})(typeof window !== 'undefined' ? window : globalThis);
