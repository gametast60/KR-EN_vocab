// ============================================================
// VARIABLES
// ============================================================
let screenHistory  = [];
let currentTopik   = "";   // "topik1" | "topik2"
let currentVocabulary = [];

let srsSessionWords = [];
let srsSessionMode  = "";
let srsSessionType  = "";   // "due" | "practice" | "wrongbox"

const backButton = document.getElementById("backButton");
const homeButton = document.getElementById("homeButton");
const trackNavButton = document.getElementById("trackNavButton");

function getCurrentScreenId(){
  return document.querySelector(".screen:not(.hidden)")?.id || "mainMenu";
}

function getTrackMenuScreenId(){
  if(currentTopik && currentTopik.startsWith("english_")) return "englishMenu";
  if(currentTopik && currentTopik.startsWith("topik")) return "koreanMenu";
  const cur = getCurrentScreenId();
  if(cur === "englishMenu") return "englishMenu";
  return "koreanMenu";
}

function updateTrackNavButton(forceHidden = false){
  if(!trackNavButton) return;
  const currentScreen = getCurrentScreenId();
  const targetScreen = getTrackMenuScreenId();
  trackNavButton.classList.toggle("hidden", forceHidden || currentScreen === targetScreen);
  trackNavButton.textContent = targetScreen === "englishMenu" ? "หน้า Level" : "หน้า TOPIK";
}

function openTrackMenu(){
  goTo(getTrackMenuScreenId());
}

// ============================================================
// SCREEN NAVIGATION
// ============================================================
function showScreen(screenId){
  document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
  const t = document.getElementById(screenId);
  if(t) t.classList.remove("hidden");
}


function goTo(screenId){
  const cur = document.querySelector(".screen:not(.hidden)");
  if(cur) screenHistory.push(cur.id);
  showScreen(screenId);
  // ซ่อน badge ทุกตัวก่อนเสมอ แล้วค่อยให้เกม set ใหม่
  ["flashcardProgress","progress","quizProgress"].forEach(id => {
    document.getElementById(id).classList.add("hidden");
  });
  updateTitleVisibility();
  updateNavButtons();
}

function goBack(){
  if(screenHistory.length === 0) return;
  const prevScreen = screenHistory.pop();
  showScreen(prevScreen);
  document.getElementById("appTitle").classList.remove("hidden"); // ← เพิ่มตรงนี้
  ["flashcardProgress","progress","quizProgress"].forEach(id => {
    document.getElementById(id).classList.add("hidden");
  });
  if(prevScreen === "mainMenu"){
    document.getElementById("appTitle").textContent = "Vocab by 톤님";
  } else if(prevScreen === "koreanMenu"){
    document.getElementById("appTitle").textContent = "KR ภาษาเกาหลี";
  } else if(prevScreen === "englishMenu"){
    document.getElementById("appTitle").textContent = "EN ภาษาอังกฤษ";
  } else if(prevScreen === "srsDashboard"){
    const TITLES = {
      topik1:"TOPIK 1", topik2:"TOPIK 2",
      english_a1:"English A1", english_a2:"English A2",
      english_b1:"English B1", english_b2:"English B2",
    };
    document.getElementById("appTitle").textContent = TITLES[currentTopik] || currentTopik;
    renderSRSHome();
  }
  updateNavButtons();
}

function updateNavButtons(){

  const currentScreen = getCurrentScreenId();

  const hideBack = [
  "mainMenu",
  "koreanMenu",
  "englishMenu",
  "srsDashboard"
].includes(currentScreen);

  const inFlashcard =
       !document.getElementById("flashcardGame").classList.contains("hidden");

  const inTyping =
       !document.getElementById("typingGame").classList.contains("hidden");

  const inQuiz =
       !document.getElementById("quizGame").classList.contains("hidden");

  const hideAllNav = inFlashcard || inTyping || inQuiz;

  backButton.classList.toggle("hidden", hideBack || hideAllNav);
  homeButton.classList.toggle("hidden", currentScreen === "mainMenu" || hideAllNav);

  updateTrackNavButton(hideAllNav);
}

// ============================================================
// MAIN MENU
// ============================================================
function showMainMenu(){
  screenHistory = [];
  currentTopik  = "";
  document.getElementById("appTitle").textContent = "Vocab by 톤님";
  document.getElementById("appTitle").classList.remove("hidden");
  ["flashcardProgress","progress","quizProgress"].forEach(id => {
    document.getElementById(id).classList.add("hidden");
  });
  showScreen("mainMenu");
  updateNavButtons();
}

function openLanguage(lang){
  if(lang === "korean"){
    document.getElementById("appTitle").textContent = "KR ภาษาเกาหลี";
    goTo("koreanMenu");
  } else {
    document.getElementById("appTitle").textContent = "EN ภาษาอังกฤษ";
    goTo("englishMenu");
  }
}

function openTopik(topik){
  currentTopik = topik;
  const TITLES = {
    topik1:     "TOPIK 1",
    topik2:     "TOPIK 2",
    english_a1: "English A1",
    english_a2: "English A2",
    english_b1: "English B1",
    english_b2: "English B2",
  };
  document.getElementById("appTitle").textContent = TITLES[topik] || topik;
  goTo("srsDashboard");
  renderSRSHome();
}

function goToSRSDashboard(){
  practicePool = [];
  practiceSourceWords = [];
  wrongboxPool = [];
  lastPlayedWords = [];
  screenHistory = screenHistory.filter(id => id !== "srsDashboard");
  goTo("srsDashboard");
  renderSRSHome();
}

function backToDashboard(){
  goToSRSDashboard();
}

function getTopikVocab(topik){
  if(topik === "topik1")     return window.flashVocabData1      || [];
  if(topik === "topik2")     return window.flashVocabData2      || [];
  if(topik === "english_a1") return window.flashVocabDataEnA1   || [];
  if(topik === "english_a2") return window.flashVocabDataEnA2   || [];
  if(topik === "english_b1") return window.flashVocabDataEnB1   || [];
  if(topik === "english_b2") return window.flashVocabDataEnB2   || [];
  return [];
}

