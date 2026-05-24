// =========================
// HISTORY & STATE
// =========================
let screenHistory = [];
let currentTopik  = "";   // "topik1" | "topik2"

const backButton = document.getElementById("backButton");
const homeButton = document.getElementById("homeButton");

let currentVocabulary = [];

// SRS session
let srsSessionWords = [];
let srsSessionMode  = "";
let srsSessionType  = "";   // "due" | "practice" | "wrongbox"
let srsWrongList    = [];

// ทวนวันนี้ — tracking chunk
let dueAllWords    = [];   // คำ due ทั้งหมดวันนี้ (ไม่ลด)
let dueUsedWords   = [];   // คำที่ผ่าน session ไปแล้ว

// =========================
// VOCAB MAP PER TOPIK
// =========================
function getTopikVocab(topik) {
  if (topik === "topik1") return window.flashVocabData1 || [];
  if (topik === "topik2") return window.flashVocabData2 || [];
  return [];
}

// =========================
// SHOW SCREEN
// =========================
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  const t = document.getElementById(screenId);
  if (t) t.classList.remove("hidden");
}

// =========================
// GO TO
// =========================
function goTo(screenId) {
  const cur = document.querySelector(".screen:not(.hidden)");
  if (cur) screenHistory.push(cur.id);
  showScreen(screenId);
  updateButtons();
}

// =========================
// BACK
// =========================
function goBack() {
  if (screenHistory.length === 0) return;
  showScreen(screenHistory.pop());
  updateButtons();
}

// =========================
// MAIN MENU (topik chooser)
// =========================
function showMainMenu() {
  screenHistory = [];
  currentTopik  = "";
  document.getElementById("appTitle").textContent = "TOPIK Vocab by 톤님";
  showScreen("mainMenu");
  updateButtons();
}

// =========================
// OPEN TOPIK → SRS DASHBOARD
// =========================
function openTopik(topik) {
  currentTopik = topik;
  document.getElementById("appTitle").textContent =
    topik === "topik1" ? "TOPIK 1 by 톤님" : "TOPIK 2 by 톤님";
  goTo("srsDashboard");
  renderSRSHome();
}

function goToSRSDashboard() {
  screenHistory = screenHistory.filter(id => id !== "srsDashboard");
  goTo("srsDashboard");
  renderSRSHome();
}

// =========================
// BUTTONS
// =========================
function updateButtons() {
  const helpBtn = document.getElementById("helpButton");
  if (screenHistory.length === 0) {
    backButton.classList.add("hidden");
    homeButton.classList.add("hidden");
    helpBtn.classList.add("hidden");
  } else {
    backButton.classList.remove("hidden");
    homeButton.classList.remove("hidden");
    helpBtn.classList.remove("hidden");
  }
}

function showHelp() {
  document.getElementById("helpModal").classList.remove("hidden");
}
function closeHelpBtn() {
  document.getElementById("helpModal").classList.add("hidden");
}
function closeHelp(e) {
  if (e.target === document.getElementById("helpModal")) closeHelpBtn();
}

// =========================
// COMING SOON
// =========================
function showComingSoon() {
  alert("🚀 เจอกันเร็วๆนี้ครับ!");
}

// ==========================================
// SRS HOME RENDER
// ==========================================
function renderSRSHome() {
  checkDailyReset();
  initAllVocab();

  const counts    = getBoxCounts();
  const due       = getDueWords();
  const wrongBox  = getWrongBoxWords();

  const BOX_LABELS = ["ใหม่","1วัน","3วัน","7วัน","14วัน","จำได้✅"];
  const BOX_COLORS = ["#6b7280","#3b82f6","#8b5cf6","#f59e0b","#ef4444","#16a34a"];

  const boxRow = document.getElementById("srsBoxRow");
  if (!boxRow) return;

  // กล่อง 0-5
  let boxHtml = "";
  for (let i = 0; i <= 5; i++) {
    boxHtml += `
      <div class="srs-box" style="--box-color:${BOX_COLORS[i]}">
        <div class="srs-box-count">${counts[i]}</div>
        <div class="srs-box-label">${BOX_LABELS[i]}</div>
      </div>`;
  }
  // กล่อง 6 — wrong box
  const wbFull = wrongBox.length >= WRONG_BOX_MAX;
  boxHtml += `
    <div class="srs-box srs-box-wrongbox" style="--box-color:#db2777" title="คำผิดวันนี้ (รีเซ็ตพรุ่งนี้)">
      <div class="srs-box-count">${wrongBox.length}</div>
      <div class="srs-box-label">❌คำผิด</div>
      ${wbFull ? '<div class="srs-box-full">เต็ม</div>' : ''}
    </div>`;
  boxRow.innerHTML = boxHtml;

  // Action buttons
  const actions = document.getElementById("srsActions");
  const dueChunk = getDueChunk();
  actions.innerHTML = `
    <button class="srs-action-btn srs-due-btn" onclick="openSRSDue()">
      📅 ทวนวันนี้
      <span class="srs-badge">${due.length} คำ</span>
    </button>
    <button class="srs-action-btn srs-wrongbox-btn" onclick="${wrongBox.length === 0 ? 'alertNoWrongWords()' : 'openWrongBox()'}">
      ❌ ทวนคำผิด
      <span class="srs-badge">${wrongBox.length} / ${WRONG_BOX_MAX}</span>
    </button>
    <button class="srs-action-btn srs-new-btn" onclick="openPractice()">
      🎮 ฝึกหัด
      <span class="srs-badge">${Object.values(loadSRS()).length} คำ</span>
    </button>
    <button class="srs-action-btn srs-stat-btn" onclick="openSRSStats()">
      📊 สถิติ
    </button>
    <button class="srs-action-btn srs-settings-btn" onclick="openSettings()">
      ⚙️ ตั้งค่า
    </button>`;
}

