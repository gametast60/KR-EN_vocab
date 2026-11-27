// Uses isolated browser storage. No personal study data is read or changed.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createServer}=require('../tools/serve.cjs');
const output=process.env.GRAMMAR_TEST_OUTPUT||path.join(require('node:os').tmpdir(),'grammar-mobile-qa');fs.mkdirSync(output,{recursive:true});
(async()=>{const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));const url=`http://127.0.0.1:${server.address().port}`;
 await page.goto(url+'/#grammar-today');await page.getByRole('heading',{name:'ต่อคำให้เป็นประโยค'}).waitFor();
 await page.screenshot({path:path.join(output,'grammar-today-mobile.png'),fullPage:true});
 for(const width of [320,390,768,1280]){await page.setViewportSize({width,height:844});for(const route of ['grammar-today','grammar-library','grammar-progress','settings']){await page.goto(url+'/#'+route);await page.locator('#main h1').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflows ${width}`);}}
 await page.setViewportSize({width:390,height:844});await page.goto(url+'/#grammar-library');await page.selectOption('#grammar-track','topik2');assert.ok((await page.locator('#main').innerText()).includes('148 รายการ'));assert.equal(await page.locator('[data-g-action=overview]').count(),0);await page.selectOption('#grammar-track','topik1');assert.equal(await page.locator('[data-g-action=overview]').count(),12);
 await page.locator('[data-g-action=overview]').first().click();await page.getByRole('button',{name:'ฝึกพร้อมคำอธิบาย',exact:true}).click();await page.locator('#g-answer').fill('예');await page.reload();assert.equal(await page.locator('#g-answer').inputValue(),'예');
 await page.getByRole('button',{name:'กลับบทเรียน',exact:true}).click();await page.locator('[data-g-action=checkpoint]').click();
 await page.locator('#g-answer').fill('가');const allowed=await page.locator('#g-answer').evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));assert.equal(allowed,false);
 await page.locator('[data-g-action=pause]').click();await page.reload();await page.locator('[data-g-action=resume]').click();assert.equal(await page.locator('#g-answer').inputValue(),'가');
 const initialIds=await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.session.questions.map(q=>q.id));
 async function answerAll(wrong=[]){let count=0;while(await page.locator('#grammar-answer').count()){const q=await page.evaluate(()=>{const s=JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.session;return {...s.questions[s.cursor],cursor:s.cursor};});const answer=wrong.includes(q.cursor)?q.type==='choice'?q.choices.find(c=>!q.accepted.includes(c)):'틀림':q.accepted[0];if(q.type==='type')await page.locator('#g-answer').fill(answer);else await page.getByRole('radio',{name:answer,exact:true}).check();await page.locator('#grammar-answer button[type=submit]').click();if(++count>10)throw Error('Question loop');}}
 await answerAll([8,9]);assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.items['ko.stem.basic'].stage),0);
 await page.locator('[data-g-action=repair]').click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.guided.questionIds.length),2);
 for(let n=0;n<2;n++){const q=await page.evaluate(()=>{const g=JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.guided;return GrammarContent.lessons.find(l=>l.id===g.id).questions.find(q=>q.id===g.questionIds[g.cursor]);});await page.getByRole('radio',{name:q.accepted[0],exact:true}).check();await page.locator('#guided-answer button[type=submit]').click();await page.locator('[data-g-action=guided-next]').click();}
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.items['ko.stem.basic'].stage),0,'repair cannot turn a failed checkpoint into a pass');
 await page.locator('[data-g-action=checkpoint]').click();
 const retryIds=await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.session.questions.map(q=>q.id));assert.ok(retryIds.every(id=>!initialIds.includes(id)));await answerAll();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.items['ko.stem.basic'].stage),1);
 await page.screenshot({path:path.join(output,'grammar-result-mobile.png'),fullPage:true});
 await page.locator('[data-g-action=today]').click();
 const due=await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.items['ko.stem.basic'].dueAt);await page.clock.install({time:new Date(due+1000)});await page.reload();await page.locator('[data-g-action=review]').first().click();assert.equal(await page.locator('#main .feedback').count(),0);
 await page.locator('#g-answer').fill('예약하');await page.reload();assert.equal(await page.locator('#g-answer').inputValue(),'예약하');
 await page.screenshot({path:path.join(output,'grammar-review-mobile.png'),fullPage:true});await answerAll();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.items['ko.stem.basic'].stage),2);
 // Invalidating the result rolls back a promotion and keeps the original due date.
 await page.locator('[data-g-action=report]').click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.items['ko.stem.basic'].stage),1);
 await page.goto(url+'/#grammar-progress');await page.screenshot({path:path.join(output,'grammar-progress-mobile.png'),fullPage:true});
 // A content revision during a paused block invalidates it without changing the schedule.
 await page.locator('[data-g-action=overview]').first().click();await page.locator('[data-g-action=practice]').click();
 await page.evaluate(()=>GrammarContent.lessons.find(l=>l.id==='ko.stem.basic').fingerprint='updated-content');
 await page.goto(url+'/#grammar-today');await page.locator('[data-g-action=resume]').click();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.session.result.status),'invalidated');
 await page.locator('[data-g-action=today]').click();
 // Old word UI is still available through the subject switch.
 await page.locator('[data-mode=vocabulary]').click();await page.getByRole('heading',{name:'ค่อย ๆ จำได้ มากขึ้นทุกวัน'}).waitFor();
 await page.goto(url+'/#settings');const downloadPromise=page.waitForEvent('download');await page.locator('[data-action=backup]').click();const download=await downloadPromise,backupFile=path.join(output,'backup.json');await download.saveAs(backupFile);const backup=JSON.parse(fs.readFileSync(backupFile,'utf8'));assert.equal(backup.data.grammar.items['ko.stem.basic'].stage,1);assert.ok(backup.data.grammar.session);
 await page.locator('#restore-file').setInputFiles(backupFile);await page.locator('[data-action=confirm-restore]').click();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).grammar.items['ko.stem.basic'].stage),1);
 assert.deepEqual(errors,[]);
 // Actual service worker installation and an offline grammar reload.
 const offline=await browser.newContext({viewport:{width:390,height:844}}),p=await offline.newPage();p.on('pageerror',e=>errors.push(e.message));await p.goto(url+'/#grammar-library');await p.evaluate(()=>navigator.serviceWorker.ready);await p.reload();await p.waitForFunction(()=>!!navigator.serviceWorker.controller);await offline.setOffline(true);await p.reload();await p.locator('[data-g-action=overview]').first().click();await p.getByRole('button',{name:'ฝึกพร้อมคำอธิบาย',exact:true}).waitFor();assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,checks:['responsive','TOPIK tracks','guided reload','IME','pause/resume','split checkpoint','targeted repair','fresh retry','due review','report rollback','content update','backup/restore','offline','vocabulary switch'],screenshots:output}));
}finally{await browser?.close();await new Promise(r=>server.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