// ============================================================
// SRS DASHBOARD
// ============================================================
function renderSRSHome(){
  checkDailyReset();
  initAllVocab();

  const counts   = getBoxCounts();
  const due      = getDueWords();
  const wrongBox = getWrongBoxWords();

  const BOX_LABELS = ["ใหม่","1วัน","3วัน","7วัน","14วัน","จำได้✅"];
  const BOX_COLORS = ["#6b7280","#3b82f6","#8b5cf6","#f59e0b","#ef4444","#16a34a"];

  const boxRow = document.getElementById("srsBoxRow");
  if(!boxRow) return;

  let boxHtml = "";
  for(let i = 0; i <= 5; i++){
    boxHtml += `
      <div class="srs-box srs-box-clickable" style="--box-color:${BOX_COLORS[i]}" onclick="openBoxInspector(${i})">
        <div class="srs-box-count">${counts[i]}</div>
        <div class="srs-box-label">${BOX_LABELS[i]}</div>
      </div>`;
  }
  const wbFull = wrongBox.length >= WRONG_BOX_MAX;
  boxHtml += `
    <div class="srs-box srs-box-wrongbox srs-box-clickable" style="--box-color:#db2777" onclick="openWrongBoxInspector()">
      <div class="srs-box-count">${wrongBox.length}</div>
      <div class="srs-box-label">❌คำผิด</div>
      ${wbFull ? '<div class="srs-box-full">เต็ม</div>' : ''}
    </div>`;
  boxRow.innerHTML = boxHtml;

  const actions = document.getElementById("srsActions");
  actions.innerHTML = `
    <button class="srs-action-btn srs-due-btn" onclick="openSRSDue()">
  📅 ทวนวันนี้
</button>
<button class="srs-action-btn srs-wrongbox-btn" onclick="${wrongBox.length === 0 ? 'alertNoWrongWords()' : 'openWrongBox()'}">
  ❌ ทวนคำผิด <span class="srs-badge">${wrongBox.length} / ${WRONG_BOX_MAX}</span>
</button>
<button class="srs-action-btn srs-new-btn" onclick="openPractice()">
  🎮 ฝึกหัด
</button>
    <button class="srs-action-btn srs-stat-btn" onclick="openSRSStats()">📊 สถิติ</button>
    <button class="srs-action-btn srs-settings-btn" onclick="openSettings()">⚙️ ตั้งค่า</button>`;
}

// ============================================================
// ทวนวันนี้ (SRS Flashcard)
// ============================================================
function openSRSDue(){
  checkDailyReset();
  initAllVocab();
  if(isWrongBoxFull()){
    alert("🛑 วันนี้พอแล้ว!\n\nกล่องคำผิดเต็ม (30 คำ) แล้วครับ\nเมื่อวันใหม่เริ่ม กล่องคำผิดจะรีเซ็ตเป็น 0\nแล้วค่อยกลับมาทวนใหม่ได้นะครับ 😊");
    return;
  }
  const chunk = getDueChunk();
  if(chunk.length === 0){
    alert(getDueWords().length === 0
      ? "✅ ไม่มีคำให้ทวนวันนี้แล้ว!"
      : "✅ ทวนครบทุกคำแล้ว! กล่องคำผิดยังไม่เต็ม\nลองทวนคำผิดดูได้ครับ");
    return;
  }
  srsSessionWords   = chunk.map(i => ({ word: i.word, meaning: i.meaning }));
  srsSessionType    = "due";
  currentVocabulary = [...srsSessionWords];
  startDueFlashcard();
}

function startDueFlashcard(){
  shuffledVocabulary = [...currentVocabulary];
  fcIndex       = 0;
  fcForgotten   = [];
  pendingList   = [];
  fillWrongList = [];
  fillIndex     = 0;
  dueStage      = 1;
  isDueMode     = true;
  // ซ่อน fillCardUI เผื่อค้างจากรอบก่อน
  const fillUI = document.getElementById("fillCardUI");
  if(fillUI) fillUI.classList.add("hidden");
  goTo("flashcardGame");
  showFlashcard();
}

// ============================================================
// ทวนคำผิด (Wrong Box)
// ============================================================
function alertNoWrongWords(){
  alert("📭 วันนี้ยังไม่มีคำผิดเลยครับ\n\nกรุณาเล่นโหมด ทวนวันนี้ ก่อน\nแล้วคำที่ตอบผิดจะมาเก็บไว้ที่นี่ 😊");
}

function openWrongBox(){
  const words = getWrongBoxWords();
  if(words.length === 0){ alert("ยังไม่มีคำผิดวันนี้"); return; }
  const wChunk = getWrongChunkSize();
srsSessionWords   = shuffleArray([...words]).slice(0, wChunk);
  srsSessionType    = "wrongbox";
  currentVocabulary = srsSessionWords.map(i => ({ word: i.word, meaning: i.meaning }));
  document.getElementById("wrongBoxGameInfo").innerHTML = `
    <div class="srs-session-label">❌ ทวนคำผิด</div>
    <div class="srs-session-note">${wChunk} คำ — เลือกรูปแบบการเล่น</div>`;
  goTo("wrongBoxGameMenu");
}

function startWrongBoxGame(mode){
  srsSessionMode    = mode;
  currentVocabulary = srsSessionWords.map(i => ({ word: i.word, meaning: i.meaning }));
  if(mode === "quiz"){
    shuffledVocabulary = shuffleArray([...currentVocabulary]);
    quizIndex = 0; wrongAnswers = [];
    goTo("quizGame"); showQuiz();
  } else {
    shuffledVocabulary = shuffleArray([...currentVocabulary]);
    currentIndex = 0; wrongAnswers = [];
    goTo("typingGame"); showWord();
  }
}

// ============================================================
// ฝึกหัด (Practice)
// ============================================================
function openPractice(){
  srsSessionWords = [];
  srsSessionType  = "";
  renderPracticeBoxFilterLabel();
  document.getElementById("practiceGameInfo").innerHTML = `
    <div class="srs-session-label">🎮 ฝึกหัด</div>
    <div class="srs-session-note">1. เลือกกล่องคำที่เล่น &nbsp;2. เลือกโหมดเกม</div>`;
  goTo("practiceGameMenu");
}

