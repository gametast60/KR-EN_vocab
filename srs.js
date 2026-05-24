// ==========================================================
// SRS ENGINE — แยก key ตาม topik (topik1 / topik2)
// ==========================================================

const SRS_DATE     = "topik_srs_date";
const SRS_SETTINGS = "topik_srs_settings";
const BOX_INTERVALS = [0, 1, 3, 7, 14, Infinity];

const WRONG_BOX_MAX = 30;       // กล่อง 6 จุได้สูงสุด 30 คำ
const DUE_CHUNK_SIZE = 20;      // ทวนวันนี้ทีละกี่คำ (ปรับได้)

// key ที่ใช้เก็บ SRS data แยกตาม topik
function srsKey() {
  return `topik_srs_${currentTopik || "topik1"}_v1`;
}
// key กล่อง 6 (wrong box) แยกตาม topik รีเซ็ตทุกวัน
function wrongBoxKey() {
  return `topik_wrongbox_${currentTopik || "topik1"}`;
}

function getNewWordsPerDay() {
  const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
  return s.newPerDay || 20;
}
function setNewWordsPerDay(n) {
  const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
  s.newPerDay = n;
  localStorage.setItem(SRS_SETTINGS, JSON.stringify(s));
}

function getDueChunkSize() {
  const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
  return s.dueChunkSize || DUE_CHUNK_SIZE;
}
function setDueChunkSize(n) {
  const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
  s.dueChunkSize = n;
  localStorage.setItem(SRS_SETTINGS, JSON.stringify(s));
}

function loadSRS() {
  try { return JSON.parse(localStorage.getItem(srsKey()) || "{}"); }
  catch(e) { return {}; }
}
function saveSRS(data) {
  localStorage.setItem(srsKey(), JSON.stringify(data));
}

// ==========================================================
// WRONG BOX (กล่อง 6) — รีเซ็ตทุกวัน 00:00
// ==========================================================
function loadWrongBox() {
  try {
    const raw = JSON.parse(localStorage.getItem(wrongBoxKey()) || "{}");
    // รีเซ็ตถ้าวันเปลี่ยน
    if (raw.date !== todayStr()) return { date: todayStr(), words: [] };
    return raw;
  } catch(e) { return { date: todayStr(), words: [] }; }
}
function saveWrongBox(wb) {
  localStorage.setItem(wrongBoxKey(), JSON.stringify(wb));
}
function getWrongBoxWords() {
  return loadWrongBox().words || [];
}
function addToWrongBox(item) {
  const wb = loadWrongBox();
  if (wb.words.length >= WRONG_BOX_MAX) return; // เต็มแล้ว
  if (!wb.words.some(w => w.word === item.word)) {
    wb.words.push({ word: item.word, meaning: item.meaning });
    saveWrongBox(wb);
  }
}
function isWrongBoxFull() {
  return loadWrongBox().words.length >= WRONG_BOX_MAX;
}
function clearWrongBox() {
  saveWrongBox({ date: todayStr(), words: [] });
}

// ==========================================================
// DATE HELPERS
// ==========================================================
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// รีเซ็ทคำใหม่รายวัน (counter แยกตาม topik)
function checkDailyReset() {
  const today = todayStr();
  const dateKey = `${SRS_DATE}_${currentTopik}`;
  if (localStorage.getItem(dateKey) !== today) {
    const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
    const countKey = `todayNewWords_${currentTopik}`;
    s[countKey] = 0;
    localStorage.setItem(SRS_SETTINGS, JSON.stringify(s));
    localStorage.setItem(dateKey, today);
  }
}

