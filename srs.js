
const SRS_DATE     = "topik_srs_date";
const BOX_INTERVALS = [0, 1, 3, 7, 14, Infinity];

// key สำหรับ settings แยกตาม topik
function srsSettingsKey() {
  return `topik_srs_settings_${currentTopik || "topik1"}`;
}

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

function getDueChunkSize() {
  const s = JSON.parse(localStorage.getItem(srsSettingsKey()) || "{}");
  return s.dueChunkSize || DUE_CHUNK_SIZE;
}
function setDueChunkSize(n) {
  const s = JSON.parse(localStorage.getItem(srsSettingsKey()) || "{}");
  s.dueChunkSize = n;
  localStorage.setItem(srsSettingsKey(), JSON.stringify(s));
}

function getWrongChunkSize() {
  const s = JSON.parse(localStorage.getItem(srsSettingsKey()) || "{}");
  return s.wrongChunkSize || 15;
}
function setWrongChunkSize(n) {
  const s = JSON.parse(localStorage.getItem(srsSettingsKey()) || "{}");
  s.wrongChunkSize = n;
  localStorage.setItem(srsSettingsKey(), JSON.stringify(s));
}

function getPracticeChunkSize() {
  const s = JSON.parse(localStorage.getItem(srsSettingsKey()) || "{}");
  return s.practiceChunkSize || 10;
}
function setPracticeChunkSize(n) {
  const s = JSON.parse(localStorage.getItem(srsSettingsKey()) || "{}");
  s.practiceChunkSize = n;
  localStorage.setItem(srsSettingsKey(), JSON.stringify(s));
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
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// รีเซ็ทคำใหม่รายวัน (counter แยกตาม topik)
function checkDailyReset() {
  const today = todayStr();
  const dateKey = `${SRS_DATE}_${currentTopik}`;
  if (localStorage.getItem(dateKey) !== today) {
    const s = JSON.parse(localStorage.getItem(srsSettingsKey()) || "{}");
    const countKey = `todayNewWords_${currentTopik}`;
    s[countKey] = 0;
    localStorage.setItem(srsSettingsKey(), JSON.stringify(s));
    localStorage.setItem(dateKey, today);
  }
}

// โหลดคำศัพท์ของ topik ปัจจุบันเข้า SRS (ครั้งแรกเท่านั้น)
function initAllVocab() {
  const vocab = (typeof getTopikVocab === "function")
    ? getTopikVocab(currentTopik)
    : [];

  // ป้องกันกรณีไฟล์ข้อมูลไม่โหลดหรือเกิดความผิดพลาดในการดึงข้อมูล
  if (!Array.isArray(vocab) || vocab.length === 0) {
    console.warn("Vocab not loaded for current topik:", currentTopik);
    return;
  }

  const data = loadSRS();
  let changed = false;

  // 1. เพิ่มคำศัพท์ใหม่ หรืออัปเดตความหมายใหม่โดยไม่มีการลบคำเก่าอัติโนมัติ
  vocab.forEach(item => {
    if (!data[item.word]) {
      data[item.word] = { word: item.word, meaning: item.meaning, box: 0, nextReview: null };
      changed = true;
    } else if (data[item.word].meaning !== item.meaning) {
      data[item.word].meaning = item.meaning;
      changed = true;
    }
  });

  if (changed) saveSRS(data);
}

function getBoxCounts() {
  const data = loadSRS();
  const counts = [0,0,0,0,0,0];
  const items = Object.values(data);
  const total = items.length;
  items.forEach(item => {
    let box = (item.box === undefined || item.box === null) ? 0 : Number(item.box);
    if (box >= 1) {
      counts[Math.min(box, 5)]++;
    }
  });
  counts[0] = Math.max(0, total - (counts[1] + counts[2] + counts[3] + counts[4] + counts[5]));
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
  const total = all.length;
  const counts = [0,0,0,0,0,0];
  all.forEach(item => {
    let box = (item.box === undefined || item.box === null) ? 0 : Number(item.box);
    if (box >= 1) {
      counts[Math.min(box, 5)]++;
    }
  });
  const learned = all.filter(i => {
    let box = (i.box === undefined || i.box === null) ? 0 : Number(i.box);
    return box >= 1;
  }).length;
  const mastered = counts[5];
  const dueToday = all.filter(item => {
    let box = (item.box === undefined || item.box === null) ? 0 : Number(item.box);
    return box >= 1 && box <= 4 &&
           item.nextReview && item.nextReview <= today;
  }).length;
  const newLeft = Math.max(0, total - (counts[1] + counts[2] + counts[3] + counts[4] + counts[5]));

  return {
    total,
    learned,
    mastered,
    dueToday,
    newLeft
  };
}