function startPracticeGame(mode){

  // สร้างชุดคำใหม่เฉพาะตอนเริ่มฝึกหัดครั้งแรก
  if(srsSessionType !== "practice" || srsSessionWords.length === 0){

    const words = getPracticeWordsByBoxes(
      getPracticeSelectedBoxes(),
      getPracticeChunkSize()
    );

    if(words.length === 0){
      srsSessionWords = [];
      currentVocabulary = [];
      shuffledVocabulary = [];

      alert("ไม่พบคำศัพท์ในกล่องที่เลือก\nกรุณากด 📦 เลือกกล่องเล่น ก่อนนะครับ");
      return;
    }

    srsSessionWords = words;
    srsSessionType = "practice";
  }

  // ใช้ชุดเดิมเสมอเมื่อสลับโหมด
  srsSessionMode = mode;

  currentVocabulary = srsSessionWords.map(i => ({
    word: i.word,
    meaning: i.meaning
  }));

  // สับลำดับใหม่ทุกครั้ง
  shuffledVocabulary = shuffleArray([...currentVocabulary]);

  if(mode === "quiz"){

    quizIndex = 0;
    wrongAnswers = [];

    goTo("quizGame");
    showQuiz();

  } else {

    currentIndex = 0;
    wrongAnswers = [];

    goTo("typingGame");
    showWord();
  }
}

// ============================================================
// PRACTICE BOX SELECTOR
// ============================================================

// key แยกตาม topik
function practiceBoxesKey(){
  return `topik_practice_boxes_${currentTopik || "topik1"}`;
}

// โหลดค่าที่บันทึกไว้ — default = เลือกทุกกล่อง [0,1,2,3,4,5,6]
function getPracticeSelectedBoxes(){
  try {
    const raw = localStorage.getItem(practiceBoxesKey());
    if(raw) return JSON.parse(raw);
  } catch(e) {}
  return [0,1,2,3,4,5];
}

function savePracticeSelectedBoxes(arr){
  localStorage.setItem(practiceBoxesKey(), JSON.stringify(arr));
}

// ดึงคำจากกล่องที่เลือก (ไม่กระทบ SRS)
function getPracticeWordsByBoxes(selectedBoxes, limit){
  if(!selectedBoxes || selectedBoxes.length === 0) return [];
  const data = loadSRS();
  let pool = [];
  Object.values(data).forEach(item => {
    if(selectedBoxes.includes(item.box) && item.word && item.meaning){ // ← เพิ่ม check
      pool.push({ word: item.word, meaning: item.meaning });
    }
  });
  pool = shuffleArray(pool);
  return pool.slice(0, Math.min(limit, pool.length));
}

// นับจำนวนคำในแต่ละกล่อง (สำหรับแสดงใน popup)
function getPracticeBoxCounts(){
  return getBoxCounts(); // [0,1,2,3,4,5] จาก srs.js
}

// เปิด popup
function openPracticeBoxModal(){
  const counts   = getPracticeBoxCounts();
  const selected = getPracticeSelectedBoxes();

  const BOX_LABELS = [
    "กล่อง 0 — คำใหม่",
    "กล่อง 1 — 1 วัน",
    "กล่อง 2 — 3 วัน",
    "กล่อง 3 — 7 วัน",
    "กล่อง 4 — 14 วัน",
    "กล่อง 5 — จำได้ ✅"
  ];
  const BOX_COLORS = ["#6b7280","#3b82f6","#8b5cf6","#d97706","#ef4444","#16a34a","#db2777"];

  let html = "";
  for(let i = 0; i <= 5; i++){
    const checked = selected.includes(i) ? "checked" : "";
    html += `
      <label style="display:flex;align-items:center;gap:10px;font-size:15px;padding:9px 0;border-bottom:1px solid #f3f4f6;cursor:pointer;">
        <input type="checkbox" class="practice-box-cb" value="${i}" ${checked}
          style="width:18px;height:18px;accent-color:${BOX_COLORS[i]};flex-shrink:0;"
          onchange="updatePracticeBoxSummary()">
        <span style="color:${BOX_COLORS[i]};font-weight:700;">${BOX_LABELS[i]}</span>
        <span style="margin-left:auto;background:${BOX_COLORS[i]};color:white;font-size:12px;font-weight:700;padding:2px 9px;border-radius:999px;">${counts[i]}</span>
      </label>`;
  }

  document.getElementById("practiceBoxChecklist").innerHTML = html;
  updatePracticeBoxSummary();

  // อัปเดต "เลือกทั้งหมด"
  document.getElementById("practiceSelectAll").checked = selected.filter(b => b <= 5).length === 6;

  document.getElementById("practiceBoxModal").classList.remove("hidden");
}

function closePracticeBoxModal(e){
  if(e && e.target !== document.getElementById("practiceBoxModal")) return;
  document.getElementById("practiceBoxModal").classList.add("hidden");
}

// อัปเดต summary "เลือก X กล่อง รวม Y คำ"
function updatePracticeBoxSummary(){
  const cbs = [...document.querySelectorAll(".practice-box-cb")];
  const counts = getPracticeBoxCounts();

  const checkedBoxes = cbs.filter(cb => cb.checked).map(cb => parseInt(cb.value));
  const totalWords = checkedBoxes.reduce((sum, b) => sum + (counts[b] || 0), 0);

  document.getElementById("practiceBoxSummary").textContent =
    checkedBoxes.length === 0
      ? "ยังไม่ได้เลือกกล่อง"
      : `เลือก ${checkedBoxes.length} กล่อง — รวม ${totalWords} คำ`;

  // sync "เลือกทั้งหมด"
  document.getElementById("practiceSelectAll").checked = checkedBoxes.length === 6;
}

function togglePracticeSelectAll(checked){
  document.querySelectorAll(".practice-box-cb").forEach(cb => cb.checked = checked);
  updatePracticeBoxSummary();
}

function clearPracticeBoxSelection(){
  document.querySelectorAll(".practice-box-cb").forEach(cb => cb.checked = false);
  document.getElementById("practiceSelectAll").checked = false;
  updatePracticeBoxSummary();
}

