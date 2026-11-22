/* One source per level: the existing flashcard files. Derived data is never edited. */
(function (root) {
  'use strict';
  const levels = {
    topik1: 'flashVocabData1', topik2: 'flashVocabData2',
    english_a1: 'flashVocabDataEnA1', english_a2: 'flashVocabDataEnA2',
    english_b1: 'flashVocabDataEnB1', english_b2: 'flashVocabDataEnB2'
  };
  function build(data) {
    const images = new Map(), exercises = [], issues = [];
    for (const [levelId, key] of Object.entries(levels)) {
      const rows = data[key] || [];
      const counts = new Map();
      for (const row of rows) counts.set(row.word, (counts.get(row.word) || 0) + 1);
      for (const row of rows) {
        const issue = reason => issues.push({ levelId, word: row.word || '', reason });
        if (typeof row.word !== 'string' || !row.word.trim() || typeof row.meaning !== 'string' || !row.meaning.trim()) {
          issue('invalid_vocabulary'); continue;
        }
        if (counts.get(row.word) !== 1) { issue('duplicate_word'); continue; }
        if (row.imageId !== undefined) {
          const id = row.imageId, extension = row.imageExtension || 'webp';
          if (typeof id !== 'string' || !/^\d{4,}$/.test(id) || !['webp', 'png'].includes(extension)) issue('invalid_image');
          else {
            const file = `visual/images/${id}.${extension}`;
            if (images.has(id) && images.get(id).file !== file) issue('conflicting_image_extension');
            else {
              if (!images.has(id)) images.set(id, { id, file, bindings: [] });
              images.get(id).bindings.push({ levelId, word: row.word, sourceMeaning: row.meaning,
                meaning: row.meaning, displayWord: row.displayWord || row.word });
            }
          }
        }
        if (row.sentenceAnswer === undefined) continue;
        const sentence = [row.sentense, row.sentence].find(value => typeof value === 'string' && value.trim());
        const answer = row.sentenceAnswer;
        if (!sentence) { issue('missing_sentence'); continue; }
        if (typeof answer !== 'string' || !answer.trim()) { issue('invalid_answer'); continue; }
        const positions = [];
        for (let pos = sentence.indexOf(answer); pos !== -1; pos = sentence.indexOf(answer, pos + 1)) positions.push(pos);
        const occurrence = row.sentenceOccurrence;
        if (occurrence === undefined && positions.length !== 1) { issue(positions.length ? 'ambiguous_target' : 'missing_target'); continue; }
        const selected = occurrence === undefined ? 1 : occurrence;
        if (!Number.isInteger(selected) || selected < 1 || selected > positions.length) { issue('invalid_occurrence'); continue; }
        const acceptedAnswers = row.sentenceAcceptedAnswers || [];
        if (!Array.isArray(acceptedAnswers) || acceptedAnswers.some(value => typeof value !== 'string' || !value.trim())) { issue('invalid_answers'); continue; }
        const start = positions[selected - 1];
        exercises.push({ levelId, word: row.word, sourceMeaning: row.meaning, sourceSentence: sentence,
          start, end: start + answer.length, targetAnswer: answer, acceptedAnswers, status: 'verified' });
      }
    }
    return { images: [...images.values()], exercises, issues };
  }
  function refresh() {
    const result = build(root);
    root.visualImageMap = result.images;
    root.sentenceExercises = result.exercises;
    return result;
  }
  root.VocabularyCatalog = Object.freeze({ levels, build, refresh });
  refresh();
})(typeof window !== 'undefined' ? window : globalThis);
