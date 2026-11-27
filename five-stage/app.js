/* Mobile-first shell. All user mutations go through one durable transaction. */
(function () {
  'use strict';
  const S=FiveStageScheduler, Store=FiveStageStore, Session=FiveStageSession, Audio=FiveStageAudio;
  const $=id=>document.getElementById(id), esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={topik1:'TOPIK 1',topik2:'TOPIK 2',english_a1:'English A1',english_a2:'English A2',english_b1:'English B1',english_b2:'English B2'};
  const original=Object.fromEntries(Object.entries(VocabularyCatalog.levels).map(([level,key])=>[level,JSON.parse(JSON.stringify(window[key]))]));
  const main=$('main'), dialog=$('dialog');
  let store,data,grammarUI,catalog=[],rowsById=new Map(),issues=[],page='today',timer=null,toastTimer=null,speechBusy=false,restorePayload=null,updateRequested=false;
  let library={query:'',box:'all',status:'all',language:'current',limit:60},selected=new Set(),setupSelection=null,editing=null,exported=[];
  let exposureObserver=null,exposureTimer=null;const exposureBuffer=new Set();
  const button=(text,action,extra='',kind='')=>`<button type="button" data-action="${action}" ${extra} class="${kind}">${text}</button>`;
  const item=id=>data.items[id]||S.blank(), levelCards=()=>catalog.filter(c=>c.levelId===data.settings.level);
  const today=()=>S.date(Date.now()), current=()=>{const s=data.session,t=s?.tasks[s.cursor];return {s,t,c:s?.cards.find(c=>c.id===t?.cardId)};};
  function notify(text){if(dialog.open){let message=$('dialog-message');if(!message){message=document.createElement('p');message.id='dialog-message';message.className='notice';message.setAttribute('role','status');$('dialog-body').prepend(message);}message.textContent=text;return;}clearTimeout(toastTimer);$('toast').textContent=text;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
  function flushExposures(){clearTimeout(exposureTimer);if(!exposureBuffer.size||!store)return;const ids=[...exposureBuffer];exposureBuffer.clear();save(d=>{for(const id of ids){const record=d.items[id]||S.blank();record.lastExposure=Date.now();record.contextExposure=Date.now();d.items[id]=record;}});}
  function observeExposures(){exposureObserver?.disconnect();if(!window.IntersectionObserver)return;exposureObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){exposureBuffer.add(entry.target.dataset.exposure);exposureObserver.unobserve(entry.target);}clearTimeout(exposureTimer);exposureTimer=setTimeout(()=>{try{flushExposures();}catch(e){handleError(e);}},120);},{threshold:.5});(dialog.open?dialog:main).querySelectorAll('[data-exposure]').forEach(el=>exposureObserver.observe(el));}
  function stop(){clearTimeout(timer);timer=null;Audio.stop();speechBusy=false;}
  function save(fn){data=store.transact(fn);return data;}
  function exposeWords(words){const ids=catalog.filter(c=>words.includes(c.word)).map(c=>c.id);if(ids.length)save(d=>{for(const id of ids){d.items[id]||=S.blank();d.items[id].lastExposure=Date.now();d.items[id].contextExposure=Date.now();}});}
  function rebuild(){
    const source={},known=new Set();rowsById=new Map();
    for(const [level,key] of Object.entries(VocabularyCatalog.levels)) {
      source[key]=original[level].map(row=>{const id=Store.id(level,row.word);known.add(id);const edit=data.edits[id];const value=edit?(edit._legacyMeaningOnly?{...row,...edit}:edit):row;const result={...value,_id:id};rowsById.set(id,{...result,levelId:level});return result;});
      for(const [id,row] of Object.entries(data.edits)) if(id.startsWith(level+'|')&&!known.has(id)){const result={...row,_id:id};source[key].push(result);rowsById.set(id,{...result,levelId:level});}
    }
    const built=VocabularyCatalog.build(source);issues=built.issues;catalog=[];
    for(const [level,key] of Object.entries(VocabularyCatalog.levels)) catalog.push(...VisualEngine.getCards(level,source[key],built.images,built.exercises));
  }
  function due(card,day=today()) {const i=item(card.id);return !!(i.box>0&&i.nextReview&&i.nextReview<=day || card.exercise.status==='ready'&&i.contextDue&&i.contextDue<=day);}
  function ready(card){const i=item(card.id),now=Date.now(),day=today();return !!(i.box>0&&i.nextReview&&i.nextReview<=day&&i.ratedDay!==day&&(!i.lastExposure||now-i.lastExposure>=S.DAY)||card.exercise.status==='ready'&&i.contextDue&&i.contextDue<=day&&i.contextRatedDay!==day&&(!i.contextExposure||now-i.contextExposure>=S.DAY));}
  function words(mode='due',ids=null){
    let cards=ids?catalog.filter(c=>ids.includes(c.id)):levelCards();
    if(mode==='due') cards=cards.filter(c=>ready(c)).sort((a,b)=>{const dates=c=>[item(c.id).nextReview,item(c.id).contextDue].filter(Boolean).sort()[0]||'';return dates(a).localeCompare(dates(b));});
    if(mode==='new') cards=Session.shuffle(cards.filter(c=>item(c.id).box===0));
    if(mode==='needs') cards=Session.shuffle(cards.filter(c=>item(c.id).needsWord||item(c.id).needsContext));
    if(mode==='practice') cards=Session.shuffle(cards);
    return cards;
  }
  function showDialog(title,html){stop();$('dialog-title').textContent=title;$('dialog-body').innerHTML=html;if(!dialog.open)dialog.showModal();observeExposures();}
  function closeDialog(){dialog.close();editing=null;}
  function go(target){flushExposures();stop();if(dialog.open)closeDialog();location.hash=target;render(target);window.scrollTo(0,0);}
  function row(card,selectable=false){const i=item(card.id);return `<li class="word-row" data-exposure="${esc(card.id)}">${selectable?`<input type="checkbox" data-select="${esc(card.id)}" aria-label="เลือก ${esc(card.displayWord)}" ${selected.has(card.id)?'checked':''}>`:''}<button class="word-link" data-action="detail" data-id="${esc(card.id)}"><span class="word-name" lang="${card.language}">${esc(card.displayWord)}</span><small>${esc(card.meaning)}</small><span class="word-meta"><span class="badge">${i.box?'กล่อง '+i.box:'คำใหม่'}</span>${i.needsWord||i.needsContext?'<span class="badge accent">ยังต้องฝึก</span>':''}<span class="badge">${esc(labels[card.levelId])}</span></span></button></li>`;}
  function heading(kicker,title,description=''){return `<div class="stack"><p class="eyebrow">${kicker}</p><h1>${title}</h1>${description?`<p class="muted">${description}</p>`:''}</div>`;}
  function render(target=page){
    const grammar=target.startsWith('grammar-');
    page=grammar?target:['today','library','progress','settings','study','summary'].includes(target)?target:'today';
    if(page==='study'&&!data.session)page='today';
    document.body.classList.toggle('studying',page==='study'||page==='grammar-study'||page==='grammar-guided');$('level').value=data.settings.level;
    $('level').closest('label').hidden=grammar;
    $('mode-switch').hidden=document.body.classList.contains('studying');
    document.querySelectorAll('#mode-switch a').forEach(a=>a.setAttribute('aria-current',a.dataset.mode===(grammar?'grammar':'vocabulary')?'page':'false'));
    document.querySelectorAll('#nav a').forEach(a=>{const link=(grammar&&a.dataset.page!=='settings'?'grammar-':'')+a.dataset.page;a.href='#'+link;if(a.dataset.page==='library')a.lastChild.textContent=grammar?'คลังไวยากรณ์':'คลังคำศัพท์';if(link===page)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
    if(grammar){exposureObserver?.disconnect();grammarUI.render(page);return;}
    ({today:renderToday,library:renderLibrary,progress:renderProgress,settings:renderSettings,study:renderStudy,summary:renderSummary}[page])();
    observeExposures();
  }
  function renderToday(){
    const cards=levelCards(),dueCards=words(),waiting=cards.filter(c=>due(c)&&!ready(c)).length,context=dueCards.filter(c=>item(c.id).contextDue&&item(c.id).contextDue<=today()).length;
    const needs=cards.filter(c=>item(c.id).needsWord||item(c.id).needsContext).length, fresh=cards.filter(c=>item(c.id).box===0).length;
    const tomorrow=S.addDays(Date.now(),1),tomorrowCount=cards.filter(c=>item(c.id).nextReview===tomorrow||item(c.id).contextDue===tomorrow).length;
    const ongoing=data.session&&data.session.phase!=='summary';
    main.innerHTML=heading('YOUR DAILY PRACTICE','ค่อย ๆ จำได้ มากขึ้นทุกวัน',`${esc(labels[data.settings.level])} · คลัง ${cards.length.toLocaleString()} คำ`)+
      (ongoing?`<section class="panel section-title"><div class="row between"><div><span class="badge accent">รอบที่ค้างไว้ · ${esc(labels[data.session.level])}</span><h2>กลับมาเรียนต่อได้เลย</h2><p class="muted small">บันทึกคำตอบและตำแหน่งไว้แล้ว</p></div>${button('เรียนต่อ','resume','','primary')}</div></section>`:'')+
      `<section class="hero"><p class="eyebrow">${dueCards.length?'READY FOR REVIEW':waiting?'SPACED PRACTICE':'ALL CAUGHT UP'}</p><div class="row between"><h2>${dueCards.length?'ถึงเวลาทวนแล้ว':waiting?'เว้นระยะก่อนทวนอีกครั้ง':'ทวนที่ถึงกำหนดครบแล้ว'}</h2><span class="number">${dueCards.length}</span></div><p class="muted">${dueCards.length?`${dueCards.length} คำ · มีงานฝึกประโยค ${context} รายการ`:waiting?'คำที่เพิ่งเห็นเฉลยจะกลับมาเมื่อเว้นระยะครบ':'พักได้เต็มที่ หรือเลือกเรียนคำใหม่ต่อ'}</p>${button(dueCards.length?`เริ่มทวน ${Math.min(data.settings.count,dueCards.length)} คำ`:'เรียนคำใหม่','setup',`data-mode="${dueCards.length?'due':'new'}"`,'primary wide')}</section>
      ${waiting?`<p class="notice">มีคำถึงกำหนด ${waiting} คำที่เพิ่งเห็นคำตอบ รอเว้นระยะครบ 24 ชั่วโมงก่อนประเมินอีกครั้ง วันทวนเดิมยังคงอยู่</p>`:''}<div class="grid section-title">${button(`เรียนคำใหม่<small>เหลือ ${fresh.toLocaleString()} คำ</small>`,'setup','data-mode="new"','shortcut')}${button('ฝึกเพิ่มเติม<small>เลือกคำ กล่อง หรือฝึกฟัง</small>','setup','data-mode="practice"','shortcut')}</div>
      <div class="panel stack"><div class="row between"><div><h3>ยังต้องฝึก</h3><p class="muted small">เก็บต่อเนื่อง ไม่ล้างเมื่อเปลี่ยนวัน</p></div>${button(`${needs} คำ`,'needs')}</div><hr class="divider"><div class="row between"><div><h3>เตรียมไว้สำหรับพรุ่งนี้</h3><p class="muted small">คำที่นัดไว้ ${tomorrowCount} คำ</p></div>${button('ดูตาราง','progress','','quiet')}</div></div>
      ${data.migrationNotes.length?`<p class="notice">พบข้อมูลเดิมบางรายการที่อ่านไม่ได้ ต้นฉบับยังอยู่ในเครื่อง ดูรายละเอียดในตั้งค่า</p>`:''}`;
  }
  function filteredLibrary(){
    const query=library.query.trim().normalize('NFC').toLowerCase();
    return catalog.filter(c=>{
      const i=item(c.id);return (library.language==='all'||library.language==='current'&&c.levelId===data.settings.level||library.language==='ko'&&c.language==='ko'||library.language==='en'&&c.language==='en')&&
        (!query||`${c.word} ${c.meaning}`.normalize('NFC').toLowerCase().includes(query))&&(library.box==='all'||i.box===Number(library.box))&&
        (library.status==='all'||library.status==='due'&&due(c)||library.status==='needs'&&(i.needsWord||i.needsContext)||library.status==='noimage'&&!c.file||library.status==='sentence'&&c.exercise.status==='ready'||library.status==='nosentence'&&c.exercise.status!=='ready');
    });
  }
  function renderLibrary(){
    main.innerHTML=`<div class="row between">${heading('YOUR WORDS','คลังคำศัพท์')}${button('＋ เพิ่มคำ','add','','primary')}</div><div class="filterbar"><input id="search" type="search" aria-label="ค้นหาคำศัพท์หรือความหมาย" placeholder="ค้นหาไทย อังกฤษ หรือเกาหลี" value="${esc(library.query)}"><div class="row"><select id="filter-language" aria-label="ภาษา"><option value="current">${esc(labels[data.settings.level])}</option><option value="all">ทุกภาษา / ระดับ</option><option value="ko">เกาหลีทั้งหมด</option><option value="en">อังกฤษทั้งหมด</option></select><select id="filter-box" aria-label="กล่อง"><option value="all">ทุกกล่อง</option>${[0,1,2,3,4,5].map(n=>`<option value="${n}">${n?'กล่อง '+n:'คำใหม่'}</option>`).join('')}</select></div><select id="filter-status" aria-label="สถานะ"><option value="all">ทุกสถานะ</option><option value="due">ถึงกำหนดทวน</option><option value="needs">ยังต้องฝึก</option><option value="noimage">ยังไม่มีภาพ</option><option value="sentence">มีโจทย์ประโยค</option><option value="nosentence">ยังไม่มีโจทย์ประโยค</option></select></div><div id="library-results"></div>`;
    $('filter-language').value=library.language;$('filter-box').value=library.box;$('filter-status').value=library.status;renderLibraryResults();
  }
  function renderLibraryResults(){const found=filteredLibrary();$('library-results').innerHTML=`<div class="row between"><p class="muted small">พบ ${found.length.toLocaleString()} คำ</p>${button('เลือกรายการที่แสดง','select-visible','','quiet small')}</div><ul class="list">${found.slice(0,library.limit).map(c=>row(c,true)).join('')}</ul>${!found.length?`<div class="empty"><p>ไม่พบคำที่ตรงกับตัวกรอง</p>${button('เพิ่มคำนี้','add')}</div>`:''}${found.length>library.limit?button('แสดงเพิ่ม','more','','wide quiet'):''}${selected.size?`<div class="selected-bar"><span>เลือก ${selected.size} คำ</span><div class="row">${button('ล้าง','clear-selection','','quiet')}${button('ฝึกคำที่เลือก','selected-practice','','primary')}</div></div>`:''}`;observeExposures();}
  function renderProgress(){
    const cards=levelCards(),counts=Array.from({length:6},(_,n)=>cards.filter(c=>item(c.id).box===n).length);
    const retention=S.retention(cards.map(c=>item(c.id)));
    const events=cards.flatMap(c=>item(c.id).history).filter(e=>e.rated&&e.skill==='word'),correct=events.filter(e=>e.status==='correct').length;
    const max=Math.max(1,...Array.from({length:7},(_,n)=>cards.filter(c=>item(c.id).nextReview===S.addDays(Date.now(),n)||item(c.id).contextDue===S.addDays(Date.now(),n)).length));
    main.innerHTML=heading('YOUR PROGRESS','ความก้าวหน้า',esc(labels[data.settings.level]))+`<h2 class="section-title">คำศัพท์ในแต่ละกล่อง</h2><div class="box-grid">${counts.map((n,box)=>button(`<small>${box?'กล่อง '+box:'คำใหม่'}</small><strong>${n.toLocaleString()}</strong><small>${box?S.intervals[box]+' วัน':'ยังไม่เริ่ม'}</small>`,'box',`data-box="${box}"`,'box-button')).join('')}</div><p class="muted small section-title">กล่อง 5 เป็นการทวนระยะยาว 30 วัน ยังกลับมาทบทวนได้</p><h2 class="section-title">ตารางทวน 7 วัน</h2><div class="panel">${Array.from({length:7},(_,n)=>{const day=S.addDays(Date.now(),n),count=cards.filter(c=>item(c.id).nextReview===day||item(c.id).contextDue===day).length;return `<div class="trend-row"><span>${n===0?'วันนี้':n===1?'พรุ่งนี้':day.slice(5)}</span><div class="bar"><span style="width:${count/max*100}%"></span></div><span>${count}</span></div>`;}).join('')}<p class="muted small">ถึงกำหนดและค้างทวนรวม ${words().length} คำ</p>${button('ดูคำถึงกำหนด','due-list','','wide quiet')}</div><h2 class="section-title">ความจำก่อนเห็นเฉลย</h2><div class="panel"><p class="number">${events.length?Math.round(correct/events.length*100)+'%':'—'}</p><p class="muted">ตอบถูก ${correct} จาก ${events.length} ครั้ง · ไม่รวมฝึกซ้ำ</p><details><summary>ผลแยกตามการเลื่อนกล่อง</summary>${[1,2,3].map(j=>{const g=retention[j];return `<p class="small">หลังเลื่อน ${j} กล่อง: ${g.tested?`กลับมาทวนแล้วถูก ${g.correct}/${g.tested} ครั้ง (${Math.round(g.correct/g.tested*100)}%)`:'ยังไม่มีผลทวนครั้งถัดไป'}</p>`;}).join('')}<p class="muted small">คะแนนเป็นเกณฑ์ MVP ไม่ใช่เปอร์เซ็นต์ความจำ</p></details></div>`;
  }
  function renderSettings(){
    main.innerHTML=heading('MAKE IT YOURS','ตั้งค่า','5 Stage · MVP 6.1')+`<section class="settings-group"><h2 class="section-title">การเรียนและเสียง</h2><label class="field">จำนวนคำต่อรอบ<input id="setting-count" type="number" min="1" max="200" value="${data.settings.count}"></label><label class="field">เตือนเมื่อพรุ่งนี้มีคำทวนตั้งแต่<input id="setting-warning" type="number" min="1" max="9999" value="${data.settings.warning}"></label><label class="check">อ่านเสียงอัตโนมัติ<input id="setting-audio" type="checkbox" ${data.settings.autoAudio?'checked':''}></label><label class="check">เลื่อนอัตโนมัติเมื่อตอบถูก<input id="setting-next" type="checkbox" ${data.settings.autoNext?'checked':''}></label>${button('บันทึกการตั้งค่า','save-settings','','primary')}</section><section class="settings-group"><h2 class="section-title">คลังคำศัพท์</h2>${button('เพิ่มคำศัพท์ <span>＋</span>','add')}${button(`รายการแก้ไขและส่งออก <span>${Object.keys(data.pending).length}</span>`,'pending')}${button('ซิงก์และตรวจคลังคำศัพท์ <span>↻</span>','sync')}</section><section class="settings-group"><h2 class="section-title">ข้อมูลและแอป</h2>${button('สำรองข้อมูลทั้งหมด <span>↓</span>','backup')}${button('กู้คืนจากไฟล์สำรอง <span>↑</span>','restore')}${button('อัปเดตแอป <span>↻</span>','update')}<p class="muted small section-title">ข้อมูลเก็บในเบราว์เซอร์ของเครื่องนี้ ควรสำรองก่อนย้ายเครื่องหรือล้างข้อมูลเว็บไซต์</p>${data.migrationNotes.length?`<details><summary>รายการที่ย้ายไม่ได้ ${data.migrationNotes.length}</summary><p class="small">${data.migrationNotes.map(esc).join('<br>')}</p>${button('สำรองข้อมูลดิบเดิม','raw-backup')}</details>`:''}</section><section class="settings-group"><h2 class="section-title">รีเซ็ตข้อมูล</h2>${button('รีเซ็ตกล่องที่เลือก','reset-boxes','','danger')}${button('ล้างรายการยังต้องฝึกของระดับนี้','clear-needs','','danger')}${button('คืนค่าความคืบหน้าทั้งหมด','reset-all','','danger')}</section>`;
  }
  function scoreExplanation(e){return e.parts?`<details><summary>คะแนนประเมิน ${e.score} · ดูเหตุผล</summary><p class="small">ตอบก่อนเห็นเฉลย ${e.parts[0]}<br>ประวัติครั้งก่อน ${e.parts[1]}<br>ช่วงเวลาที่เว้น ${e.parts[2]}</p></details>`:'';}
  function renderStudy(){
    stop();let {s,t,c}=current();if(s.phase==='summary'||!t){go('summary');return;}
    const actual=catalog.find(x=>x.id===c.id);
    if(s.phase==='question'&&(t.invalidated||!actual||Session.fingerprint(actual)!==c.fingerprint)) {
      save(d=>Session.complete(d,'invalidated','',Date.now()));({s,t,c}=current());
    }
    const feedback=s.phase==='feedback', event=s.events.find(e=>e.id===t.id);
    const remaining=new Set(s.tasks.slice(s.cursor+(feedback?1:0)).map(x=>x.cardId)),finished=s.cards.filter(x=>!remaining.has(x.id)).length;
    const titles={1:'เรียนคำศัพท์',2:'ลองนึกความหมาย',3:'พิมพ์คำศัพท์',4:'เรียนประโยค',5:'เติมคำในประโยค',6:'ฟังแล้วพิมพ์คำ'};
    let content='';
    if(t.stage===1||t.stage===3)content=`${c.file?`<img src="${esc(c.file)}" alt="ภาพประกอบโจทย์" width="210" height="210">`:''}${t.stage===1?`<p class="word" lang="${c.language}">${esc(c.displayWord)}</p>`:''}<p class="meaning">${esc(c.meaning)}</p>`;
    if(t.stage===2)content=`<p class="word" lang="${c.language}">${esc(c.displayWord)}</p><p class="muted">ลองนึกความหมายก่อนเปิดเฉลย</p>${s.recognition?`<p class="meaning">${esc(c.meaning)}</p>`:''}`;
    if(t.stage===4)content=`<p class="word" lang="${c.language}">${esc(c.displayWord)} → ${esc(c.exercise.targetAnswer)}</p><p class="sentence" lang="${c.language}">${esc(c.exercise.before)}<mark>${esc(c.exercise.targetAnswer)}</mark>${esc(c.exercise.after)}</p><p>${esc(c.exercise.translation)}</p>`;
    if(t.stage===5)content=`<p class="sentence" lang="${c.language}">${esc(feedback?c.exercise.sentence:c.exercise.blankedSentence)}</p><p>${esc(c.exercise.translation)}</p>`;
    if(t.stage===6)content=`<p class="word" aria-hidden="true">♫</p><p>ฟังคำศัพท์ แล้วลองพิมพ์</p>${button('ฟังอีกครั้ง','speak')}`;
    main.innerHTML=`<div class="study-head"><div><p class="eyebrow">${esc(labels[s.level])}</p><p class="small muted">จัดการแล้ว ${finished} จาก ${s.cards.length} คำ</p></div>${button('พัก','pause','','quiet')}</div><div class="study-progress" role="progressbar" aria-label="คำที่จัดการแล้ว" aria-valuemin="0" aria-valuemax="${s.cards.length}" aria-valuenow="${finished}"><span style="width:${finished/s.cards.length*100}%"></span></div><div class="study-label"><h2>${titles[t.stage]}</h2><span class="badge">${t.stage===6?'ฝึกฟัง':'Stage '+t.stage}</span></div><p class="muted small" style="margin-bottom:12px">${t.assess?'ทวนตามกำหนด · ประเมินก่อนเห็นเฉลย':s.mode==='new'?'เรียนคำใหม่ · ฝึกให้คุ้นเคย':'ฝึกเพิ่มเติม · ไม่เลื่อนกล่องซ้ำ'}</p><section class="panel study-card">${content}</section><p id="audio-status" class="muted small" role="status"></p>`;
    if(feedback){
      const i=item(c.id),status=event?.status;const title={correct:'ถูกต้อง',incorrect:'ยังต้องฝึก',revealed:'เปิดเฉลยแล้ว',skipped:'ข้ามไว้ก่อน',invalidated:'ข้อมูลโจทย์เปลี่ยนแล้ว',learned:'เรียนแล้ว',known:'นึกออก',unknown:'ยังนึกไม่ออก'}[status];
      main.insertAdjacentHTML('beforeend',`<section class="feedback ${status}" role="status"><h3 class="${status==='correct'?'success':status==='incorrect'?'error':''}">${title}</h3>${['skipped','invalidated'].includes(status)?'<p class="muted">ไม่เปลี่ยนกล่องจากข้อนี้</p>':`<p class="answer" lang="${c.language}">${esc(t.stage>=4&&t.stage!==6?c.exercise.targetAnswer:c.displayWord)}</p><p>${esc(c.meaning)}</p>${event?.answer&&status==='incorrect'?`<p class="muted small">คุณตอบ: ${esc(event.answer)}</p>`:''}<p class="small">${event?.rated&&t.skill==='word'?`กล่อง ${event.from} → ${event.to} · ทวน ${esc(i.nextReview)}`:t.skill==='context'?`ฝึกประโยคอีกครั้ง ${esc(i.contextDue||'—')}`:event?.enrolled?'เริ่มกล่อง 1 · ทวนพรุ่งนี้':'บันทึกการฝึกแล้ว'}</p>${scoreExplanation(event||{})}`}</section><div class="study-footer">${button('ฟังคำตอบ','speak','','quiet')}${button(status==='correct'?'คำถัดไป':'ฝึกต่อ','next','','primary')}</div>`);
      if(!['skipped','invalidated'].includes(status)&&data.settings.autoAudio)speakCurrent(()=>autoNext(event));else autoNext(event);
    }else if([3,5,6].includes(t.stage)){
      main.insertAdjacentHTML('beforeend',`<form id="answer-form" class="answer-form"><label for="answer">${t.stage===5?'เติมรูปคำตามประโยค':'พิมพ์คำศัพท์'}</label><input id="answer" lang="${c.language}" value="${esc(s.draft)}" autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false" enterkeyhint="done" aria-describedby="answer-error"><p id="answer-error" class="error small" role="status"></p><button type="submit" class="primary">ตรวจคำตอบ</button></form><div class="study-secondary">${button('ดูเฉลย','reveal')}${button('ข้ามไว้ก่อน','skip')}</div>`);
      if(t.stage===6&&data.settings.autoAudio)speakCurrent();
    }else if(t.stage===2){main.insertAdjacentHTML('beforeend',s.recognition?`<div class="grid section-title">${button('ยังนึกไม่ออก','recognition-no')}${button('นึกออก','recognition-yes','','primary')}</div>`:button('เปิดความหมาย','recognition','','primary wide section-title'));}
    else {main.insertAdjacentHTML('beforeend',`<div class="study-footer">${button('ฟังอีกครั้ง','speak','','quiet')}${button('เรียนต่อ','learned','','primary')}</div>`);if(data.settings.autoAudio)speakCurrent();}
    main.insertAdjacentHTML('beforeend',`<div class="study-footer">${button('แก้คำ / แจ้งโจทย์ผิด','edit',`data-id="${esc(c.id)}"`,'quiet small')}${button('เสียงและการเลื่อน','study-settings','','quiet small')}</div>`);
    main.querySelectorAll('img').forEach(img=>img.addEventListener('error',()=>img.hidden=true));
    if(!feedback&&[1,2,4,6].includes(t.stage))save(d=>{const i=d.items[c.id]||S.blank();i.lastExposure=Date.now();i.contextExposure=Date.now();d.items[c.id]=i;});
  }
  function autoNext(e){if(e?.status==='correct'&&data.settings.autoNext){const id=e.id;timer=setTimeout(()=>{if(!dialog.open&&page==='study'&&data.session?.events.some(x=>x.id===id)&&current().t?.id===id)advance();},1500);}}
  function speakCurrent(done=()=>{}){
    const {s,t,c}=current();if(!c)return;
    if(s.phase==='question'&&[3,5].includes(t.stage)){done();return;}
    const lang=c.language==='en'?'en-US':'ko-KR';let texts;
    if(t.stage===4)texts=[c.displayWord,c.exercise.targetAnswer,c.exercise.sentence].map(text=>({text,lang}));
    else if(t.stage===5)texts=[c.exercise.targetAnswer,c.exercise.sentence].map(text=>({text,lang}));
    else if(t.stage===2)texts=[{text:s.recognition?c.meaning:c.displayWord,lang:s.recognition?'th-TH':lang}];
    else texts=[{text:c.displayWord,lang},...(t.stage===6?[]:[{text:c.meaning,lang:'th-TH'}])];
    speechBusy=true;Audio.play(texts,()=>{speechBusy=false;done();},()=>{if($('audio-status'))$('audio-status').textContent='ยังเล่นเสียงไม่ได้ คุณเรียนต่อได้หรือกดฟังอีกครั้ง';});
  }
  function submit(status,answer=''){stop();save(d=>Session.complete(d,status,answer,Date.now()));renderStudy();}
  function advance(){stop();save(d=>{d.session.recognition=false;Session.next(d);});renderStudy();window.scrollTo(0,0);}
  function renderSummary(){
    const s=data.session;if(!s){go('today');return;}
    const tested=s.events.filter(e=>[3,5,6].includes(e.stage)),promoted=tested.filter(e=>e.to>e.from),needs=new Set(tested.filter(e=>['incorrect','revealed','unknown'].includes(e.status)).map(e=>e.cardId));
    const completed=new Set(s.events.filter(e=>!['skipped','invalidated'].includes(e.status)).map(e=>e.cardId));
    main.innerHTML=heading('SESSION COMPLETE','ทุกครั้งที่ทวน คือความก้าวหน้า',`${esc(labels[s.level])} · เริ่มรอบ ${Math.max(1,Math.round((Date.now()-s.startedAt)/60000))} นาทีที่แล้ว`)+`<div class="summary-metrics"><div><p class="number">${completed.size}</p><small>คำที่ได้ฝึก</small></div><div><p class="number">${promoted.length}</p><small>เลื่อนกล่อง</small></div><div><p class="number">${needs.size}</p><small>คำที่ติดขัด</small></div></div><div class="stack">${button(needs.size?'ฝึกคำที่ยังติดขัด':words().length?'ทวนชุดถัดไป':'กลับหน้าวันนี้',needs.size?'retry':words().length?'next-set':'today','','primary wide')}${button('ฝึกชุดนี้อีกครั้ง','replay','','wide quiet')}${needs.size||words().length?button('กลับหน้าวันนี้','today','','wide quiet'):''}</div><h2 class="section-title">ผลรายคำ</h2><ul class="list">${s.cards.map(c=>{const e=tested.find(x=>x.cardId===c.id&&x.rated),i=item(c.id);return `<li class="word-row" data-exposure="${esc(c.id)}"><div class="grow"><h3 class="gold">${esc(c.displayWord)}</h3><p class="muted small">${esc(c.meaning)}</p><p class="small">${e?.skill==='word'?`กล่อง ${e.from} → ${e.to}`:completed.has(c.id)?'บันทึกการฝึกแล้ว':'ยังไม่ได้ทำ · ไม่เปลี่ยนกล่อง'}${i.nextReview?' · ทวน '+esc(i.nextReview):''}</p>${i.contextDue?`<p class="small ${i.needsContext?'error':'muted'}">ประโยค: ${i.needsContext?'ยังต้องฝึก':'นัดฝึก'} ${esc(i.contextDue)}</p>`:''}${scoreExplanation(e||{})}</div>${button('ดู','detail',`data-id="${esc(c.id)}"`,'quiet')}</li>`;}).join('')}</ul>`;
  }
  function setup(mode='practice',ids=null){
    setupSelection=ids;const count=data.settings.count;
    showDialog(mode==='due'?'จัดชุดทวนวันนี้':mode==='new'?'เรียนคำใหม่':'จัดชุดฝึกเพิ่มเติม',`<form id="setup-form"><input type="hidden" name="mode" value="${esc(mode)}"><p class="dialog-note">${mode==='due'||mode==='new'?'ผลการทดสอบก่อนเห็นเฉลยมีผลต่อกล่องและวันทวน':'บันทึกการฝึก แต่ไม่เลื่อนกล่อง'} · ${esc(labels[data.settings.level])}</p><div class="row section-title">${[10,20,30].map(n=>button(n+' คำ','set-count',`data-count="${n}"`,'quiet')).join('')}</div><label class="field">จำนวนคำ<input name="count" type="number" min="1" max="200" value="${count}" required></label><label class="field">รูปแบบฝึก<select name="format"><option value="adaptive">เส้นทางตามคำ · 5 Stage</option><option value="word">เฉพาะคำศัพท์</option><option value="sentence">เฉพาะประโยค</option><option value="listen">ฟังแล้วพิมพ์ · ฝึกเพิ่มเติม</option></select></label>${['practice','needs'].includes(mode)?`<fieldset><legend>เลือกกล่อง</legend><div class="row">${[0,1,2,3,4,5].map(n=>`<label class="check"><input name="box" type="checkbox" value="${n}" ${data.settings.practiceBoxes.includes(n)?'checked':''}>${n?'กล่อง '+n:'ใหม่'}</label>`).join('')}</div></fieldset>`:''}<p id="setup-note" class="small muted"></p><div class="actions"><button class="primary" type="submit">เริ่มเรียน</button></div></form>`);
  }
  function startFromForm(form){
    const values=new FormData(form),mode=values.get('mode'),format=values.get('format'),count=Number(values.get('count'));
    const boxes=values.getAll('box').map(Number);if(!Number.isInteger(count)||count<1||count>200)throw Error('เลือกจำนวนคำระหว่าง 1–200');
    let cards=words(mode,setupSelection);
    if(['practice','needs'].includes(mode))cards=cards.filter(c=>boxes.includes(item(c.id).box));
    if(format==='sentence')cards=cards.filter(c=>c.exercise.status==='ready');
    cards=cards.slice(0,count);if(!cards.length)throw Error('ไม่มีคำที่ตรงกับตัวเลือกนี้ ลองเปลี่ยนกล่องหรือรูปแบบฝึก');
    const next=()=>{save(d=>{d.settings.count=count;if(['practice','needs'].includes(mode))d.settings.practiceBoxes=boxes;d.session=Session.create(cards,d.items,{level:d.settings.level,mode:format==='listen'?'practice':mode,format},Date.now());});closeDialog();go('study');};
    if(data.session&&data.session.phase!=='summary'){confirmAction('เริ่มรอบใหม่?', 'คำตอบที่ทำแล้วบันทึกไว้แล้ว รอบที่ยังทำไม่ครบจะถูกแทนที่',next);return;}
    const tomorrow=S.addDays(Date.now(),1),burden=levelCards().filter(c=>item(c.id).nextReview===tomorrow||item(c.id).contextDue===tomorrow).length;
    if(mode==='new'&&burden+cards.length>=data.settings.warning){showDialog('ภาระทวนพรุ่งนี้',`<p>มีคำที่นัดไว้ ${burden} คำ การเรียนใหม่อาจเพิ่มได้อีก ${cards.length} คำ</p><div class="actions">${button('ลดเหลือ 5 คำ','reduce-new')}${button('ใช้จำนวนเดิม','confirm-new','','primary')}</div>`);dialogCallback=next;reducedCallback=()=>{cards=cards.slice(0,5);next();};return;}
    next();
  }
  let dialogCallback=null,reducedCallback=null;
  function confirmAction(title,message,callback){dialogCallback=callback;showDialog(title,`<p>${esc(message)}</p><div class="actions">${button('ยกเลิก','close-dialog')}${button('ยืนยัน','confirm','','primary')}</div>`);}
  function detail(id){
    const c=catalog.find(x=>x.id===id);if(!c)return;const i=item(id),sentence=c.exercise.status==='ready';
    showDialog(c.displayWord,`<p class="eyebrow">${esc(labels[c.levelId])}</p><p style="font-size:20px;margin-top:10px">${esc(c.meaning)}</p><div class="row section-title">${button('ฟังคำศัพท์','detail-speak',`data-id="${esc(id)}"`)}${button('แก้ไข','edit',`data-id="${esc(id)}"`)}${button('ฝึกคำนี้','practice-one',`data-id="${esc(id)}"`,'primary')}</div>${c.file?`<img src="${esc(c.file)}" alt="ภาพประกอบคำศัพท์" width="160" style="max-width:100%;border-radius:12px;margin-top:16px">`:''}<h3 class="section-title">ประโยค</h3>${sentence?`<p lang="${c.language}">${esc(c.exercise.sentence)}</p><p class="muted">${esc(c.exercise.translation)}</p><p class="gold">รูปคำ: ${esc(c.exercise.targetAnswer)}</p>${button('ฟังประโยค','sentence-speak',`data-id="${esc(id)}"`,'quiet')}`:'<p class="muted">ยังไม่มีโจทย์ประโยคพร้อมใช้ · เรียนคำได้ตามปกติ</p>'}<h3 class="section-title">ความคืบหน้า</h3><p>${i.box?'กล่อง '+i.box:'คำใหม่'} · ทวน ${esc(i.nextReview||'ยังไม่นัด')}</p><p class="small muted">ประโยค: ${esc(i.contextDue||'ยังไม่นัด')}</p><details><summary>ประวัติ ${i.history.length} รายการ</summary>${i.history.slice(-30).reverse().map(e=>`<div class="word-row"><div><p class="small">${esc(S.date(e.at))} · ${e.skill==='context'?'ประโยค':'คำศัพท์'} · ${esc({correct:'ถูก',incorrect:'ผิด',revealed:'ดูเฉลย',skipped:'ข้าม',invalidated:'โจทย์เปลี่ยน'}[e.status]||e.status)}</p><p class="muted small">${e.rated?`กล่อง ${e.from} → ${e.to}`:'ฝึกเพิ่มเติม'}</p>${scoreExplanation(e)}</div></div>`).join('')||'<p class="muted">ยังไม่มีประวัติ</p>'}</details>`);
    // Opening a word's details is an exposure, even outside a practice session.
    save(d=>{const record=d.items[id]||S.blank();record.lastExposure=Date.now();record.contextExposure=Date.now();d.items[id]=record;});
  }
  const field=(name,label,value='',type='text')=>`<label class="field">${label}<input name="${name}" type="${type}" value="${esc(value)}" ${['word','meaning'].includes(name)?'required':''}></label>`;
  function edit(id=null){
    const row=id?rowsById.get(id):{},level=row?.levelId||data.settings.level;
    editing={id,level};
    showDialog(id?'แก้คำศัพท์ / โจทย์':'เพิ่มคำศัพท์',`<form id="edit-form"><p class="dialog-note">บันทึกใช้ในเครื่องนี้ทันที · ส่งออกได้จากตั้งค่า</p>${!id?`<label class="field">ระดับ<select name="level">${Object.entries(labels).map(([v,l])=>`<option value="${v}" ${v===level?'selected':''}>${l}</option>`).join('')}</select></label>`:`<p class="muted small">${esc(labels[level])} · รักษาประวัติคำเดิม</p>`}${field('word','คำศัพท์',row?.word||library.query)}${field('meaning','ความหมาย',row?.meaning)}${field('displayWord','คำแสดง / คำที่ให้อ่าน (ไม่บังคับ)',row?.displayWord)}<details><summary>ภาพและประโยค</summary>${field('imageId','รหัสภาพในคลัง เช่น 0001',row?.imageId)}<label class="field">ชนิดภาพ<select name="imageExtension"><option value="webp">webp</option><option value="png" ${row?.imageExtension==='png'?'selected':''}>png</option></select></label><label class="field">ประโยค<textarea name="sentence">${esc(row?.sentense||row?.sentence)}</textarea></label>${field('translate','คำแปลประโยค',row?.translate)}${field('sentenceAnswer','รูปคำที่จะเว้นช่องในประโยค',row?.sentenceAnswer)}${field('sentenceOccurrence','ตำแหน่งเมื่อคำตอบซ้ำ (เริ่มจาก 1)',row?.sentenceOccurrence||'','number')}<label class="field">คำตอบอื่นที่ยอมรับ (หนึ่งคำตอบต่อบรรทัด)<textarea name="accepted">${esc((row?.sentenceAcceptedAnswers||[]).join('\n'))}</textarea></label></details><div id="editor-preview" class="editor-preview" hidden></div><div class="actions">${button('ดูตัวอย่างโจทย์','preview-edit')}<button type="submit" class="primary">บันทึกในเครื่อง</button></div></form>`);
    if(id)save(d=>{Session.invalidate(d,id);const i=d.items[id]||S.blank();i.lastExposure=Date.now();i.contextExposure=Date.now();d.items[id]=i;});
  }
  function readEdit(){
    const f=new FormData($('edit-form')),level=f.get('level')||editing.level;
    // Keep source metadata (e.g. Studio's where/processing fields) while replacing editable fields.
    const row={...(editing.id?rowsById.get(editing.id):{})};
    for(const key of ['_id','levelId','_legacyMeaningOnly','word','meaning','displayWord','imageId','imageExtension','sentence','sentense','translate','sentenceAnswer','sentenceOccurrence','sentenceAcceptedAnswers'])delete row[key];
    row.word=String(f.get('word')).trim();row.meaning=String(f.get('meaning')).trim();
    if(!row.word||!row.meaning)throw Error('กรอกคำศัพท์และความหมายก่อน');
    for(const key of ['displayWord','imageId','sentence','translate','sentenceAnswer'])if(String(f.get(key)||'').trim())row[key]=String(f.get(key)).trim();
    if(row.imageId){if(!/^\d{4,}$/.test(row.imageId))throw Error('รหัสภาพต้องเป็นตัวเลขอย่างน้อย 4 หลัก');row.imageExtension=f.get('imageExtension');}
    if(f.get('sentenceOccurrence'))row.sentenceOccurrence=Number(f.get('sentenceOccurrence'));
    if(f.get('accepted')?.trim())row.sentenceAcceptedAnswers=f.get('accepted').split('\n').map(x=>x.trim()).filter(Boolean);
    if(catalog.some(c=>c.levelId===level&&c.id!==editing.id&&c.word.normalize('NFC').toLowerCase()===row.word.normalize('NFC').toLowerCase()))throw Error('มีคำนี้อยู่แล้วในระดับเดียวกัน');
    const built=VocabularyCatalog.build({[VocabularyCatalog.levels[level]]:[row]});
    if(built.issues.length)throw Error('ตรวจประโยคและคำตอบอีกครั้ง: '+built.issues.map(i=>i.reason).join(', '));
    return {row,level,built};
  }
  function download(name,value,type='application/json') {const blob=new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function pending(){showDialog('รายการแก้ไขและส่งออก',`<p class="muted">ส่งออกข้อมูลคำที่แก้ได้ทั้งระดับหรือทั้งหมด</p><div class="stack section-title">${Store.levels.map(level=>{const n=Object.keys(data.pending).filter(id=>id.startsWith(level+'|')).length;return n?`<div class="row between"><span>${esc(labels[level])} · ${n} รายการ</span>${button('ส่งออก','export-level',`data-level="${level}"`)}</div>`:'';}).join('')||'<p>ไม่มีรายการรอส่งออก</p>'}</div><div class="actions">${button('ส่งออกทั้งหมด','export-all','','primary')}${button('ดูรายการ','pending-details')}</div>${exported.length?button('ล้างสถานะรายการที่ส่งออกแล้ว','clear-exported','','wide quiet section-title'):''}`);}
  function exportEdits(level=null){const ids=Object.keys(data.pending).filter(id=>!level||id.startsWith(level+'|'));if(!ids.length)return notify('ไม่มีรายการรอส่งออก');download(`vocab-edits-${level||'all'}-${today()}.json`,{format:'five-stage-vocabulary-edits',version:1,changes:ids.map(id=>({id,level:id.split('|')[0],type:data.pending[id].type,before:data.pending[id].before||null,...data.edits[id]}))});exported=ids;pending();}
  function previewRestore(){
    if(!store){const next=Store.preview(restorePayload);showDialog('กู้คืนข้อมูลที่เปิดไม่ได้',`<p>ไฟล์สำรองผ่านการตรวจแล้ว มีประวัติ ${Object.keys(next.items).length} คำ</p><p class="notice">จะแทนที่ข้อมูลที่เปิดไม่ได้ ควรเก็บไฟล์ข้อมูลดิบไว้ก่อน</p><div class="actions">${button('สำรองข้อมูลดิบ','raw-backup')}${button('กู้คืนจากไฟล์นี้','recover-restore','','primary')}</div>`);return;}
    const shifted=$('restore-shift')?.checked||false,next=store.preview(restorePayload,Date.now(),shifted),count=Object.values(next.items).filter(i=>i.box>0).length;
    showDialog('ตรวจไฟล์ก่อนกู้คืน',`<p>มีคำที่เริ่มเรียน ${count} คำ · คำแก้ไข ${Object.keys(next.edits).length} รายการ</p><p class="notice">จะแทนที่ข้อมูลปัจจุบัน แนะนำให้สำรองก่อนกู้คืน</p><label class="check"><input id="restore-shift" type="checkbox" ${shifted?'checked':''}>เลื่อนตารางตามจำนวนวันที่ผ่านไปจากวันสำรอง</label><p class="muted small">ไม่เลือก: คงวันทวนเดิม รวมคำค้างทวน</p><div class="actions">${button('สำรองปัจจุบัน','backup')}${button('กู้คืนข้อมูล','confirm-restore','','primary')}</div>`);
  }
  function resetBoxes(){showDialog('รีเซ็ตกล่องที่เลือก',`<p>${esc(labels[data.settings.level])} · คำในกล่องที่เลือกจะกลับเป็นคำใหม่</p><fieldset><legend>เลือกกล่อง</legend>${[1,2,3,4,5].map(n=>`<label class="check"><input type="checkbox" name="reset-box" value="${n}">กล่อง ${n}</label>`).join('')}</fieldset><p class="muted small">ล้างประวัติการทวนและสถานะประโยคของคำที่เลือกด้วย</p>${button('ตรวจรายการก่อนรีเซ็ต','confirm-reset-boxes','','danger wide')}`);}
  function orphanHistory(){const ids=Object.keys(data.items).filter(id=>!rowsById.has(id));showDialog('ประวัติที่ไม่พบคำในคลัง',`<p class="muted">เก็บไว้ได้ หรือเลือกนำออกหลังสำรองข้อมูล คำที่มีปัญหาข้อมูลยังไม่ถูกนำมาลบในหน้านี้</p><fieldset><legend>${ids.length} รายการ</legend>${ids.map(id=>`<label class="check"><input name="orphan" type="checkbox" value="${esc(id)}"><span>${esc(labels[id.split('|')[0]])} · ${esc(decodeURIComponent(id.slice(id.indexOf('|')+1)))}</span></label>`).join('')}</fieldset><div class="actions">${button('สำรองข้อมูลก่อน','backup')}${button('นำรายการที่เลือกออก','purge-orphans','','danger')}</div>`);}
  const actions={
    'close-dialog':closeDialog, today:()=>go('today'), progress:()=>go('progress'),
    setup:b=>setup(b.dataset.mode),'set-count':b=>{$('setup-form').elements.count.value=b.dataset.count;},resume:()=>{save(d=>{d.session.suspended=false;d.settings.level=d.session.level;});go('study');},
    needs:()=>{library.status='needs';library.box='all';go('library');},'due-list':()=>{library.status='due';library.box='all';go('library');},
    box:b=>{library.box=b.dataset.box;library.status='all';go('library');},more:()=>{library.limit+=60;renderLibraryResults();},
    'select-visible':()=>{filteredLibrary().slice(0,library.limit).forEach(c=>selected.add(c.id));renderLibraryResults();},'clear-selection':()=>{selected.clear();renderLibraryResults();},
    'selected-practice':()=>{const ids=[...selected],levels=new Set(catalog.filter(c=>ids.includes(c.id)).map(c=>c.levelId));if(levels.size>1)throw Error('เลือกคำจากระดับเดียวกันต่อหนึ่งรอบ');if(levels.size===1)save(d=>d.settings.level=[...levels][0]);setup('practice',ids);},
    detail:b=>detail(b.dataset.id),edit:b=>edit(b.dataset.id),add:()=>edit(),
    'practice-one':b=>{const c=catalog.find(c=>c.id===b.dataset.id);save(d=>d.settings.level=c.levelId);setup('practice',[c.id]);},
    'detail-speak':b=>{const c=catalog.find(c=>c.id===b.dataset.id);Audio.play([{text:c.displayWord,lang:c.language==='en'?'en-US':'ko-KR'}],()=>{},()=>notify('ยังเล่นเสียงไม่ได้'));},
    'sentence-speak':b=>{const c=catalog.find(c=>c.id===b.dataset.id);Audio.play([{text:c.exercise.sentence,lang:c.language==='en'?'en-US':'ko-KR'}],()=>{},()=>notify('ยังเล่นเสียงไม่ได้'));},
    speak:()=>{clearTimeout(timer);speakCurrent();},next:advance,learned:()=>{submit('learned');advance();},skip:()=>submit('skipped'),reveal:()=>submit('revealed'),
    recognition:()=>{save(d=>d.session.recognition=true);renderStudy();},'recognition-yes':()=>{submit('known');advance();},'recognition-no':()=>{submit('unknown');advance();},
    pause:()=>showDialog('พักรอบนี้',`<p>คำตอบและตำแหน่งบันทึกไว้แล้ว</p><div class="stack section-title">${button('เรียนต่อ','close-dialog','','primary')}${button('พักไว้ กลับหน้าวันนี้','suspend')}${button('จบรอบและดูผล','finish')}</div>`),
    suspend:()=>{save(d=>d.session.suspended=true);go('today');},finish:()=>{save(d=>d.session.phase='summary');go('summary');},
    replay:()=>setup('practice',data.session.cards.map(c=>c.id)),retry:()=>setup('practice',[...new Set(data.session.events.filter(e=>['incorrect','revealed','unknown'].includes(e.status)).map(e=>e.cardId))]),'next-set':()=>setup('due'),
    'study-settings':()=>showDialog('เสียงและการเลื่อน',`<label class="check"><input id="quick-audio" type="checkbox" ${data.settings.autoAudio?'checked':''}>เสียงอัตโนมัติ</label><label class="check"><input id="quick-next" type="checkbox" ${data.settings.autoNext?'checked':''}>เลื่อนอัตโนมัติเมื่อตอบถูก</label>${button('บันทึก','quick-save','','primary wide')}`),
    'quick-save':()=>{save(d=>{d.settings.autoAudio=$('quick-audio').checked;d.settings.autoNext=$('quick-next').checked;});closeDialog();},
    confirm:()=>{const fn=dialogCallback;dialogCallback=null;closeDialog();fn?.();},'confirm-new':()=>{const fn=dialogCallback;dialogCallback=null;fn?.();},'reduce-new':()=>reducedCallback?.(),
    'preview-edit':()=>{const {row,built}=readEdit();$('editor-preview').hidden=false;const exercise=built.exercises[0];$('editor-preview').textContent=exercise?row.sentence.slice(0,exercise.start)+' _____ '+row.sentence.slice(exercise.end):`${row.displayWord||row.word} — ${row.meaning} · เรียนคำได้ ยังไม่มีโจทย์ประโยค`;},
    'save-settings':()=>{const count=Number($('setting-count').value),warning=Number($('setting-warning').value);if(!Number.isInteger(count)||count<1||count>200||!Number.isInteger(warning)||warning<1||warning>9999)throw Error('ตรวจจำนวนคำและเกณฑ์แจ้งเตือน');save(d=>Object.assign(d.settings,{count,warning,autoAudio:$('setting-audio').checked,autoNext:$('setting-next').checked}));notify('บันทึกการตั้งค่าแล้ว');},
    backup:()=>{download(`five-stage-backup-${today()}.json`,store.backup());notify('ส่งไฟล์สำรองแล้ว');},restore:()=>$('restore-file').click(),
    'confirm-restore':()=>{const next=store.preview(restorePayload,Date.now(),$('restore-shift').checked);store.restore(next);data=store.read();rebuild();go('today');notify('กู้คืนข้อมูลแล้ว');},
    'recover-restore':()=>{const next=Store.preview(restorePayload);localStorage.setItem(Store.KEY,JSON.stringify(next));location.reload();},
    'raw-backup':()=>download(`vocab-raw-backup-${today()}.json`,{localStorage:Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('topik_')||k.endsWith('_vocab_edits')||k===Store.KEY).map(k=>[k,localStorage.getItem(k)]))}),
    pending,'export-level':b=>exportEdits(b.dataset.level),'export-all':()=>exportEdits(),
    'pending-details':()=>showDialog('คำที่แก้ไข',`<ul class="list">${Object.keys(data.pending).map(id=>{const c=catalog.find(c=>c.id===id),before=data.pending[id].before;return c?`<li class="word-row" data-exposure="${esc(c.id)}"><div class="grow"><h3>${esc(c.displayWord)}</h3><p class="small muted">${before?esc(before.meaning)+' → '+esc(c.meaning):'เพิ่มคำ: '+esc(c.meaning)}</p></div>${button('ดู','detail',`data-id="${esc(c.id)}"`,'quiet')}</li>`:`<li>${esc(data.edits[id]?.word)}</li>`;}).join('')}</ul>`),
    orphans:orphanHistory,
    'purge-orphans':()=>{const ids=[...dialog.querySelectorAll('[name=orphan]:checked')].map(el=>el.value).filter(id=>!rowsById.has(id));if(!ids.length)throw Error('เลือกรายการที่ต้องการนำออกก่อน');confirmAction(`นำประวัติ ${ids.length} รายการออก?`,'การกู้คืนรายการเหล่านี้ต้องใช้ไฟล์สำรอง',()=>{save(d=>{for(const id of ids)delete d.items[id];});orphanHistory();});},
    'clear-exported':()=>confirmAction('ล้างสถานะรอส่งออก?', 'คำที่แก้ไขยังใช้งานในเครื่องตามเดิม กรุณาตรวจว่าได้รับไฟล์แล้ว',()=>{save(d=>exported.forEach(id=>delete d.pending[id]));exported=[];pending();}),
    sync:()=>{rebuild();const missing=Object.keys(data.items).filter(id=>!catalog.some(c=>c.id===id));showDialog('ผลตรวจคลังคำศัพท์',`<p>พร้อมเรียน ${catalog.length.toLocaleString()} คำ</p><p>คำที่ยังไม่มีภาพเรียนได้ตามปกติ</p><p class="muted small">ประวัติที่ไม่มีคำตรงในคลัง ${missing.length} รายการ ยังคงเก็บไว้ในข้อมูลสำรอง</p><details><summary>ข้อมูลที่ต้องตรวจ ${issues.length} รายการ</summary>${issues.map(i=>`<p class="small">${esc(labels[i.levelId])}: ${esc(i.word)} · ${esc(i.reason)}</p>`).join('')}</details>${button('ส่งออกรายงาน','export-issues','','wide quiet')}${button('จัดการประวัติที่ไม่พบคำ','orphans','','wide quiet')}`);},
    'export-issues':()=>download(`vocab-check-${today()}.json`,issues),
    update:async()=>{if(data.session&&data.session.phase!=='summary')save(d=>d.session.suspended=true);if(!('serviceWorker'in navigator))throw Error('เบราว์เซอร์นี้ไม่รองรับการอัปเดตออฟไลน์');const reg=await navigator.serviceWorker.getRegistration();if(!reg)throw Error('เปิดแอปผ่าน HTTPS หรือ localhost ก่อน');await reg.update();if(reg.waiting){updateRequested=true;reg.waiting.postMessage({type:'ACTIVATE_UPDATE'});notify('กำลังอัปเดต แอปจะโหลดใหม่เมื่อพร้อม');}else notify('ตรวจเวอร์ชันแล้ว หากมีเวอร์ชันใหม่กำลังดาวน์โหลดให้กดอัปเดตอีกครั้ง');},
    'reset-boxes':resetBoxes,
    'confirm-reset-boxes':()=>{const boxes=[...dialog.querySelectorAll('[name=reset-box]:checked')].map(x=>Number(x.value)),ids=levelCards().filter(c=>boxes.includes(item(c.id).box)).map(c=>c.id);if(!ids.length)throw Error('เลือกกล่องที่มีคำก่อน');confirmAction(`รีเซ็ต ${ids.length} คำ?`,'ล้างความคืบหน้าของคำที่เลือก คำศัพท์และการแก้ไขยังคงอยู่',()=>{save(d=>{for(const id of ids)d.items[id]=S.blank();d.session=null;});go('progress');});},
    'clear-needs':()=>confirmAction('ล้างรายการยังต้องฝึก?', 'ล้างป้ายรายการของระดับนี้ กล่องและวันทวนยังอยู่',()=>{save(d=>{for(const c of levelCards())if(d.items[c.id]){d.items[c.id].needsWord=false;d.items[c.id].needsContext=false;}});render();}),
    'reset-all':()=>confirmAction('คืนค่าความคืบหน้าทั้งหมด?', 'ล้างกล่อง ประวัติ และรอบค้างของคำศัพท์และไวยากรณ์ทุกภาษา คำศัพท์ที่เพิ่มและแก้ไขยังอยู่ ควรสำรองก่อนทำ',()=>{save(d=>{d.items={};d.session=null;d.grammar=GrammarScheduler.defaults();});go('today');})
  };
  function handleError(error){console.error(error);stop();notify(error.message||'ทำรายการไม่สำเร็จ');}
  document.addEventListener('click',async event=>{const b=event.target.closest('[data-action]');if(!b||b.disabled)return;try{flushExposures();await actions[b.dataset.action]?.(b);}catch(error){handleError(error);}});
  document.addEventListener('submit',event=>{
    event.preventDefault();try{flushExposures();
      if(event.target.id==='setup-form')startFromForm(event.target);
      if(event.target.id==='answer-form'){
        const {t,c,s}=current();if(s.phase!=='question')return;const answer=$('answer').value;
        const result=t.stage===5?VisualEngine.checkSentence(c.exercise,answer):VisualEngine.checkWord(c,answer);
        if(result.status==='empty'){$('answer-error').textContent='พิมพ์คำตอบ หรือเลือกดูเฉลย';return;}submit(result.status,answer);
      }
      if(event.target.id==='edit-form'){
        const {row,level}=readEdit(),id=editing.id||`${level}|custom-${Session.uid()}`;
        save(d=>{const before=d.pending[id]?d.pending[id].before:(editing.id?rowsById.get(id):null),type=d.pending[id]?.type||(editing.id?'edit':'add');d.edits[id]=row;d.pending[id]={at:Date.now(),level,type,before};Session.invalidate(d,id);});
        rebuild();closeDialog();render();notify('บันทึกคำศัพท์ในเครื่องแล้ว');
      }
    }catch(error){handleError(error);}
  });
  document.addEventListener('input',event=>{try{if(event.target.id==='search'){library.query=event.target.value;library.limit=60;renderLibraryResults();}if(event.target.id==='answer')save(d=>{if(d.session?.phase==='question')d.session.draft=event.target.value;});}catch(error){handleError(error);}});
  document.addEventListener('change',event=>{try{
    const el=event.target;
    if(el.id==='level'){save(d=>d.settings.level=el.value);selected.clear();library.limit=60;render();}
    if(el.id==='filter-box'){library.box=el.value;renderLibraryResults();}if(el.id==='filter-status'){library.status=el.value;renderLibraryResults();}if(el.id==='filter-language'){library.language=el.value;renderLibraryResults();}
    if(el.dataset.select){el.checked?selected.add(el.dataset.select):selected.delete(el.dataset.select);renderLibraryResults();}
    if(el.id==='restore-shift')previewRestore();
  }catch(error){handleError(error);}});
  document.addEventListener('keydown',event=>{if(event.target.id==='answer'&&event.key==='Enter'&&(event.isComposing||event.keyCode===229))event.preventDefault();});
  $('restore-file').addEventListener('change',async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>30*1024*1024)throw Error('ไฟล์ใหญ่เกิน 30 MB');restorePayload=JSON.parse(await file.text());previewRestore();}catch(error){handleError(error);}finally{event.target.value='';}});
  window.addEventListener('hashchange',()=>{if(!data||location.hash.slice(1)===page)return;try{flushExposures();stop();if(dialog.open)closeDialog();render(location.hash.slice(1));}catch(e){handleError(e);}});
  document.addEventListener('visibilitychange',()=>{try{if(document.hidden){flushExposures();stop();}else if(data&&page!=='study')render();}catch(e){handleError(e);}});
  window.addEventListener('pagehide',()=>{try{flushExposures();}catch(_){/* Stored answers remain intact if the device is out of space. */}stop();});
  window.addEventListener('storage',event=>{if(event.key===Store.KEY){stop();notify('ข้อมูลเปลี่ยนจากอีกหน้าต่าง กรุณาโหลดหน้าใหม่เพื่อใช้ข้อมูลล่าสุด');}});
  dialog.addEventListener('close',()=>{Audio.stop();if(page==='study'&&current().t?.invalidated)renderStudy();});
  try{store=Store.create(localStorage);data=store.read();grammarUI=GrammarUI.create({read:()=>data,save,go,notify,main,showDialog,closeDialog,exposeWords});rebuild();render(location.hash.slice(1)||'today');}
  catch(error){$('level').disabled=true;$('nav').hidden=true;main.innerHTML=`<div class="empty"><h1>เปิดข้อมูลไม่ได้</h1><p>${esc(error.message)}</p><div class="stack">${button('สำรองข้อมูลดิบ','raw-backup')}${button('กู้คืนจากไฟล์สำรอง','restore','','primary')}</div><p class="small">ข้อมูลเดิมยังไม่ถูกลบ ลองเปิดผ่านเบราว์เซอร์ปกติ หรือกู้คืนจากไฟล์สำรองหลังเก็บข้อมูลดิบแล้ว</p></div>`;}
  if('serviceWorker'in navigator){navigator.serviceWorker.register('sw.js').catch(()=>notify('ยังติดตั้งออฟไลน์ไม่ได้ การเรียนยังใช้งานได้'));let reloading=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(updateRequested&&!reloading&&navigator.serviceWorker.controller){reloading=true;location.reload();}});}
})();