function confirmPracticeBoxSelection(){
  const selected = [...document.querySelectorAll(".practice-box-cb:checked")].map(cb => parseInt(cb.value));
  if(selected.length === 0){
    alert("กรุณาเลือกอย่างน้อย 1 กล่อง");
    return;
  }
  savePracticeSelectedBoxes(selected);
  document.getElementById("practiceBoxModal").classList.add("hidden");
  renderPracticeBoxFilterLabel();
  alert(`✅ บันทึกแล้ว! เลือก ${selected.length} กล่อง`);
}

// แสดง label กล่องที่เลือกใต้ปุ่มเกม
function renderPracticeBoxFilterLabel(){
  const el = document.getElementById("practiceBoxFilterLabel");
  if(!el) return;
  const selected = getPracticeSelectedBoxes();
  const counts   = getPracticeBoxCounts();
  const total = selected.reduce((s, b) => s + (counts[b] || 0), 0);

  if(total === 0){
    el.textContent = "⚠️ กล่องที่เลือกไม่มีคำศัพท์";
  } else {
    el.textContent = selected.filter(b => b <= 5).length === 6
      ? `📦 ทุกกล่อง — ${total} คำ`
      : `📦 กล่อง ${selected.join(", ")} — ${total} คำ`;
  }
  el.style.display = "block";

  document.querySelectorAll("#practiceGameMenu .menu-btn").forEach(btn => {
  if(btn.id === "practiceBoxSelectBtn") return;
  btn.disabled = total === 0;
 });
}

// ============================================================
// SRS FINISH SCREEN (ทวนวันนี้)
// ============================================================
function showSRSFinish(wrongList){
  // wrongList = fcForgotten ซึ่งรวมคำผิดทั้ง 2 ด่านไว้แล้ว
  // (ด่าน 1: จำไม่ได้ / ด่าน 2: เติมผิด — ทั้งคู่ push เข้า fcForgotten)

  goTo("srsFinishScreen");

  const container = document.getElementById("srsWrongAnswers");
  const wb        = getWrongBoxWords();
  const wbFull    = isWrongBoxFull();

  let statusHtml = "";
  if(srsSessionType === "due"){
    // แสดงสรุปสถิติ
    const totalPlayed    = shuffledVocabulary.length;
    const stage1Wrong    = fcForgotten.filter(w => !fillWrongList.some(f => f.word === w.word)).length;
    // คำผิดด่าน 1 = fcForgotten ที่ไม่ได้ไปถึงด่าน 2
    // คำผิดด่าน 2 = fillWrongList
    const stage1WrongCount = fcForgotten.length - fillWrongList.length;
    const stage2WrongCount = fillWrongList.length;
    const promotedCount    = fillCorrectCount;

    statusHtml = `
      <div class="summary-stats">
        <div class="summary-row">❌ ผิดด่าน 1 (จำไม่ได้): <b>${stage1WrongCount} คำ</b></div>
        <div class="summary-row">❌ ผิดด่าน 2 (เติมผิด): <b>${stage2WrongCount} คำ</b></div>
      </div>
      <div class="wb-status">
        กล่องคำผิด: <b>${wb.length} / ${WRONG_BOX_MAX}</b>
        ${wbFull ? '<span class="wb-full-tag">เต็ม!</span>' : ''}
      </div>`;
  }

  if(wrongList.length === 0){
    container.innerHTML = `<div class="wrong-list"><h3>🎉 ยอดเยี่ยม! ผ่านทั้ง 2 ด่าน</h3>${statusHtml}</div>`;
  } else {
    let html = `<div class="wrong-list"><h3>❌ คำที่ยังจำไม่ได้ (${wrongList.length} คำ)</h3>${statusHtml}`;
    wrongList.forEach((item, i) => {
      // ระบุว่าผิดจากด่านไหน
      const isStage2Wrong = fillWrongList.some(f => f.word === item.word);
      const tag = isStage2Wrong
        ? `<span class="wrong-stage-tag stage2">ด่าน 2</span>`
        : `<span class="wrong-stage-tag stage1">ด่าน 1</span>`;
      html += `<div class="wrong-item">${i+1}. <b>${item.word}</b> = ${item.meaning} ${tag}</div>`;
    });
    container.innerHTML = html + `</div>`;
  }

  const nextBtn      = document.getElementById("srsNextChunkBtn");
  const stillHaveDue = getDueChunk().length > 0;
  if(srsSessionType === "due" && !wbFull && stillHaveDue){
    nextBtn.style.display = "";
    nextBtn.textContent = `▶ ทวนชุดถัดไป`;
  } else {
    nextBtn.style.display = "none";
  }
}

function continueNextChunk(){
  if(isWrongBoxFull()){ goToSRSDashboard(); return; }
  const chunk = getDueChunk();
  if(chunk.length === 0){ goToSRSDashboard(); return; }
  srsSessionWords   = chunk.map(i => ({ word: i.word, meaning: i.meaning }));
  currentVocabulary = [...srsSessionWords];
  startDueFlashcard();
}

