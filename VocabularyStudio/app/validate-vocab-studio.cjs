// Validate staged sources against the real catalog before committing a batch.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const [stage, root] = process.argv.slice(2);
const files = ['flashcard1.js','flashcard2.js','flashcard_en_a1.js','flashcard_en_a2.js','flashcard_en_b1.js','flashcard_en_b2.js'];
function readCatalog(folder) {
  const context = {window:{}};
  for (const file of files) vm.runInNewContext(fs.readFileSync(path.join(folder,file),'utf8'),context,{filename:file,timeout:3000});
  vm.runInNewContext(fs.readFileSync(path.join(root,'vocabulary-catalog.js'),'utf8'),context,{timeout:3000});
  return context.window.VocabularyCatalog.refresh();
}
try {
  const before=readCatalog(root), after=readCatalog(stage);
  const counts = new Map();
  for(const issue of before.issues) {const key=JSON.stringify(issue);counts.set(key,(counts.get(key)||0)+1);}
  for(const issue of after.issues) {
    const key=JSON.stringify(issue);
    if ((counts.get(key)||0)>0) counts.set(key,counts.get(key)-1);
    else throw Error('New catalog issue: '+key);
  }
  const assets=new Set(JSON.parse(fs.readFileSync(path.join(stage,'assets.json'),'utf8')));
  for(const image of after.images) if(!assets.has(image.file)&&!fs.existsSync(path.join(root,image.file))) throw Error('Missing image: '+image.file);
  console.log(`Validated: ${after.images.length} images, ${after.exercises.length} exercises; no new catalog issues.`);
} catch(e) {console.error(e.message);process.exitCode=1;}
