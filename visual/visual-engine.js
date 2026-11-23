(function (root) {
  'use strict';
  function getCards(levelId, vocabulary, images, records) {
    const cards = [];
    for (const image of images || []) {
      for (const binding of image.bindings) {
        if (binding.levelId !== levelId) continue;
        const matches = vocabulary.filter(item => item.word === binding.word);
        if (matches.length !== 1 || matches[0].meaning !== binding.sourceMeaning) continue;
        cards.push({ imageId: image.id, file: image.file, meaning: binding.meaning,
          word: binding.word, displayWord: binding.displayWord, levelId,
          language: levelId.startsWith('english_') ? 'en' : 'ko',
          exercise: root.SentenceEngine.createExercise(levelId, binding.word, vocabulary, records) });
      }
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