// ============================================================
// STATS
// ============================================================
function openSRSStats(){
  const stats  = getSRSStats();
  const counts = getBoxCounts();
  const BOX_LABELS = ["กล่อง 0 (ใหม่)","กล่อง 1 (1วัน)","กล่อง 2 (3วัน)","กล่อง 3 (7วัน)","กล่อง 4 (14วัน)","กล่อง 5 (จำได้ ✅)"];
  const BOX_COLORS = ["#6b7280","#3b82f6","#8b5cf6","#f59e0b","#ef4444","#16a34a"];

  const maxCount = Math.max(...counts, 1);
  let barsHtml = "";
  for(let i = 0; i <= 5; i++){
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

  const pct   = stats.total > 0 ? Math.round((stats.learned / stats.total) * 100) : 0;
  const label = currentTopik === "topik1" ? "TOPIK 1" : "TOPIK 2";
  const wb    = getWrongBoxWords();

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

  document.getElementById("dueChunkInput").value  = getDueChunkSize();
  goTo("srsStats");
}

// ============================================================
// SETTINGS
// ============================================================
function openSettings(){
  document.getElementById("dueChunkInput").value  = getDueChunkSize();
  document.getElementById("wrongChunkInput").value  = getWrongChunkSize();
  document.getElementById("practiceChunkInput").value = getPracticeChunkSize();
  document.querySelectorAll("#clearBoxChecks input").forEach(cb => cb.checked = false);
  goTo("settingsPanel");
}

function saveSettings(){
  const dc = parseInt(document.getElementById("dueChunkInput").value);
  const wc = parseInt(document.getElementById("wrongChunkInput").value);
  const pc = parseInt(document.getElementById("practiceChunkInput").value);
  if(!isNaN(dc) && dc >= 5) setDueChunkSize(dc);
  if(!isNaN(wc) && wc >= 5) setWrongChunkSize(wc);
  if(!isNaN(pc) && pc >= 5) setPracticeChunkSize(pc);
  alert("✅ บันทึกแล้ว!");
}

function clearSelectedBoxes(){
  const checked = [...document.querySelectorAll("#clearBoxChecks input[value]:checked")].map(cb => parseInt(cb.value));
  const clearWB = document.getElementById("clearWrongBoxCheck")?.checked;
  if(checked.length === 0 && !clearWB){ alert("ยังไม่ได้เลือกกล่องเลยครับ"); return; }

  if(!confirm("⚠️ ยืนยันรีเซ็ตกล่องที่เลือก?\n\nคำในกล่องเหล่านี้จะถูกส่งกลับกล่อง 0 ทั้งหมด")) return;

  let count = 0;
  if(checked.length > 0){
    const data = loadSRS();
    Object.keys(data).forEach(word => {
      if(checked.includes(data[word].box)){ data[word].box = 0; data[word].nextReview = null; count++; }
    });
    saveSRS(data);
  }
  let msg = count > 0 ? `✅ รีเซ็ต ${count} คำ กลับกล่อง 0 แล้ว` : "";
  if(clearWB){ clearWrongBox(); msg += (msg ? "\n" : "") + "✅ รีเซ็ตกล่องคำผิดเป็น 0 แล้ว"; }
  alert(msg);
  document.querySelectorAll("#clearBoxChecks input").forEach(cb => cb.checked = false);
}

function clearWrongBoxManual(){
  clearWrongBox();
  alert("✅ รีเซ็ตกล่องคำผิดเป็น 0 แล้วครับ! กลับมาเล่นทวนวันนี้ได้แล้ว");
}

function resetEverything(){
  if(!confirm(
    "⚠️ คุณต้องการคืนค่าทั้งหมดหรือไม่?\n\n" +
    "• รีเซ็ตทุกคำกลับกล่อง 0\n• ล้างกล่องคำผิด\n• อัปเดตคำศัพท์ใหม่\n• เคลียร์แคชเบราว์เซอร์\n\n" +
    "⛔ การกระทำนี้ไม่สามารถย้อนกลับได้!"
  )) return;

  const data = loadSRS();
  Object.keys(data).forEach(word => { data[word].box = 0; data[word].nextReview = null; });
  saveSRS(data);
  clearWrongBox();

const s = JSON.parse(localStorage.getItem(srsSettingsKey()) || "{}");
s[`todayNewWords_${currentTopik}`] = 0;
localStorage.setItem(srsSettingsKey(), JSON.stringify(s));              

  initAllVocab();
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
    alert("✅ คืนค่าทั้งหมดเสร็จแล้ว! กำลัง reload...");
    location.reload();
  });
}

function syncVocabAndClearCache(){
  if(!confirm("ยืนยันการอัพเดทเวอร์ชั่นใหม่?\n'ตกลง' หรือไม่?")) return;
  initAllVocab();
  caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => {
    alert("✅ อัปเดตเสร็จแล้ว! กำลัง reload...");
    location.reload();
  });
}

// ============================================================
// BACKUP / RESTORE
// ============================================================

const BACKUP_FORMAT_VERSION = 2;

const BACKUP_TOPIKS = [
  { id: "topik1", label: "TOPIK 1" },
  { id: "topik2", label: "TOPIK 2" },
  { id: "english_a1", label: "English A1" },
  { id: "english_a2", label: "English A2" },
  { id: "english_b1", label: "English B1" },
  { id: "english_b2", label: "English B2" },
];

// key ทั้งหมดที่ต้อง backup (ไม่รวม date keys)
function getBackupKeys() {
  const keys = [];
  BACKUP_TOPIKS.forEach(({ id }) => {
    keys.push(
      `topik_srs_${id}_v1`,
      `topik_srs_settings_${id}`,
      `topik_practice_boxes_${id}`,
    );
  });
  return keys;
}

function getBackupTopikLabel(topikId) {
  const item = BACKUP_TOPIKS.find(topik => topik.id === topikId);
  return item ? item.label : topikId;
}

function getBackupSrsKeys() {
  return BACKUP_TOPIKS.map(({ id }) => `topik_srs_${id}_v1`);
}

function getBackupSummary(payload) {
  return BACKUP_TOPIKS.map(({ id, label }) => {
    const srsKey = `topik_srs_${id}_v1`;
    const data = safeParseJSON(payload.localStorage[srsKey], {});
    const counts = calcBoxCounts(data);
    const overdue = Object.values(data).filter(item => item.box >= 1 && item.box <= 4 && item.nextReview && item.nextReview <= todayStr()).length;
    return { id, label, counts, overdue };
  });
}