// ==========================================
// ทวนวันนี้ — SRS Flashcard เป็น chunk
// ==========================================
function openSRSDue() {
  checkDailyReset();
  initAllVocab();

  // ถ้ากล่องคำผิดเต็มแล้ว — หยุดเล่นวันนี้
  if (isWrongBoxFull()) {
    alert("🛑 วันนี้พอแล้ว!\n\nกล่องคำผิดเต็ม (30 คำ) แล้วครับ\nเมื่อวันใหม่เริ่ม กล่องคำผิดจะรีเซ็ตเป็น 0\nแล้วค่อยกลับมาทวนใหม่ได้นะครับ 😊");
    return;
  }

  const chunk = getDueChunk();
  if (chunk.length === 0) {
    const due = getDueWords();
    if (due.length === 0) {
      alert("✅ ไม่มีคำให้ทวนวันนี้แล้ว!");
    } else {
      alert("✅ ทวนครบทุกคำแล้ว! กล่องคำผิดยังไม่เต็ม\nลองทวนคำผิดดูได้ครับ");
    }
    return;
  }

  // เริ่ม session flashcard SRS
  srsSessionWords = chunk.map(i => ({ word: i.word, meaning: i.meaning }));
  srsSessionType  = "due";
  currentVocabulary = [...srsSessionWords];
  startDueFlashcard();
}

function startDueFlashcard() {
  shuffledVocabulary = [...currentVocabulary];
  fcIndex = 0;
  fcForgotten = [];
  isSRSMode = true;
  isDueMode = true;
  goTo("flashcardGame");
  showFlashcard();
}

// ==========================================
function alertNoWrongWords() {
  alert("📭 วันนี้ยังไม่มีคำผิดเลยครับ\n\nกรุณาเล่นโหมด ทวนวันนี้ ก่อน\nแล้วคำที่ตอบผิดจะมาเก็บไว้ที่นี่ 😊");
}

// ทวนคำผิด (กล่อง 6) — จับคู่ หรือ เติมคำ
// ==========================================
function openWrongBox() {
  const words = getWrongBoxWords();
  if (words.length === 0) { alert("ยังไม่มีคำผิดวันนี้"); return; }
  srsSessionWords = [...words];
  srsSessionType  = "wrongbox";
  currentVocabulary = words.map(i => ({ word: i.word, meaning: i.meaning }));

  // แสดงเมนูเลือก จับคู่ / เติมคำ
  document.getElementById("wrongBoxGameInfo").innerHTML = `
    <div class="srs-session-label">❌ ทวนคำผิด</div>
    <div class="srs-session-note">${words.length} คำ — เลือกรูปแบบการเล่น</div>`;
  goTo("wrongBoxGameMenu");
}

function startWrongBoxGame(mode) {
  // ไม่มีผล SRS (srsSessionType = "wrongbox")
  srsSessionMode = mode;
  currentVocabulary = srsSessionWords.map(i => ({ word: i.word, meaning: i.meaning }));
  if (mode === "quiz") {
    shuffledVocabulary = shuffleArray([...currentVocabulary]);
    quizIndex = 0; wrongAnswers = []; isSRSMode = false;
    goTo("quizGame"); showQuiz();
  } else if (mode === "typing") {
    shuffledVocabulary = shuffleArray([...currentVocabulary]);
    currentIndex = 0; wrongAnswers = []; isSRSMode = false;
    goTo("typingGame"); showWord();
  }
}

