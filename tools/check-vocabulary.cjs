// Read-only validation; never generates or edits vocabulary files.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const data = { window: {} };
const files = ['flashcard1.js', 'flashcard2.js', 'flashcard_en_a1.js', 'flashcard_en_a2.js', 'flashcard_en_b1.js', 'flashcard_en_b2.js'];
for (const file of [...files, 'vocabulary-catalog.js']) vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), data, { filename: file });
const result = data.window.VocabularyCatalog.refresh();
let errors = 0;
for (const issue of result.issues) {
  // Existing source-data problems are reported, not silently corrected by migration.
  const legacy = issue.reason === 'invalid_vocabulary' || issue.reason === 'duplicate_word';
  console.log(`${legacy ? 'WARN' : 'ERROR'} ${issue.levelId} ${issue.word}: ${issue.reason}`);
  if (!legacy) errors++;
}
for (const image of result.images) {
  if (!fs.existsSync(path.join(root, image.file))) { console.error('ERROR missing image: ' + image.file); errors++; }
}
for (const [level, key] of Object.entries(data.window.VocabularyCatalog.levels)) {
  const images = result.images.flatMap(image => image.bindings).filter(binding => binding.levelId === level).length;
  const exercises = result.exercises.filter(row => row.levelId === level).length;
  console.log(`${level}: ${data.window[key].length} entries, ${images} image bindings, ${exercises} sentence exercises`);
}
console.log(`${result.images.length} shared images; ${errors} errors.`);
process.exitCode = errors ? 1 : 0;
