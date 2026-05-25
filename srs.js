// ==========================================================
// SRS ENGINE — แยก key ตาม topik (topik1 / topik2)
// ==========================================================

const SRS_DATE     = "topik_srs_date";
const SRS_SETTINGS = "topik_srs_settings";
const BOX_INTERVALS = [0, 1, 3, 7, 14, Infinity];

const WRONG_BOX_MAX = 30;       // กล่อง 6 จุได้สูงสุด 30 คำ
const DUE_CHUNK_SIZE = 15;      // ทวนวันนี้ทีละกี่คำ (ปรับได้)

// key ที่ใช้เก็บ SRS data แยกตาม topik
function srsKey() {
  return `topik_srs_${currentTopik || "topik1"}_v1`;
}
// key กล่อง 6 (wrong box) แยกตาม topik รีเซ็ตทุกวัน
function wrongBoxKey() {
  return `topik_wrongbox_${currentTopik || "topik1"}`;
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

function getWrongChunkSize() {
  const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
  return s.wrongChunkSize || 30;
}
function setWrongChunkSize(n) {
  const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
  s.wrongChunkSize = n;
  localStorage.setItem(SRS_SETTINGS, JSON.stringify(s));
}

function getPracticeChunkSize() {
  const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
  return s.practiceChunkSize || 10;
}
function setPracticeChunkSize(n) {
  const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
  s.practiceChunkSize = n;
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
    if (raw.date !== todayStr()) {
      const fresh = { date: todayStr(), words: [] };
      saveWrongBox(fresh);
      return fresh;
    }
    return raw;
  } catch(e) {
    const fresh = { date: todayStr(), words: [] };
    saveWrongBox(fresh);
    return fresh;
  }
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
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

function getDueChunk() {
  const data  = loadSRS();
  const today = todayStr();
  const all   = Object.values(data);
  const limit = getDueChunkSize();

  const due = all.filter(item =>
    item.box >= 1 && item.box <= 4 &&
    item.nextReview && item.nextReview <= today
  );

  const newWords = all.filter(item => item.box === 0);

  const combined = [
    ...shuffleArray(due),
    ...shuffleArray(newWords),
  ];

  return combined.slice(0, limit);
}

// "ฝึกหัด" — สุ่มจากกล่อง 0-5 ทั้งหมด ไม่มีผล SRS
function getPracticeWords(limit) {
  const data = loadSRS();
  const all = Object.values(data);
  return shuffleArray(all).slice(0, limit || 20);
}

function recordAnswer(word, correct) {
  const data  = loadSRS();
  const today = todayStr();
  const item  = data[word];
  if (!item) return;

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
}

function getSRSStats() {
  const data  = loadSRS();
  const today = todayStr();
  const all   = Object.values(data);
  return {
    total:    all.length,
    learned:  all.filter(i => i.box >= 1).length,
    mastered: all.filter(i => i.box === 5).length,
    dueToday: Object.values(loadSRS()).filter(item =>
  item.box >= 1 && item.box <= 4 &&
  item.nextReview && item.nextReview <= todayStr()
).length,
    newLeft:  all.filter(i => i.box === 0).length,
  };
}