// ==========================================
// ฝึกหัด — สุ่มจากกล่อง 0-5 ไม่มีผล SRS
// ==========================================
function openPractice() {
  const words = getPracticeWords(20);
  if (words.length === 0) { alert("ยังไม่มีคำศัพท์"); return; }
  srsSessionWords = words;
  srsSessionType  = "practice";
  currentVocabulary = words.map(i => ({ word: i.word, meaning: i.meaning }));

  document.getElementById("practiceGameInfo").innerHTML = `
    <div class="srs-session-label">🎮 ฝึกหัด</div>
    <div class="srs-session-note">สุ่ม ${words.length} คำ — ไม่มีผลต่อ SRS</div>`;
  goTo("practiceGameMenu");
}

function startPracticeGame(mode) {
  srsSessionMode = mode;
  currentVocabulary = srsSessionWords.map(i => ({ word: i.word, meaning: i.meaning }));
  if (mode === "quiz") {
    shuffledVocabulary = shuffleArray([...currentVocabulary]);
    quizIndex = 0; wrongAnswers = []; isSRSMode = false;
    goTo("quizGame"); showQuiz();
  } else if (mode === "typing") {
    shuffledVocabulary = shuffleArray([...currentVocabulary]);
    currentIndex = 0; wrongAnswers = []; isSRSMode = false;
    goTo("typingGame"); showWord();
  }
}

// ==========================================
// SRS STATS
// ==========================================
function openSRSStats() {
  const stats  = getSRSStats();
  const counts = getBoxCounts();
  const BOX_LABELS = ["กล่อง 0 (ใหม่)","กล่อง 1 (1วัน)","กล่อง 2 (3วัน)","กล่อง 3 (7วัน)","กล่อง 4 (14วัน)","กล่อง 5 (จำได้ ✅)"];
  const BOX_COLORS = ["#6b7280","#3b82f6","#8b5cf6","#f59e0b","#ef4444","#16a34a"];

  const maxCount = Math.max(...counts, 1);
  let barsHtml = "";
  for (let i = 0; i <= 5; i++) {
    const pct = Math.round((counts[i] / maxCount) * 100);
    barsHtml += `
      <div class="stat-bar-row">
        <div class="stat-bar-label">${BOX_LABELS[i]}</div>
        <div class="stat-bar-wrap">
          <div class="stat-bar-fill" style="width:${pct}%;background:${BOX_COLORS[i]}"></div>
        </div>
        <div class="stat-bar-num">${counts[i]}</div>
      </div>`;
  }

  const pct = stats.total > 0 ? Math.round((stats.learned / stats.total) * 100) : 0;
  const label = currentTopik === "topik1" ? "TOPIK 1" : "TOPIK 2";
  const wb = getWrongBoxWords();

  document.getElementById("srsStatsContent").innerHTML = `
    <div class="stats-header">📊 สถิติ ${label}</div>
    <div class="stats-summary">
      <div class="stat-chip">คำทั้งหมด<br><b>${stats.total}</b></div>
      <div class="stat-chip">เรียนไปแล้ว<br><b>${stats.learned}</b></div>
      <div class="stat-chip">จำได้แล้ว ✅<br><b>${stats.mastered}</b></div>
      <div class="stat-chip">ทวนวันนี้<br><b>${stats.dueToday}</b></div>
      <div class="stat-chip">❌คำผิดวันนี้<br><b>${wb.length}/${WRONG_BOX_MAX}</b></div>
    </div>
    <div class="stat-progress-label">ความคืบหน้า ${pct}%</div>
    <div class="stat-progress-bar">
      <div class="stat-progress-fill" style="width:${pct}%"></div>
    </div>
    <div class="stat-bars">${barsHtml}</div>`;

  document.getElementById("newPerDayInput").value = getNewWordsPerDay();
  document.getElementById("dueChunkInput").value  = getDueChunkSize();
  goTo("srsStats");
}

function saveSettings() {
  const np = parseInt(document.getElementById("newPerDayInput").value);
  const dc = parseInt(document.getElementById("dueChunkInput").value);
  if (!isNaN(np) && np >= 1) setNewWordsPerDay(np);
  if (!isNaN(dc) && dc >= 5) setDueChunkSize(dc);
  alert("✅ บันทึกแล้ว!");
}