// ---- BACKUP ----
function backupData() {
  const snapshot = {};
  getBackupKeys().forEach(key => {
    const val = localStorage.getItem(key);
    if (val !== null) snapshot[key] = val; // เก็บเป็น raw string
  });

  const payload = {
   backupFormat: BACKUP_FORMAT_VERSION,
   createdAt: new Date().toISOString(),
   backupDate: todayStr(),
   localStorage: snapshot,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  const dateStr = new Date().toISOString().slice(0, 10); // "2026-06-15"
  a.href     = url;
  a.download = `topik_backup_${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- RESTORE: Step 1 — รับไฟล์ ----
let _pendingRestorePayload = null; // เก็บ payload รอยืนยัน
let _pendingRestoreMode    = "reset"; // "reset" | "keep"

function handleRestoreFile(event) {
  const file = event.target.files[0];
  event.target.value = ""; // reset input เพื่อเลือกไฟล์เดิมซ้ำได้
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    let payload;
    try {
      payload = JSON.parse(e.target.result);
    } catch(err) {
      alert("❌ ไฟล์เสียหายหรือไม่ใช่ไฟล์ JSON ที่ถูกต้องครับ");
      return;
    }

    // ตรวจ format
    if (!payload.backupFormat) {
      alert("❌ ไม่ใช่ไฟล์ Backup ของแอปนี้ครับ");
      return;
    }
    if (payload.backupFormat > BACKUP_FORMAT_VERSION) {
      alert(`❌ ไฟล์นี้สร้างจากแอปเวอร์ชันใหม่กว่า (format ${payload.backupFormat})\nกรุณาอัปเดตแอปก่อนครับ`);
      return;
    }
    if (!payload.localStorage || typeof payload.localStorage !== "object") {
      alert("❌ ข้อมูลในไฟล์ไม่สมบูรณ์ครับ");
      return;
    }

    _pendingRestorePayload = payload;
    _pendingRestoreMode    = "reset"; // default = เริ่มนับใหม่ (แนะนำ)
    showRestorePreview(payload);
  };
  reader.readAsText(file);
}

// ---- RESTORE: Step 2 — แสดง Preview ----
function showRestorePreview(payload) {
  const createdAt = payload.createdAt
    ? new Date(payload.createdAt).toLocaleString("th-TH", { dateStyle:"medium", timeStyle:"short" })
    : "ไม่ทราบ";

  const summary = getBackupSummary(payload);
  const totalOverdue = summary.reduce((sum, item) => sum + item.overdue, 0);

  // คำนวณ nextReview ถ้าเลือก reset
  const today = todayStr();
  const resetDates = calcResetDates(today);

  const BOX_LABELS = ["ใหม่","1วัน","3วัน","7วัน","14วัน","จำได้✅"];
  const BOX_COLORS = ["#6b7280","#3b82f6","#8b5cf6","#d97706","#ef4444","#16a34a"];

  function boxTable(counts) {
    return counts.map((c, i) =>
      `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:14px">
        <span style="color:${BOX_COLORS[i]};font-weight:700">กล่อง ${i} — ${BOX_LABELS[i]}</span>
        <span style="font-weight:700">${c} คำ</span>
      </div>`
    ).join("");
  }

  document.getElementById("restoreModalBody").innerHTML = `
    <div style="background:#eff6ff;border:1.5px solid #93c5fd;border-radius:10px;padding:12px 14px;margin-bottom:14px">
      <div style="font-size:13px;color:#1d4ed8;font-weight:700">📦 ไฟล์สำรองข้อมูล</div>
      <div style="font-size:14px;color:#374151;margin-top:4px">สร้างเมื่อ: <b>${createdAt}</b></div>
    </div>

    ${summary.map(item => `
      <div style="font-weight:800;font-size:15px;color:#111827;margin:14px 0 8px">${item.label}</div>
      ${boxTable(item.counts)}
    `).join("")}

    <div style="margin-top:16px;font-weight:800;font-size:15px;color:#111827">🔄 เลือกวิธีกู้คืน</div>

    <label id="restoreOptReset" style="display:flex;align-items:flex-start;gap:10px;margin-top:10px;padding:12px;border-radius:10px;border:2px solid #2563eb;background:#eff6ff;cursor:pointer" onclick="setRestoreMode('reset')">
      <input type="radio" name="restoreMode" value="reset" checked style="margin-top:3px;accent-color:#2563eb;width:16px;height:16px;flex-shrink:0">
      <div>
        <div style="font-weight:700;color:#1d4ed8;font-size:14px">🔄 เริ่มนับรอบทวนใหม่จากวันนี้ <span style="background:#dcfce7;color:#15803d;font-size:11px;padding:2px 7px;border-radius:999px;font-weight:700">แนะนำ</span></div>
      </div>
    </label>

    <label id="restoreOptKeep" style="display:flex;align-items:flex-start;gap:10px;margin-top:8px;padding:12px;border-radius:10px;border:2px solid #e5e7eb;background:#f9fafb;cursor:pointer" onclick="setRestoreMode('keep')">
      <input type="radio" name="restoreMode" value="keep" style="margin-top:3px;accent-color:#6b7280;width:16px;height:16px;flex-shrink:0">
      <div>
        <div style="font-weight:700;color:#374151;font-size:14px">📅 กู้คืนตามตารางทวนเดิม</div>
        ${totalOverdue > 0
          ? `<div style="font-size:12px;color:#dc2626;margin-top:3px">⚠️ มีคำเลยกำหนดแล้ว ${totalOverdue} คำ</div>`
          : `<div style="font-size:12px;color:#6b7280;margin-top:3px">ยังไม่มีคำเลยกำหนด</div>`}
      </div>
    </label>

    <div style="margin-top:14px;background:#fef2f2;border:1.5px solid #fecaca;border-radius:10px;padding:10px 12px;font-size:13px;color:#b91c1c">
      ⚠️ การกู้คืนจะ<b>เขียนทับข้อมูลปัจจุบันทั้งหมด</b> — ไม่สามารถย้อนกลับได้
    </div>
  `;

  document.getElementById("restoreModal").classList.remove("hidden");
}

function setRestoreMode(mode) {
  _pendingRestoreMode = mode;
  const resetEl = document.getElementById("restoreOptReset");
  const keepEl  = document.getElementById("restoreOptKeep");
  if (mode === "reset") {
    resetEl.style.border = "2px solid #2563eb";
    resetEl.style.background = "#eff6ff";
    keepEl.style.border = "2px solid #e5e7eb";
    keepEl.style.background = "#f9fafb";
  } else {
    keepEl.style.border = "2px solid #6b7280";
    keepEl.style.background = "#f3f4f6";
    resetEl.style.border = "2px solid #e5e7eb";
    resetEl.style.background = "#f9fafb";
  }
}

// ---- RESTORE: Step 3 — ยืนยันและเขียน ----
function confirmRestore() {
  if (!_pendingRestorePayload) return;

  const btn = document.getElementById("restoreConfirmBtn");
  btn.disabled = true;
  btn.textContent = "⏳ กำลังกู้คืน...";

  try {
    const snap    = _pendingRestorePayload.localStorage;
    const today   = todayStr();
    const toWrite = {}; // key → value string ที่จะเขียนจริง

    getBackupKeys().forEach(key => {
      if (snap[key] === undefined) return; // ไม่มีใน backup → ข้าม

      // SRS data: ถ้าเลือก reset → คำนวณ nextReview ใหม่
      if (key.startsWith("topik_srs_") && key.endsWith("_v1") && _pendingRestoreMode === "reset") {
        const data = safeParseJSON(snap[key], {});
        Object.keys(data).forEach(word => {
          const item = data[word];
          if (item.box >= 1 && item.box <= 4 && item.nextReview) {

           const backupDate =
             _pendingRestorePayload?.backupDate || today;

           const oldDate = new Date(item.nextReview);
           const baseDate = new Date(backupDate);

           const diffDays = Math.round(
             (oldDate - baseDate) / 86400000
           );

           item.nextReview = addDays(
            today,
            Math.max(1, diffDays)
           );

          } else if (item.box === 5) {
            item.nextReview = null;
          }
          data[word] = item;
        });
        toWrite[key] = JSON.stringify(data);
        return;
      }

      // อื่นๆ: เขียนตรงๆ
      toWrite[key] = snap[key];
    });

    // เขียนลง localStorage
    Object.entries(toWrite).forEach(([k, v]) => {
      localStorage.setItem(k, v);
    });

    _pendingRestorePayload = null;
    alert("✅ กู้คืนสำเร็จ! กำลัง reload...");
    location.reload();

  } catch(err) {
    btn.disabled = false;
    btn.textContent = "✅ กู้คืน";
    alert("❌ เกิดข้อผิดพลาด: " + err.message);
  }
}

function closeRestoreModal(event) {
  if (event.target === document.getElementById("restoreModal")) {
    document.getElementById("restoreModal").classList.add("hidden");
  }
}

// ---- Helper functions ----
function safeParseJSON(str, fallback) {
  try { return JSON.parse(str); }
  catch(e) { return fallback; }
}

function calcBoxCounts(srsData) {
  const counts = [0, 0, 0, 0, 0, 0];
  Object.values(srsData).forEach(item => {
    counts[Math.min(item.box || 0, 5)]++;
  });
  return counts;
}

function calcResetDates(today) {
  // คืนค่า nextReview ของแต่ละ box ถ้าเริ่มนับใหม่
  return {
    1: addDays(today, 1),
    2: addDays(today, 3),
    3: addDays(today, 7),
    4: addDays(today, 14),
  };
}

// ============================================================
// SEARCH
// ============================================================
function searchVocabulary(){
  const keyword = document.getElementById("searchInput").value.trim().toLowerCase();
  const resultBox = document.getElementById("searchResult");
  if(!keyword){ resultBox.classList.add("hidden"); resultBox.innerHTML = ""; return; }

  const sources = [
    { data: window.flashVocabData1,    level: "TOPIK1",  className: "level-topik1" },
    { data: window.flashVocabData2,    level: "TOPIK2",  className: "level-topik2" },
    { data: window.flashVocabDataEnA1, level: "EN A1",   className: "level-en-a1" },
    { data: window.flashVocabDataEnA2, level: "EN A2",   className: "level-en-a2" },
    { data: window.flashVocabDataEnB1, level: "EN B1",   className: "level-en-b1" },
    { data: window.flashVocabDataEnB2, level: "EN B2",   className: "level-en-b2" },
  ];

  const foundBySource = sources.map(({ data, level, className }) => {
    const matches = [];
    (data || []).forEach(item => {
      if(!item || typeof item.word !== "string" || typeof item.meaning !== "string") return;
      const word = item.word.toLowerCase();
      const meaning = item.meaning.toLowerCase();
      if(word.includes(keyword) || meaning.includes(keyword)) {
        matches.push({ word: item.word, meaning: item.meaning, level, className });
      }
    });
    return matches;
  });

  const found = [];
  let hasMore = true;
  while(hasMore){
    hasMore = false;
    foundBySource.forEach(matches => {
      const item = matches.shift();
      if(item){
        found.push(item);
        hasMore = true;
      }
    });
  }

  if(found.length === 0){
    resultBox.innerHTML = `<div class="search-notfound">❌ ไม่พบคำศัพท์</div>`;
    resultBox.classList.remove("hidden");
    return;
  }

  resultBox.innerHTML = found.map(item => `
    <div class="search-item">
      <div class="search-word ${item.className}">${item.word}</div>
      <div class="search-meaning">${item.meaning}</div>
      <div class="search-level ${item.className}">${item.level}</div>
    </div>`).join("");
  resultBox.classList.remove("hidden");
}

function clearSearchInput(){
  document.getElementById("searchInput").value = "";
  const resultBox = document.getElementById("searchResult");
  resultBox.innerHTML = "";
  resultBox.classList.add("hidden");
  document.getElementById("searchInput").focus();
}

function handleSearchEnter(event){
  if(event.key === "Enter"){
    searchVocabulary();
    document.getElementById("searchInput").blur();
  }
}

// ============================================================
// BOX INSPECTOR POPUP
// ============================================================
function openBoxInspector(boxNum){
  const data = loadSRS();
  const words = Object.values(data).filter(item => item.box === boxNum);

  const BOX_LABELS = ["ใหม่","1วัน","3วัน","7วัน","14วัน","จำได้✅"];
  const BOX_COLORS = ["#6b7280","#3b82f6","#8b5cf6","#f59e0b","#ef4444","#16a34a"];
  const label = boxNum <= 5 ? BOX_LABELS[boxNum] : "❌คำผิด";
  const color = boxNum <= 5 ? BOX_COLORS[boxNum] : "#db2777";

  let listHtml = "";
  if(words.length === 0){
    listHtml = `<div class="box-inspector-empty">ไม่มีคำในกล่องนี้</div>`;
  } else {
    words.forEach((item, i) => {
      const nextReview = item.nextReview ? `<span class="box-inspector-date">${item.nextReview}</span>` : "";
      listHtml += `<div class="box-inspector-item">
        <span class="box-inspector-num">${i+1}.</span>
        <span class="box-inspector-word">${item.word}</span>
        <span class="box-inspector-meaning">${item.meaning}</span>
        ${nextReview}
      </div>`;
    });
  }

  document.getElementById("boxInspectorTitle").textContent = `กล่อง ${boxNum} — ${label} (${words.length} คำ)`;
  document.getElementById("boxInspectorTitle").style.color = color;
  document.getElementById("boxInspectorList").innerHTML = listHtml;
  document.getElementById("boxInspectorModal").classList.remove("hidden");
}

function openWrongBoxInspector(){
  const words = getWrongBoxWords();
  let listHtml = "";
  if(words.length === 0){
    listHtml = `<div class="box-inspector-empty">ไม่มีคำผิดวันนี้</div>`;
  } else {
    words.forEach((item, i) => {
      listHtml += `<div class="box-inspector-item">
        <span class="box-inspector-num">${i+1}.</span>
        <span class="box-inspector-word">${item.word}</span>
        <span class="box-inspector-meaning">${item.meaning}</span>
      </div>`;
    });
  }
  document.getElementById("boxInspectorTitle").textContent = `กล่องคำผิด (${words.length} คำ)`;
  document.getElementById("boxInspectorTitle").style.color = "#db2777";
  document.getElementById("boxInspectorList").innerHTML = listHtml;
  document.getElementById("boxInspectorModal").classList.remove("hidden");
}

function closeBoxInspector(){
  document.getElementById("boxInspectorModal").classList.add("hidden");
}

// ============================================================
// NEXT SET POOL — เก็บคำที่ยังไม่ได้เล่นในรอบนี้
// ============================================================
let practicePool = [];      // pool สำหรับ practice
let wrongboxPool = [];      // pool สำหรับ wrongbox
let lastPlayedWords = [];   // คำชุดล่าสุด (ใช้ exclude)
let practiceSourceWords = [];

function getNextPracticeSet() {
  const chunkSize = getPracticeChunkSize();
  const selectedBoxes = getPracticeSelectedBoxes();

  // ถ้า pool หมดหรือยังไม่มี → rebuild จาก box ที่เลือก
  if (practicePool.length === 0) {
    practiceSourceWords = getPracticeWordsByBoxes(selectedBoxes, 99999);
    practicePool = shuffleArray([...practiceSourceWords]);
  }

  // พยายาม exclude lastPlayedWords ก่อน
  let available = practicePool.filter(w => !lastPlayedWords.some(l => l.word === w.word));

  // ถ้า exclude แล้วเหลือน้อยกว่า chunkSize → ใช้ทั้ง pool (วนรอบใหม่)
  if (available.length < chunkSize) {
    practicePool = shuffleArray([...practiceSourceWords]); // rebuild
    available = practicePool;
  }

  const chunk = available.slice(0, chunkSize);
  // ตัดคำที่ใช้ไปออกจาก pool
  practicePool = practicePool.filter(w => !chunk.some(c => c.word === w.word));
  lastPlayedWords = chunk;
  return chunk;
}

function getNextWrongboxSet() {
  const chunkSize = getWrongChunkSize();
  const allWords = getWrongBoxWords();

  if (allWords.length === 0) return [];

  // ถ้า pool หมด → rebuild (วนรอบใหม่ — ตรงกับ requirement)
  if (wrongboxPool.length === 0) {
    wrongboxPool = shuffleArray([...allWords]);
  }

  // พยายาม exclude lastPlayedWords
  let available = wrongboxPool.filter(w => !lastPlayedWords.some(l => l.word === w.word));
  if (available.length === 0) {
    // วนรอบใหม่ทั้งหมด
    wrongboxPool = shuffleArray([...allWords]);
    available = wrongboxPool;
  }

  const chunk = available.slice(0, chunkSize);
  wrongboxPool = wrongboxPool.filter(w => !chunk.some(c => c.word === w.word));
  lastPlayedWords = chunk;
  return chunk;
}

// ============================================================
// PLAY NEXT SET — ฟังก์ชันหลัก
// ============================================================
function playNextSet() {
  // ป้องกัน double-click
  const btn = document.getElementById("nextSetBtn");
  if (btn) btn.disabled = true;

  // reset history เพื่อไม่ให้ย้อนกลับไปหน้าสรุปเก่า
  screenHistory = screenHistory.filter(id => id !== "finishScreen");
  wrongAnswers = [];

  if (srsSessionType === "wrongbox") {
    const words = getNextWrongboxSet();
    if (words.length === 0) { goToSRSDashboard(); return; }
    srsSessionWords = words;
    currentVocabulary = srsSessionWords.map(i => ({ word: i.word, meaning: i.meaning }));
    startWrongBoxGame(srsSessionMode); // ใช้ gameType เดิม
  } else {
    // practice
    const words = getNextPracticeSet();
    if (words.length === 0) { goToSRSDashboard(); return; }
    srsSessionWords = words;
    srsSessionType = "practice"; // set ก่อนเรียก startPracticeGame
    startPracticeGame(srsSessionMode); // ใช้ gameType เดิม
  }

  // re-enable หลัง render (setTimeout เล็กน้อย)
  setTimeout(() => { if (btn) btn.disabled = false; }, 500);
}

function playNextSetOtherMode() {
  const btn = document.getElementById("nextSetOtherModeBtn");
  if(btn) btn.disabled = true;

  screenHistory = screenHistory.filter(id => id !== "finishScreen");
  wrongAnswers = [];

  const otherMode = srsSessionMode === "quiz" ? "typing" : "quiz";

  if(srsSessionType === "wrongbox"){
    const words = getNextWrongboxSet();
    if(words.length === 0){ goToSRSDashboard(); return; }
    srsSessionWords = words;
    currentVocabulary = srsSessionWords.map(i => ({ word: i.word, meaning: i.meaning }));
    startWrongBoxGame(otherMode);
  } else {
    const words = getNextPracticeSet();
    if(words.length === 0){ goToSRSDashboard(); return; }
    srsSessionWords = words;
    srsSessionType = "practice";
    startPracticeGame(otherMode);
  }

  setTimeout(() => { if(btn) btn.disabled = false; }, 500);
}

/// ซ่อนชื่อ TOPIK 1/2 by 톤님 ในหน้าเล่นเกมส์
function updateTitleVisibility(){
  const cur = document.querySelector(".screen:not(.hidden)")?.id;
  const hide = ["flashcardGame","quizGame","typingGame", "srsStats"];
  document.getElementById("appTitle").classList.toggle("hidden", hide.includes(cur));
}