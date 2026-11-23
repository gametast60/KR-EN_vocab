// Run with Playwright on NODE_PATH, or a local install. No product dependencies.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createServer}=require('../tools/serve.cjs');
const output=process.env.FIVE_STAGE_TEST_OUTPUT||path.join(require('node:os').tmpdir(),'five-stage-mobile-qa');
fs.mkdirSync(output,{recursive:true});
(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;try{
  browser=await chromium.launch({headless:true,channel:process.env.BROWSER_CHANNEL||'msedge'});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:1,serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const url=`http://127.0.0.1:${server.address().port}`;
  await page.goto(url);await page.getByRole('heading',{name:'ค่อย ๆ จำได้ มากขึ้นทุกวัน'}).waitFor();
  await page.screenshot({path:path.join(output,'today-mobile.png'),fullPage:true});
  for(const width of [320,360,390,768,1280]){
    await page.setViewportSize({width,height:844});
    for(const tab of ['today','library','progress','settings']){
      await page.goto(url+'/#'+tab);await page.locator('#main h1').waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${tab} overflows at ${width}`);
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.goto(url+'/#settings');await page.locator('#setting-audio').uncheck();await page.locator('#setting-next').uncheck();await page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();
  await page.selectOption('#level','english_a1');
  await page.goto(url+'/#library');await page.locator('#search').fill('bank (money)');
  await page.locator('[data-action=detail]').first().click();await page.getByRole('button',{name:'แก้ไข',exact:true}).click();
  await page.locator('[name=meaning]').fill('ธนาคาร (ทดสอบ)');await page.getByRole('button',{name:'บันทึกในเครื่อง',exact:true}).click();
  assert.ok((await page.locator('#library-results').innerText()).includes('ธนาคาร (ทดสอบ)'));
  await page.locator('[data-select]').first().check();await page.getByRole('button',{name:'ฝึกคำที่เลือก'}).click();
  await page.locator('[name=format]').selectOption('word');await page.getByRole('button',{name:'เริ่มเรียน',exact:true}).click();await page.locator('#answer').waitFor();
  await page.locator('#answer').fill('ban');await page.reload();await page.locator('#answer').waitFor();assert.equal(await page.locator('#answer').inputValue(),'ban');
  await page.locator('#answer').fill('bank');await page.getByRole('button',{name:'ตรวจคำตอบ',exact:true}).click();await page.getByRole('heading',{name:'ถูกต้อง',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).items['english_a1|bank%20(money)'].box),0);
  await page.screenshot({path:path.join(output,'answer-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'คำถัดไป',exact:true}).click();await page.getByRole('heading',{name:'ทุกครั้งที่ทวน คือความก้าวหน้า'}).waitFor();
  // A new custom Korean word, full five-stage repair path, IME, and pause/resume.
  await page.goto(url+'/#library');await page.getByRole('button',{name:'＋ เพิ่มคำ',exact:true}).click();
  await page.locator('[name=level]').selectOption('topik1');await page.locator('[name=word]').fill('테스트단어');await page.locator('[name=meaning]').fill('คำสำหรับทดสอบ');
  await page.locator('#edit-form summary').click();await page.locator('[name=sentence]').fill('테스트단어를 씁니다.');await page.locator('[name=translate]').fill('เขียนคำทดสอบ');await page.locator('[name=sentenceAnswer]').fill('테스트단어를');
  await page.getByRole('button',{name:'ดูตัวอย่างโจทย์',exact:true}).click();assert.ok((await page.locator('#editor-preview').innerText()).includes('_____'));
  await page.getByRole('button',{name:'บันทึกในเครื่อง',exact:true}).click();await page.selectOption('#level','topik1');await page.locator('#search').fill('테스트단어');
  await page.locator('[data-select]').first().check();await page.getByRole('button',{name:'ฝึกคำที่เลือก'}).click();await page.getByRole('button',{name:'เริ่มเรียน',exact:true}).click();await page.locator('#answer').waitFor();
  await page.locator('#answer').fill('테스');
  const compositionAllowed=await page.locator('#answer').evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
  assert.equal(compositionAllowed,false,'IME composition Enter must cancel native submission');
  assert.equal(await page.locator('#answer').inputValue(),'테스');
  await page.getByRole('button',{name:'พัก',exact:true}).click();await page.getByRole('button',{name:'พักไว้ กลับหน้าวันนี้'}).click();
  await page.getByRole('button',{name:'เรียนต่อ',exact:true}).click();assert.equal(await page.locator('#answer').inputValue(),'테스');
  await page.getByRole('button',{name:'ดูเฉลย',exact:true}).click();await page.getByRole('button',{name:'ฝึกต่อ',exact:true}).click();
  await page.getByRole('heading',{name:'เรียนคำศัพท์',exact:true}).waitFor();await page.getByRole('button',{name:'เรียนต่อ',exact:true}).click();
  await page.getByRole('button',{name:'เปิดความหมาย',exact:true}).click();await page.getByRole('button',{name:'นึกออก',exact:true}).click();
  await page.locator('#answer').fill('테스트단어');await page.getByRole('button',{name:'ตรวจคำตอบ',exact:true}).click();await page.getByRole('button',{name:'คำถัดไป',exact:true}).click();
  await page.getByRole('heading',{name:'เรียนประโยค',exact:true}).waitFor();await page.getByRole('button',{name:'เรียนต่อ',exact:true}).click();
  await page.locator('#answer').fill('테스트단어를');await page.getByRole('button',{name:'ตรวจคำตอบ',exact:true}).click();await page.getByRole('button',{name:'คำถัดไป',exact:true}).click();
  await page.getByRole('heading',{name:'ทุกครั้งที่ทวน คือความก้าวหน้า'}).waitFor();
  await page.screenshot({path:path.join(output,'summary-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  // Real browser: legacy migration, assessed box jumps, reporting, backup/restore, exports and reset.
  const migrated=await browser.newContext({viewport:{width:360,height:780},isMobile:true,hasTouch:true,serviceWorkers:'block'});
  const p=await migrated.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(()=>{if(!localStorage.getItem('test-seeded')){localStorage.setItem('test-seeded','yes');localStorage.setItem('topik_srs_english_a1_v1',JSON.stringify({'bank (money)':{word:'bank (money)',meaning:'ธนาคาร',box:1,nextReview:'2020-01-01'}}));}});
  await p.goto(url);await p.locator('#main h1').waitFor();
  await p.evaluate(()=>{const key='five_stage_mvp_v1',d=JSON.parse(localStorage.getItem(key)),i=d.items['english_a1|bank%20(money)'];d.settings.level='english_a1';d.settings.autoAudio=false;d.settings.autoNext=false;i.lastExposure=Date.now()-8*86400000;i.lastCold={at:i.lastExposure,correct:true};localStorage.setItem(key,JSON.stringify(d));});
  await p.reload();await p.getByRole('button',{name:'เริ่มทวน 1 คำ'}).click();await p.getByRole('button',{name:'เริ่มเรียน',exact:true}).click();
  await p.locator('#answer').fill('bank');await p.getByRole('button',{name:'ตรวจคำตอบ',exact:true}).click();
  await p.getByText('กล่อง 1 → 4',{exact:false}).waitFor();await p.reload();await p.getByText('กล่อง 1 → 4',{exact:false}).waitFor();
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).items['english_a1|bank%20(money)'].box),4);
  await p.getByRole('button',{name:'แก้คำ / แจ้งโจทย์ผิด',exact:true}).click();await p.locator('[name=meaning]').fill('ธนาคารที่เก็บเงิน');await p.getByRole('button',{name:'บันทึกในเครื่อง',exact:true}).click();
  await p.getByRole('heading',{name:'ข้อมูลโจทย์เปลี่ยนแล้ว',exact:true}).waitFor();
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).items['english_a1|bank%20(money)'].box),1);
  await p.getByRole('button',{name:'ฝึกต่อ',exact:true}).click();await p.goto(url+'/#settings');
  const downloaded=p.waitForEvent('download');await p.getByRole('button',{name:'สำรองข้อมูลทั้งหมด',exact:false}).click();const backup=await downloaded,backupPath=path.join(output,'test-backup.json');await backup.saveAs(backupPath);
  const backupData=JSON.parse(fs.readFileSync(backupPath,'utf8'));assert.equal(backupData.format,'five-stage');
  await p.getByRole('button',{name:'คืนค่าความคืบหน้าทั้งหมด',exact:true}).click();await p.getByRole('button',{name:'ยืนยัน',exact:true}).click();
  assert.equal(await p.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('five_stage_mvp_v1')).items).length),0);
  await p.goto(url+'/#settings');await p.locator('#restore-file').setInputFiles(backupPath);await p.getByRole('button',{name:'กู้คืนข้อมูล',exact:true}).click();
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).items['english_a1|bank%20(money)'].box),1);
  await p.goto(url+'/#settings');await p.getByRole('button',{name:'รายการแก้ไขและส่งออก',exact:false}).click();
  const exported=p.waitForEvent('download');await p.getByRole('button',{name:'ส่งออกทั้งหมด',exact:true}).click();assert.ok((await exported).suggestedFilename().endsWith('.json'));
  await p.getByRole('button',{name:'ล้างสถานะรายการที่ส่งออกแล้ว',exact:true}).click();await p.getByRole('button',{name:'ยืนยัน',exact:true}).click();
  assert.equal(await p.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('five_stage_mvp_v1')).pending).length),0);
  await p.getByRole('button',{name:'ปิด',exact:true}).click();await p.getByRole('button',{name:'ซิงก์และตรวจคลังคำศัพท์',exact:false}).click();await p.getByText('พร้อมเรียน 7,649 คำ',{exact:true}).waitFor();
  await p.evaluate(()=>localStorage.setItem('five_stage_mvp_v1','corrupt'));await p.reload();await p.getByRole('heading',{name:'เปิดข้อมูลไม่ได้',exact:true}).waitFor();
  await p.locator('#restore-file').setInputFiles(backupPath);await p.getByRole('button',{name:'กู้คืนจากไฟล์นี้',exact:true}).click();await p.getByRole('heading',{name:'ตั้งค่า',exact:true}).waitFor();
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('five_stage_mvp_v1')).items['english_a1|bank%20(money)'].box),1);
  await migrated.close();
  // Actual service worker shell caching, optional images, and offline navigation.
  const offline=await browser.newContext({viewport:{width:390,height:844}}),op=await offline.newPage();
  op.on('pageerror',e=>errors.push(e.message));await op.goto(url);await op.evaluate(()=>navigator.serviceWorker.ready);await op.reload();
  await op.waitForFunction(()=>!!navigator.serviceWorker.controller);await offline.setOffline(true);await op.reload();await op.getByRole('heading',{name:'ค่อย ๆ จำได้ มากขึ้นทุกวัน'}).waitFor();
  await op.selectOption('#level','topik2');await op.getByRole('link',{name:'คลังคำศัพท์',exact:false}).click();await op.locator('#search').fill('가');assert.ok(await op.locator('[data-action=detail]').count()>0);
  await offline.close();assert.deepEqual(errors,[]);console.log('Mobile browser workflows, SRS integration, migration, backup/restore, exports and offline passed. Screenshots: '+output);
  await context.close();
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