// ==========================================
// SRS DUE FINISH — เพิ่มคำผิดใน wrong box แล้ว loop ต่อ
// ==========================================
function showSRSFinish(wrongList) {
  // บันทึก SRS เฉพาะคำที่ผ่าน session ไปแล้ว (ไม่นับคำที่ยังไม่ได้เล่น)
  if (srsSessionType === "due") {
    const playedWords = shuffledVocabulary.slice(0, fcIndex);
    playedWords.forEach(item => {
      const wasWrong = wrongList.some(w => w.word === item.word);
      recordAnswer(item.word, !wasWrong);
      if (wasWrong) addToWrongBox(item);
    });
  }

  goTo("srsFinishScreen");

  const container = document.getElementById("srsWrongAnswers");
  const wb = getWrongBoxWords();
  const wbFull = isWrongBoxFull();

  let statusHtml = "";
  if (srsSessionType === "due") {
    statusHtml = `<div class="wb-status">
      ❌ กล่องคำผิด: <b>${wb.length} / ${WRONG_BOX_MAX}</b>
      ${wbFull ? '<span class="wb-full-tag">เต็ม!</span>' : ''}
    </div>`;
  }

  if (wrongList.length === 0) {
    container.innerHTML = `<div class="wrong-list"><h3>🎉 ยอดเยี่ยม! ตอบถูกทั้งหมด</h3>${statusHtml}</div>`;
  } else {
    let html = `<div class="wrong-list"><h3>❌ คำที่ยังไม่ได้ (${wrongList.length} คำ)</h3>${statusHtml}`;
    wrongList.forEach((item, i) => {
      html += `<div class="wrong-item">${i+1}. <b>${item.word}</b> = ${item.meaning}</div>`;
    });
    html += `</div>`;
    container.innerHTML = html;
  }

  // ปุ่มถัดไป — แสดงตราบที่กล่อง 6 ยังไม่เต็ม และยังมีคำ due อยู่
  const nextBtn = document.getElementById("srsNextChunkBtn");
  const stillHaveDue = getDueWords().length > 0;
  if (srsSessionType === "due" && !wbFull && stillHaveDue) {
    nextBtn.style.display = "";
    nextBtn.textContent = `▶ ทวนชุดถัดไป (${getDueWords().length} คำ)`;
  } else {
    nextBtn.style.display = "none";
  }
}

function continueNextChunk() {
  if (isWrongBoxFull()) { goToSRSDashboard(); return; }
  const chunk = getDueChunk();
  if (chunk.length === 0) { goToSRSDashboard(); return; }
  srsSessionWords = chunk.map(i => ({ word: i.word, meaning: i.meaning }));
  currentVocabulary = [...srsSessionWords];
  startDueFlashcard();
}

function replaySRSSession() {
  if (srsSessionType === "due") {
    startDueFlashcard();
  } else if (srsSessionType === "wrongbox") {
    startWrongBoxGame(srsSessionMode);
  } else {
    startPracticeGame(srsSessionMode);
  }
}

// ==========================================
// SETTINGS
// ==========================================
function openSettings() {
  document.getElementById("dueChunkInput").value  = getDueChunkSize();
  document.getElementById("newPerDayInput").value = getNewWordsPerDay();
  // uncheck all
  document.querySelectorAll("#clearBoxChecks input").forEach(cb => cb.checked = false);
  goTo("settingsPanel");
}

function clearSelectedBoxes() {
  const checked = [...document.querySelectorAll("#clearBoxChecks input[value]:checked")].map(cb => parseInt(cb.value));
  const clearWB = document.getElementById("clearWrongBoxCheck")?.checked;
  if (checked.length === 0 && !clearWB) { alert("ยังไม่ได้เลือกกล่องเลยครับ"); return; }

  let count = 0;
  if (checked.length > 0) {
    const data = loadSRS();
    Object.keys(data).forEach(word => {
      if (checked.includes(data[word].box)) {
        data[word].box = 0;
        data[word].nextReview = null;
        count++;
      }
    });
    saveSRS(data);
  }

  let msg = "";
  if (count > 0) msg += `✅ รีเซ็ต ${count} คำ กลับกล่อง 0 แล้ว`;
  if (clearWB) {
    clearWrongBox();
    msg += (msg ? "\n" : "") + "✅ รีเซ็ตกล่องคำผิดเป็น 0 แล้ว";
  }
  alert(msg);
  document.querySelectorAll("#clearBoxChecks input").forEach(cb => cb.checked = false);
}

