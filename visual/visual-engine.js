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
  function checkWord(card, answer) {
    const normalized = root.SentenceEngine.normalizeAnswer(answer, card.language);
    if (!normalized) return { status: 'empty' };
    return { status: normalized === root.SentenceEngine.normalizeAnswer(card.displayWord, card.language) ? 'correct' : 'incorrect' };
  }
  root.VisualEngine = Object.freeze({ getCards, checkWord });
})(typeof window !== 'undefined' ? window : globalThis);
