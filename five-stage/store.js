(function (root) {
  'use strict';
  const KEY = 'five_stage_mvp_v1';
  const levels = ['topik1','topik2','english_a1','english_a2','english_b1','english_b2'];
  const clone = value => JSON.parse(JSON.stringify(value));
  const id = (level, word) => `${level}|${encodeURIComponent(word)}`;
  const defaults = () => ({ version: 1, revision: 0, settings: { level: 'topik1', count: 10, autoAudio: true, autoNext: true, warning: 90, practiceBoxes: [0,1,2,3,4,5] }, items: {}, edits: {}, pending: {}, session: null, migrationNotes: [] });
  const validDate = value => value === null || typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
  function validate(data) {
    function safe(value) { if(!value || typeof value!=='object')return;for(const key of Object.keys(value)){if(['__proto__','constructor','prototype'].includes(key))throw Error('ไฟล์มีคีย์ที่ไม่รองรับ');safe(value[key]);} }
    safe(data);
    if(data && root.GrammarScheduler){if(data.grammar===undefined)data.grammar=root.GrammarScheduler.defaults();root.GrammarScheduler.validate(data.grammar);}
    if (!data || data.version !== 1 || !data.settings || !levels.includes(data.settings.level) || !Number.isInteger(data.settings.count) || data.settings.count < 1 || data.settings.count > 200) throw Error('ไฟล์ข้อมูลหรือการตั้งค่าไม่ถูกต้อง');
    if(!Number.isInteger(data.revision)||data.revision<0||!Array.isArray(data.migrationNotes)||!data.migrationNotes.every(x=>typeof x==='string')||!Array.isArray(data.settings.practiceBoxes)||!data.settings.practiceBoxes.every(n=>Number.isInteger(n)&&n>=0&&n<=5)||!Number.isInteger(data.settings.warning)||data.settings.warning<1||data.settings.warning>9999||typeof data.settings.autoAudio!=='boolean'||typeof data.settings.autoNext!=='boolean')throw Error('การตั้งค่าหรือเวอร์ชันข้อมูลไม่ถูกต้อง');
    const eventOK = e => e && typeof e.id==='string' && Number.isFinite(e.at) && ['word','context',undefined].includes(e.skill) && ['correct','incorrect','revealed','skipped','invalidated','learned','known','unknown'].includes(e.status) && (e.answer===undefined||typeof e.answer==='string');
    for (const key of ['items','edits','pending']) if (!data[key] || typeof data[key] !== 'object' || Array.isArray(data[key])) throw Error('โครงสร้างข้อมูลไม่ถูกต้อง');
    for (const [key, item] of Object.entries(data.items)) {
      if (!levels.some(level => key.startsWith(level+'|')) || !Number.isInteger(item.box) || item.box < 0 || item.box > 5 || !validDate(item.nextReview) || !validDate(item.contextDue ?? null) || !Array.isArray(item.history)||!item.history.every(eventOK)) throw Error('ข้อมูลกล่องหรือวันทวนไม่ถูกต้อง');
      for(const time of [item.lastExposure,item.contextExposure,item.lastCold?.at])if(time!==undefined&&!Number.isFinite(time))throw Error('เวลาทบทวนไม่ถูกต้อง');
    }
    for (const [key, edit] of Object.entries(data.edits)) if (!levels.some(level=>key.startsWith(level+'|')) || !edit || typeof edit.word !== 'string' || !edit.word.trim() || typeof edit.meaning !== 'string' || !edit.meaning.trim()) throw Error('ข้อมูลคำศัพท์ที่แก้ไขไม่ถูกต้อง');
    if (data.session && (!Array.isArray(data.session.tasks) || !Array.isArray(data.session.cards) || !Number.isInteger(data.session.cursor) || data.session.cursor < 0 || data.session.cursor > data.session.tasks.length || !levels.includes(data.session.level))) throw Error('ข้อมูลรอบเรียนไม่ถูกต้อง');
    if(data.session){const s=data.session;if(!['question','feedback','summary'].includes(s.phase)||!['due','new','practice','needs'].includes(s.mode)||!['adaptive','word','sentence','listen'].includes(s.format)||!Array.isArray(s.events)||!s.events.every(eventOK)||!Array.isArray(s.contextStarted)||!Number.isFinite(s.startedAt)||typeof s.draft!=='string')throw Error('สถานะรอบเรียนไม่ถูกต้อง');
      if(!s.cards.every(c=>c&&typeof c.id==='string'&&c.levelId===s.level&&typeof c.word==='string'&&typeof c.displayWord==='string'&&typeof c.meaning==='string'&&c.exercise&&['en','ko'].includes(c.language)&&(!c.file||/^visual\/images\/\d{4,}\.(webp|png)$/.test(c.file))))throw Error('ข้อมูลการ์ดในรอบไม่ถูกต้อง');
      if(!s.tasks.every(t=>t&&typeof t.id==='string'&&[1,2,3,4,5,6].includes(t.stage)&&s.cards.some(c=>c.id===t.cardId)))throw Error('ลำดับรอบเรียนไม่ถูกต้อง');
    }
    return data;
  }
  function migrate(legacy, now) {
    const data = defaults(), S = root.FiveStageScheduler;
    for (const level of levels) {
      let records = {};
      const parse = (key, fallback) => {
        try { const raw = legacy[key]; return raw == null ? fallback : typeof raw === 'string' ? JSON.parse(raw) : raw; }
        catch (_) { data.migrationNotes.push(key); return fallback; }
      };
      records = parse(`topik_srs_${level}_v1`, {});
      for (const [word, old] of Object.entries(records || {})) {
        if (!old || !Number.isInteger(Number(old.box)) || Number(old.box)<0 || Number(old.box)>5) { data.migrationNotes.push(`${level}: ${word}`); continue; }
        const box = Number(old.box);
        data.items[id(level,word)] = { ...S.blank(), box, nextReview: validDate(old.nextReview) ? old.nextReview : box ? S.date(now) : null };
        if (box && !data.items[id(level,word)].nextReview) data.items[id(level,word)].nextReview = S.date(now);
      }
      const wrong = parse(`topik_wrongbox_${level}`, {});
      for (const word of Array.isArray(wrong?.words)?wrong.words:[]) if (typeof word.word === 'string') {
        const key = id(level,word.word);
        data.items[key] ||= S.blank(); data.items[key].needsWord = true;
      }
      const staged = parse(`${level}_vocab_edits`, []);
      for (const edit of Array.isArray(staged)?staged:[]) {
        if (!edit?.word || !edit.newMeaning) continue;
        // Preserve staged edits for export; apply through the common overlay when catalog is available.
        const key = id(level,edit.word);
        data.edits[key] = { word: edit.word, meaning: edit.newMeaning, _legacyMeaningOnly: edit.type !== 'add' };
        data.pending[key] = { at: now, level, type: edit.type || 'edit', before: edit.oldMeaning ? {word:edit.word,meaning:edit.oldMeaning}:null };
      }
      const settings = parse(`topik_srs_settings_${level}`, {});
      if (level === 'topik1' && Number.isInteger(settings.dueChunkSize)) data.settings.count = Math.max(1,Math.min(200,settings.dueChunkSize));
    }
    return data;
  }
function previewBackup(payload, now = Date.now(), shift = false) {
        let next;
        if (payload?.format === 'five-stage' && payload.version === 1) next = clone(validate(payload.data));
        else if (payload?.localStorage && typeof payload.localStorage === 'object' && (!payload.backupFormat || payload.backupFormat <= 3)) {
          const legacy = { ...payload.localStorage };
          for (const [level, edits] of Object.entries(payload.vocabEdits || {})) legacy[`${level}_vocab_edits`] = edits;
          next = legacy[KEY] ? clone(validate(typeof legacy[KEY]==='string'?JSON.parse(legacy[KEY]):legacy[KEY])) : migrate(legacy, now);
        } else throw Error('ไฟล์นี้ไม่ใช่ไฟล์สำรองของแอป');
        if (shift) {
          const backupDay = (payload.createdAt || payload.backupDate || root.FiveStageScheduler.date(now)).slice(0,10);
          const today = root.FiveStageScheduler.date(now);
          const delta = Math.max(0, Math.round((Date.parse(today)-Date.parse(backupDay))/86400000));
          for (const item of Object.values(next.items)) for (const field of ['nextReview','contextDue']) if (item[field]) item[field] = root.FiveStageScheduler.addDays(new Date(item[field]+'T12:00:00').getTime(),delta);
          if(next.grammar)for(const item of Object.values(next.grammar.items))if(item.dueAt)item.dueAt+=delta*86400000;
        }
        return validate(next);
      }
  function create(storage, now = Date.now()) {
    let state;
    const raw = storage.getItem(KEY);
    if (raw) { try { state = validate(JSON.parse(raw)); } catch (error) { throw Error('เปิดข้อมูลที่บันทึกไม่ได้ กรุณาสำรองข้อมูลดิบก่อนกู้คืน: '+error.message); } }
    else {
      const legacy = {};
      for (let i=0; i<storage.length; i++) { const key=storage.key(i); if (key?.startsWith('topik_') || key?.endsWith('_vocab_edits')) legacy[key]=storage.getItem(key); }
      state = validate(migrate(legacy, now)); storage.setItem(KEY, JSON.stringify(state));
    }
    function transact(mutator) {
      const latest = storage.getItem(KEY);
      if (latest && JSON.parse(latest).revision !== state.revision) throw Error('ข้อมูลเปลี่ยนจากอีกหน้าต่าง กรุณาโหลดหน้าใหม่ก่อนทำต่อ');
      const next = clone(state); mutator(next); next.revision = (state.revision || 0)+1; validate(next);
      storage.setItem(KEY, JSON.stringify(next)); state = next;
      return clone(state);
    }
    return {
      read: () => clone(state), transact,
      backup: () => ({ format: 'five-stage', version: 1, createdAt: new Date().toISOString(), data: clone(state) }),
      preview: previewBackup,
      restore(next) { return transact(draft => { const revision=draft.revision; Object.assign(draft, clone(validate(next)), { revision }); }); }
    };
  }
  root.FiveStageStore = Object.freeze({ KEY, levels, id, defaults, validate, migrate, preview: previewBackup, create });
  if (typeof module !== 'undefined') module.exports = root.FiveStageStore;
})(typeof window !== 'undefined' ? window : globalThis);