// โหลดคำศัพท์ของ topik ปัจจุบันเข้า SRS (ครั้งแรกเท่านั้น)
function initAllVocab() {
  const vocab = (typeof getTopikVocab === "function")
    ? getTopikVocab(currentTopik)
    : [];
  const data = loadSRS();
  let changed = false;

  // 1. สร้าง Map หรือ Object ของคำศัพท์ปัจจุบันในไฟล์ .js เพื่อให้เช็คได้เร็วขึ้น
  const currentVocabMap = {};
  vocab.forEach(item => {
    currentVocabMap[item.word] = item.meaning;
  });

  // 2. ลบคำศัพท์ในคลัง SRS ที่ไม่มีอยู่ในไฟล์ .js ปัจจุบันออก (แก้ไขปัญหายอดเกิน)
  Object.keys(data).forEach(word => {
    if (!currentVocabMap[word]) {
      delete data[word];
      changed = true;
    } else if (data[word].meaning !== currentVocabMap[word]) {
      // แถมให้อีกนิด: ถ้าความหมายในไฟล์เปลี่ยน ให้เปลี่ยนตามด้วย
      data[word].meaning = currentVocabMap[word];
      changed = true;
    }
  });

  // 3. เพิ่มคำศัพท์ใหม่จากไฟล์ .js เข้าคลัง
  vocab.forEach(item => {
    if (!data[item.word]) {
      data[item.word] = { word: item.word, meaning: item.meaning, box: 0, nextReview: null };
      changed = true;
    }
  });

  if (changed) saveSRS(data);
}

function getBoxCounts() {
  const data = loadSRS();
  const counts = [0,0,0,0,0,0];
  Object.values(data).forEach(item => { counts[Math.min(item.box,5)]++; });
  return counts;
}

// คำที่ถึงเวลาทวน (box 1-4)
function getDueWords() {
  const data  = loadSRS();
  const today = todayStr();
  return Object.values(data).filter(item => {
    if (item.box === 0) return true;
    if (item.box >= 1 && item.box <= 4)
      return item.nextReview && item.nextReview <= today;
    return false;
  });
}

// ดึง chunk ทวนวันนี้ — loop ซ้ำได้เรื่อยๆ จนกล่อง 6 เต็ม
// ไม่กรองคำออก เพราะจุดประสงค์คือทวนจนกว่าจะจำได้ (กล่อง 6 เต็ม)
function getDueChunk() {
  const allDue = getDueWords();
  if (allDue.length === 0) return [];
  return shuffleArraySRS([...allDue]).slice(0, getDueChunkSize());
}

function getNewWords(limit) {
  const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
  const usedToday = s[`todayNewWords_${currentTopik}`] || 0;
  const remaining = Math.max(0, limit - usedToday);
  if (remaining <= 0) return [];
  return Object.values(loadSRS()).filter(item => item.box === 0).slice(0, remaining);
}

// "ฝึกหัด" — สุ่มจากกล่อง 0-5 ทั้งหมด ไม่มีผล SRS
function getPracticeWords(limit) {
  const data = loadSRS();
  const all = Object.values(data);
  return shuffleArraySRS(all).slice(0, limit || 20);
}

function getMixWords() {
  const data   = loadSRS();
  const result = [];
  for (let box = 1; box <= 5; box++) {
    const words = Object.values(data).filter(item => item.box === box);
    result.push(...shuffleArraySRS([...words]).slice(0, 4));
  }
  return shuffleArraySRS(result);
}

function shuffleArraySRS(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function recordAnswer(word, correct) {
  const data  = loadSRS();
  const today = todayStr();
  const item  = data[word];
  if (!item) return;

  const wasNew = item.box === 0;

  if (correct) {
    item.box = Math.min(item.box + 1, 5);
    const interval = BOX_INTERVALS[item.box];
    item.nextReview = interval === Infinity ? null : addDays(today, interval);
  } else {
    item.box = 1;
    item.nextReview = addDays(today, 1);
  }
  data[word] = item;
  saveSRS(data);

  if (wasNew) {
    const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
    const countKey = `todayNewWords_${currentTopik}`;
    s[countKey] = (s[countKey] || 0) + 1;
    localStorage.setItem(SRS_SETTINGS, JSON.stringify(s));
  }
}

function getSRSStats() {
  const data  = loadSRS();
  const today = todayStr();
  const all   = Object.values(data);
  return {
    total:    all.length,
    learned:  all.filter(i => i.box >= 1).length,
    mastered: all.filter(i => i.box === 5).length,
    dueToday: getDueWords().length,
    newLeft:  all.filter(i => i.box === 0).length,
  };
}