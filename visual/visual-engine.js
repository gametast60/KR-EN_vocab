(function (root) {
  'use strict';
  function getCards(levelId, vocabulary, images, records) {
    const cards = [];
    const counts = new Map(), pictures = new Map();
    for (const item of vocabulary || []) counts.set(item.word, (counts.get(item.word) || 0) + 1);
    for (const image of images || []) for (const binding of image.bindings) {
      if (binding.levelId === levelId) pictures.set(binding.word, { image, binding });
    }
    for (const item of vocabulary || []) {
      if (typeof item.word !== 'string' || !item.word.trim() || typeof item.meaning !== 'string' || !item.meaning.trim() || counts.get(item.word) !== 1) continue;
      const picture = pictures.get(item.word);
      const validImage = picture && picture.binding.sourceMeaning === item.meaning;
      cards.push({ id: item._id || `${levelId}|${encodeURIComponent(item.word)}`,
        imageId: validImage ? picture.image.id : null, file: validImage ? picture.image.file : null,
        meaning: item.meaning, word: item.word, displayWord: item.displayWord || item.word, levelId,
        language: levelId.startsWith('english_') ? 'en' : 'ko',
        exercise: root.SentenceEngine.createExercise(levelId, item.word, vocabulary, records) });
    }
    return cards;
  }
  // Parenthetical notes are context, not part of a five-stage answer.
  function withoutNotes(value) {
    let text = String(value ?? '');
    let previous;
    do {
      previous = text;
      text = text.replace(/\([^()]*\)|（[^（）]*）/g, ' ');
    } while (text !== previous);
    return text.replace(/\s+/g, ' ').trim();
  }
  function checkWord(card, answer) {
    const normalized = root.SentenceEngine.normalizeAnswer(withoutNotes(answer), card.language);
    if (!normalized) return { status: 'empty' };
    return { status: normalized === root.SentenceEngine.normalizeAnswer(withoutNotes(card.displayWord), card.language) ? 'correct' : 'incorrect' };
  }
  function checkSentence(exercise, answer) {
    if (!exercise || exercise.status !== 'ready') return root.SentenceEngine.checkAnswer(exercise, answer);
    return root.SentenceEngine.checkAnswer({ ...exercise,
      acceptedAnswers: exercise.acceptedAnswers.map(withoutNotes)
    }, withoutNotes(answer));
  }
  root.VisualEngine = Object.freeze({ getCards, checkWord, checkSentence });
})(typeof window !== 'undefined' ? window : globalThis);