function clearWrongBoxManual() {
  clearWrongBox();
  alert("✅ รีเซ็ตกล่องคำผิดเป็น 0 แล้วครับ! กลับมาเล่นทวนวันนี้ได้แล้ว");
}

function resetEverything() {
  const confirmed = confirm(
    "⚠️ คุณต้องการคืนค่าทั้งหมดหรือไม่?\n\n" +
    "• รีเซ็ตทุกคำกลับกล่อง 0\n" +
    "• ล้างกล่องคำผิด\n" +
    "• อัปเดตคำศัพท์ใหม่\n" +
    "• เคลียร์แคชเบราว์เซอร์\n\n" +
    "⛔ การกระทำนี้ไม่สามารถย้อนกลับได้!"
  );
  if (!confirmed) return;

  // รีเซ็ตทุกกล่อง SRS
  const data = loadSRS();
  Object.keys(data).forEach(word => {
    data[word].box = 0;
    data[word].nextReview = null;
  });
  saveSRS(data);

  // ล้างกล่องคำผิด
  clearWrongBox();

  // รีเซ็ต counter คำใหม่วันนี้
  const s = JSON.parse(localStorage.getItem(SRS_SETTINGS) || "{}");
  const countKey = `todayNewWords_${currentTopik}`;
  s[countKey] = 0;
  localStorage.setItem(SRS_SETTINGS, JSON.stringify(s));

  // อัปเดตคำศัพท์ + เคลียร์แคช
  initAllVocab();
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
    alert("✅ คืนค่าทั้งหมดเสร็จแล้ว! กำลัง reload...");
    location.reload();
  });
}

function syncVocabAndClearCache() {
  if (!confirm("จะอัปเดตคำศัพท์ใหม่จากไฟล์ .js และเคลียร์แคชเบราว์เซอร์\nคำเดิมและข้อมูล SRS ไม่หาย — ตกลงไหมครับ?")) return;
  // เพิ่มคำใหม่เข้า localStorage (คำเดิมไม่โดนแตะ)
  initAllVocab();
  // เคลียร์ Service Worker cache แล้ว reload
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
    alert("✅ อัปเดตเสร็จแล้ว! กำลัง reload...");
    location.reload();
  });
}

// =========================
// SEARCH VOCABULARY
// =========================

function searchVocabulary() {

  const keyword = document
    .getElementById("searchInput")
    .value
    .trim()
    .toLowerCase();

  const resultBox = document.getElementById("searchResult");

  // ยังไม่พิมพ์
  if (!keyword) {
    resultBox.classList.add("hidden");
    resultBox.innerHTML = "";
    return;
  }

  const vocab1 = window.flashVocabData1 || [];
  const vocab2 = window.flashVocabData2 || [];

  let found = [];

  // TOPIK1
  vocab1.forEach(item => {

    const word = item.word.toLowerCase();
    const meaning = item.meaning.toLowerCase();

    if (
      word.includes(keyword) ||
      meaning.includes(keyword)
    ) {
      found.push({
        word: item.word,
        meaning: item.meaning,
        level: "TOPIK1",
        className: "level-topik1"
      });
    }

  });

  // TOPIK2
  vocab2.forEach(item => {

    const word = item.word.toLowerCase();
    const meaning = item.meaning.toLowerCase();

    if (
      word.includes(keyword) ||
      meaning.includes(keyword)
    ) {
      found.push({
        word: item.word,
        meaning: item.meaning,
        level: "TOPIK2",
        className: "level-topik2"
      });
    }

  });

  // ไม่พบ
  if (found.length === 0) {

    resultBox.innerHTML = `
      <div class="search-notfound">
        ❌ ไม่พบคำศัพท์
      </div>
    `;

    resultBox.classList.remove("hidden");
    return;
  }

  // จำกัดไม่เกิน 10 คำ
  found = found.slice(0, 10);

  let html = "";

  found.forEach(item => {

    html += `
      <div class="search-item">

        <div class="search-word">
          ${item.word}
        </div>

        <div class="search-meaning">
          ${item.meaning}
        </div>

        <div class="search-level ${item.className}">
          ${item.level}
        </div>

      </div>
    `;

  });

  resultBox.innerHTML = html;
  resultBox.classList.remove("hidden");
}

// =========================
// CLEAR SEARCH
// =========================

function clearSearchInput(){

  document.getElementById("searchInput").value = "";

  const resultBox = document.getElementById("searchResult");

  resultBox.innerHTML = "";
  resultBox.classList.add("hidden");

  document.getElementById("searchInput").focus();
}