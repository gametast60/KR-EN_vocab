
const SRS_DATE      = "topik_srs_date";
const BOX_INTERVALS  = [0, 1, 3, 7, 14, Infinity];
const BOX5_CHUNK_SIZE = 30;   // คำ/วัน จากกล่อง 5
const BOX5_INTERVAL   = 30;   // วันก่อนทวนซ้ำหลังตอบถูก

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
// key สำหรับ Box 5 Queue (2 keys)
function box5QueueKey()   { return `topik_box5_queue_${currentTopik || "topik1"}`; }
function box5PointerKey() { return `topik_box5_pointer_${currentTopik || "topik1"}`; }

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
// BOX 5 QUEUE — ทวนระยะยาว 30 วัน/รอบ
// ==========================================================

/**
 * Migration: สร้าง Queue กล่อง 5 ครั้งแรก (guard ป้องกันรันซ้ำ)
 * เรียกจาก initAllVocab() — ทำครั้งเดียวต่อ topik
 */
function initBox5Queue() {
  // Guard: ถ้ามี queue อยู่แล้ว → ออกเลย
  if (localStorage.getItem(box5QueueKey()) !== null) return;

  const data      = loadSRS();
  const today     = todayStr();
  const box5words = Object.values(data).filter(i => i.box === 5).map(i => i.word);
  if (box5words.length === 0) return;

  const shuffled   = shuffleArray([...box5words]);
  const firstBatch = shuffled.slice(0, BOX5_CHUNK_SIZE);
  firstBatch.forEach(word => { if (data[word]) data[word].nextReview = today; });
  saveSRS(data);

  localStorage.setItem(box5QueueKey(),   JSON.stringify(shuffled));
  localStorage.setItem(box5PointerKey(), String(firstBatch.length));
}

/**
 * เรียกทุกวันเมื่อวันเปลี่ยน — ดึง 30 คำถัดไปจาก Queue
 * Anti-accumulate (แบบ B): ถ้ายังมีคำ Box5 due ค้าง → skip
 */
function processDailyBox5Queue() {
  const data  = loadSRS();
  const today = todayStr();

  // ① ป้องกัน accumulate: ถ้ายังมี box5 ที่ due แต่ยังไม่ทวน → skip
  const existingDue = Object.values(data).filter(i =>
    i.box === 5 && i.nextReview && i.nextReview <= today
  );
  if (existingDue.length > 0) return;

  // ② โหลด queue + pointer (ถ้าไม่มี → migration)
  const raw = localStorage.getItem(box5QueueKey());
  if (raw === null) { initBox5Queue(); return; }
  let queue   = JSON.parse(raw);
  let pointer = parseInt(localStorage.getItem(box5PointerKey()) || "0", 10);

  // ③ Ghost filter: เฉพาะคำที่ยังอยู่ใน box 5
  queue = queue.filter(w => data[w] && data[w].box === 5);

  // ④ Rebuild queue เมื่อ pointer ครบรอบ — สร้างจากคำ box5 ปัจจุบันทั้งหมด
  if (pointer >= queue.length) {
    const allBox5 = Object.values(data).filter(i => i.box === 5).map(i => i.word);
    if (allBox5.length === 0) return;
    queue   = shuffleArray([...allBox5]);
    pointer = 0;
  }

  // ⑤ ดึง 30 คำถัดไป → nextReview = วันนี้
  const batch = queue.slice(pointer, pointer + BOX5_CHUNK_SIZE);
  batch.forEach(word => { if (data[word]) data[word].nextReview = today; });
  pointer += batch.length;

  saveSRS(data);
  localStorage.setItem(box5QueueKey(),   JSON.stringify(queue));
  localStorage.setItem(box5PointerKey(), String(pointer));
}

/**
 * ลบคำออกจาก Box5 Queue ทันที (เรียกตอนตอบผิด → box 1)
 * Queue สั้นลงเอง pointer ยังคงเดินต่อได้
 */
function removeWordFromBox5Queue(word) {
  const raw = localStorage.getItem(box5QueueKey());
  if (raw === null) return;
  const queue = JSON.parse(raw).filter(w => w !== word);
  localStorage.setItem(box5QueueKey(), JSON.stringify(queue));
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
    processDailyBox5Queue();                          // ← Box5 Queue รายวัน
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
  initBox5Queue(); // Migration: สร้าง Queue กล่อง 5 ครั้งแรก (guard อยู่ในฟังก์ชัน)
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

// คำที่ถึงเวลาทวน (box 1-5)
function getDueWords() {
  const data  = loadSRS();
  const today = todayStr();
  return Object.values(data).filter(item => {
    if (item.box === 0) return true;
    if (item.box >= 1 && item.box <= 5)               // ← รวม box 5
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
    item.box >= 1 && item.box <= 5 &&               // ← รวม box 5
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

  if (item.box === 5) {
    // กล่อง 5: ระบบทวนระยะยาว
    if (correct) {
      item.box        = 5;
      item.nextReview = addDays(today, BOX5_INTERVAL); // คงกล่อง 5, +30 วัน
    } else {
      item.box        = 1;
      item.nextReview = addDays(today, 1);             // กลับกล่อง 1, พรุ่งนี้
      removeWordFromBox5Queue(word);                   // ลบออก Queue ทันที
    }
  } else {
    // กล่อง 0-4: SRS ปกติ
    if (correct) {
      item.box = Math.min(item.box + 1, 5);
      if (item.box === 5) {
        // เพิ่งเข้า box 5 (จาก box 4) → ใช้ interval 30 วัน
        item.nextReview = addDays(today, BOX5_INTERVAL);
      } else {
        item.nextReview = addDays(today, BOX_INTERVALS[item.box]);
      }
    } else {
      item.box        = 1;
      item.nextReview = addDays(today, 1);
    }
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
    return box >= 1 && box <= 5 &&                    // ← รวม box 5
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