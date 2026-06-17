// =========================
// SHUFFLE
// =========================
function shuffleArray(array){
  for(let i = array.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// =========================
// VARIABLES
// =========================
let shuffledVocabulary = [];
let wrongAnswers = [];
let currentIndex = 0;
let quizIndex = 0;
let fcIndex = 0;
let fcForgotten = [];
let isDueMode = false;   // ← true เฉพาะ "ทวนวันนี้"

// ---- ด่าน 2 (Due Mode) ----
let pendingList     = [];   // คำที่กด "จำได้" จากด่าน 1 รอตัดสินในด่าน 2
let dueStage        = 1;    // 1 = Flashcard, 2 = FillBlank
let fillIndex       = 0;    // index ใน pendingList สำหรับด่าน 2
let fillWrongList   = [];   // คำที่เติมผิดในด่าน 2
let fillCorrectCount = 0;

// =========================
// SPEAK
// =========================
function getSpeechLang(){
  if(typeof currentTopik === "string" && currentTopik.startsWith("english_")){
    return "en-US";
  }
  return "ko-KR";
}

function speak(text){
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = getSpeechLang();
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}
function speakQuizWord(){ speak(shuffledVocabulary[quizIndex].word); }
function speakFlashcard(){
  if(dueStage === 2){
    speak(pendingList[fillIndex].word);
  } else {
    speak(shuffledVocabulary[fcIndex].word);
  }
}

// =========================
// FLASHCARD MODE — ด่าน 1
// =========================
function showFlashcard(){
  const currentWord = shuffledVocabulary[fcIndex];
  
  const inner = document.getElementById("flashcardInner");
  if(inner) inner.classList.remove("flipped");
  const container = document.getElementById("flashcardContainer");
  if(container) container.classList.remove("hidden");

  document.getElementById("fcWord").textContent = currentWord.word;
  document.getElementById("fcWordBack").textContent = currentWord.word;
  document.getElementById("fcMeaning").textContent = currentWord.meaning;
  const badge = document.getElementById("flashcardProgress");
  badge.textContent = `ด่าน 1 — คำที่ ${fcIndex + 1} / ${shuffledVocabulary.length}`;
  badge.classList.remove("stage2");
  badge.classList.remove("hidden");
  speak(currentWord.word);
  updateTitleVisibility();
}

function flipCard(){
  const inner = document.getElementById("flashcardInner");
  if(inner) inner.classList.add("flipped");
}

function fcAnswer(known){
  const currentWord = shuffledVocabulary[fcIndex];

  if(isDueMode){
    if(!known){
      // จำไม่ได้ → บันทึก SRS ทันที, กลับกล่อง 1
      recordAnswer(currentWord.word, false);
      addToWrongBox(currentWord);
      if(!fcForgotten.some(item => item.word === currentWord.word)){
        fcForgotten.push(currentWord);
      }
    } else {
      // จำได้ → เก็บใน pendingList รอด่าน 2
      if(!pendingList.some(item => item.word === currentWord.word)){
        pendingList.push({ word: currentWord.word, meaning: currentWord.meaning });
      }
    }
  }

  fcIndex++;

  // กล่องคำผิดเต็ม → หยุดทันที
  if(isDueMode && isWrongBoxFull()){
    finishStage1Early();
    return;
  }

  if(fcIndex >= shuffledVocabulary.length){
    finishStage1();
  } else {
    showFlashcard();
  }
}

// ด่าน 1 จบตามปกติ
function finishStage1(){
  if(!isDueMode || pendingList.length === 0){
    // ไม่มี pending → จบเกมเลย
    showSRSFinish(fcForgotten);
    return;
  }
  showStage2Popup();
}

// ด่าน 1 จบเพราะกล่องคำผิดเต็ม
function finishStage1Early(){
  pendingList = []; // ทิ้ง pending ทั้งหมด
  showSRSFinish(fcForgotten);
}

// Popup แจ้งเข้าด่าน 2
function showStage2Popup(){
  const popup = document.getElementById("stage2Popup");
  if(popup) popup.classList.remove("hidden");
  else confirmStage2(); // ถ้าไม่มี popup ให้ข้ามไปด่าน 2 เลย
}

function confirmStage2(){
  const popup = document.getElementById("stage2Popup");
  if(popup) popup.classList.add("hidden");
  startStage2();
}

// =========================
// ด่าน 2 — Fill Blank (SRS Due Mode)
// =========================
function startStage2(){
  dueStage   = 2;
  fillIndex  = 0;
  fillWrongList  = [];
  fillCorrectCount = 0;
  shuffleArray(pendingList);  // สับก่อนเริ่ม

  // แสดงหน้าเติมคำของด่าน 2 (ใช้หน้า flashcardGame แต่สลับ UI)
  showFillCard();
}

function showFillCard(){
  const word = pendingList[fillIndex];
  const badge = document.getElementById("flashcardProgress");
  badge.textContent = `ด่าน 2 — คำที่ ${fillIndex + 1} / ${pendingList.length}`;
  badge.classList.add("stage2");
  badge.classList.remove("hidden");

  // ใช้ fillCardUI แทน 3D Card
  const container = document.getElementById("flashcardContainer");
  if(container) container.classList.add("hidden");
  document.getElementById("fillCardUI").classList.remove("hidden");

  document.getElementById("fillMeaning").textContent = word.meaning;
  document.getElementById("fillInput").value = "";
  document.getElementById("fillInput").disabled = false;
  document.getElementById("fillResult").textContent = "";
  document.getElementById("fillResult").className = "result";
  document.getElementById("fillCheckBtn").disabled = false;

  const clearBtn = document.getElementById("fillClearBtn");
  clearBtn.classList.add("hidden");
  document.getElementById("fillInput").oninput = () => {
    clearBtn.classList.toggle("hidden", document.getElementById("fillInput").value.length === 0);
  };

  setTimeout(() => document.getElementById("fillInput").focus(), 100);
}

function handleFillEnter(event){
  if(event.key === "Enter") checkFillAnswer();
}

function clearFillInput(){
  document.getElementById("fillInput").value = "";
  document.getElementById("fillClearBtn").classList.add("hidden");
  document.getElementById("fillResult").textContent = "";
  document.getElementById("fillResult").className = "result";
  document.getElementById("fillInput").focus();
}

function checkFillAnswer(){
  const input    = document.getElementById("fillInput");
  const checkBtn = document.getElementById("fillCheckBtn");
  const result   = document.getElementById("fillResult");
  if(checkBtn.disabled) return;

  const userAnswer = input.value.trim();
  const word = pendingList[fillIndex];

  const isEnglish = currentTopik?.startsWith("english_");

const isCorrect = isEnglish
  ? userAnswer.toLowerCase() === word.word.toLowerCase()
  : userAnswer === word.word;

if(isCorrect){
  // ✅ ถูก → เลื่อนกล่อง, บันทึก SRS
  result.textContent = "✅ ถูกต้อง!";
  result.className = "result correct";
  input.disabled = true;
  checkBtn.disabled = true;
  recordAnswer(word.word, true);
  fillCorrectCount++;
  setTimeout(() => nextFillCard(), 1000);

} else {
  // ❌ ผิดทันที ไม่ให้แก้ตัว → กลับกล่อง 1, บันทึก SRS
  result.innerHTML = `❌ เฉลย: <strong style="margin-left: 6px; font-size: 18px;">${word.word}</strong>`;
  result.className = "result wrong";
  input.disabled = true;
  checkBtn.disabled = true;
  recordAnswer(word.word, false);
  addToWrongBox(word);

  if(!fcForgotten.some(i => i.word === word.word)){
    fcForgotten.push(word);
  }

  if(!fillWrongList.some(i => i.word === word.word)){
    fillWrongList.push(word);
  }

  setTimeout(() => nextFillCard(), 1200);
}
}

function nextFillCard(){
  fillIndex++;
  if(fillIndex >= pendingList.length || (isDueMode && isWrongBoxFull())){
    finishStage2();
  } else {
    showFillCard();
  }
}

function finishStage2(){
  pendingList = []; // เคลียร์
  dueStage = 1;
  showSRSFinish(fcForgotten);
}

// =========================
// STOP FLASHCARD (ปุ่มหยุด)
// =========================
function stopFlashcard(){
  if(!confirm("⏹ หยุดเล่นกลางคัน?\n\nคำที่กดไปแล้วจะถูกบันทึก\nคำที่ยังไม่ได้เล่นจะไม่มีผล")) return;
  speechSynthesis.cancel();

  if(isDueMode){
    if(dueStage === 1){
      // กรณี 1: หยุดระหว่างด่าน 1
      // คำที่จำไม่ได้ → บันทึกแล้วตั้งแต่กดปุ่ม (ในฟังก์ชัน fcAnswer)
      // คำใน pendingList → ทิ้งได้เลย ไม่บันทึก
      pendingList = [];
    }
    // กรณี 2: หยุดระหว่างด่าน 2
    // คำที่ตอบแล้ว (ถูก/ผิด) → บันทึกแล้วตั้งแต่กด checkFillAnswer
    // คำที่ยังไม่แสดง → ไม่นับ ไม่บันทึก (ปล่อยทิ้ง)
  }

  // ปิด popup ด่าน 2 ถ้าเปิดอยู่
  document.getElementById("stage2Popup")?.classList.add("hidden");
  // ซ่อน 3D Card และ fillCardUI
  document.getElementById("flashcardContainer")?.classList.add("hidden");
  document.getElementById("fillCardUI")?.classList.add("hidden");
  dueStage = 1;

  // แสดงสรุปแทน goBack
  if(isDueMode){
    // สรุปเฉพาะคำที่ตัดสินแล้ว (fcForgotten + fillWrongList รวมกันแล้ว)
    showSRSFinish(fcForgotten);
  } else {
    goBack();
    renderSRSHome();
    updateNavButtons();
  }
}

// =========================
// TYPING GAME (ฝึกหัด / ทวนคำผิด)
// =========================
function showWord(){
  const currentWord = shuffledVocabulary[currentIndex];
  document.getElementById("meaning").textContent = currentWord.meaning;
  const input = document.getElementById("answerInput");
  const clearBtn = document.getElementById("clearAnswerBtn");
  input.value = "";
  input.disabled = false;
  clearBtn.classList.add("hidden");
  input.oninput = () => {
    clearBtn.classList.toggle("hidden", input.value.length === 0);
  };
  document.getElementById("checkBtn").disabled = false;
  document.getElementById("result").textContent = "";
  document.getElementById("progress").textContent =
    `คำที่ ${currentIndex + 1} / ${shuffledVocabulary.length}`;
  document.getElementById("progress").classList.remove("hidden");
  input.focus();
  updateTitleVisibility();
}

function clearAnswerInput(){
  const input = document.getElementById("answerInput");
  input.value = "";
  document.getElementById("clearAnswerBtn").classList.add("hidden");
  document.getElementById("result").textContent = "";
  document.getElementById("result").className = "result";
  input.focus();
}

function handleEnter(event){
  if(event.key === "Enter") checkAnswer();
}

function checkAnswer(){
  const input = document.getElementById("answerInput");
  const checkBtn = document.getElementById("checkBtn");
  const userAnswer = input.value.trim();
  if(checkBtn.disabled) return;

  const currentWord = shuffledVocabulary[currentIndex];
  const result = document.getElementById("result");

  const isEnglish = currentTopik?.startsWith("english_");

const isCorrect = isEnglish
  ? userAnswer.toLowerCase() === currentWord.word.toLowerCase()
  : userAnswer === currentWord.word;

if(isCorrect){
  result.textContent = "✅ ถูกต้อง!";
  result.className = "result correct";
  input.disabled = true;
  checkBtn.disabled = true;

  setTimeout(() => {
    currentIndex++;
    if(currentIndex >= shuffledVocabulary.length){
      showFinish();
    } else {
      showWord();
    }
  }, 1000);

} else {
  result.innerHTML = `❌ เฉลย: <strong style="margin-left: 6px; font-size: 18px;">${currentWord.word}</strong>`;
  result.className = "result wrong";
  input.value = "";
  input.focus();

  if(!wrongAnswers.some(item => item.word === currentWord.word)){
    wrongAnswers.push(currentWord);
  }
}
}

// =========================
// QUIZ GAME
// =========================
function showQuiz(){
  const currentWord = shuffledVocabulary[quizIndex];
  document.getElementById("quizWord").textContent = currentWord.word;
  document.getElementById("quizResult").textContent = "";
  document.getElementById("quizProgress").textContent =
    `คำที่ ${quizIndex + 1} / ${shuffledVocabulary.length}`;
  document.getElementById("quizProgress").classList.remove("hidden");

  const container = document.getElementById("choicesContainer");
  container.innerHTML = "";

  const numChoices = Math.min(4, shuffledVocabulary.length);
  let choices = [currentWord.meaning];
  const otherMeanings = shuffleArray(
    shuffledVocabulary.map(item => item.meaning).filter(m => m !== currentWord.meaning)
  );
  for(let i = 0; choices.length < numChoices; i++){
    choices.push(otherMeanings[i]);
  }
  choices.sort(() => Math.random() - 0.5);

  choices.forEach(choice => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.textContent = choice;
    btn.onclick = () => checkQuizAnswer(choice);
    container.appendChild(btn);
  });

  speak(currentWord.word);
  updateTitleVisibility();
}

function checkQuizAnswer(choice){
  const currentWord = shuffledVocabulary[quizIndex];
  const result = document.getElementById("quizResult");
  const container = document.getElementById("choicesContainer");

  container.querySelectorAll(".choice-btn").forEach(btn => { btn.disabled = true; });

  if(choice === currentWord.meaning){
    result.textContent = "✅ ถูกต้อง!";
    result.className = "result correct";
  } else {
    result.innerHTML = `❌ เฉลย: <strong style="margin-left: 6px; font-size: 18px;">${currentWord.meaning}</strong>`;
    result.className = "result wrong";
    if(!wrongAnswers.some(item => item.word === currentWord.word)){
      wrongAnswers.push(currentWord);
    }
  }

  setTimeout(() => {
    quizIndex++;
    if(quizIndex >= shuffledVocabulary.length){
      showFinish();
    } else {
      showQuiz();
    }
  }, 1000);
}

// =========================
// FINISH (ฝึกหัด / ทวนคำผิด)
// =========================
function showFinish(){
  goTo("finishScreen");

  const switchBtn = document.getElementById("switchModeBtn");
  const nextOtherBtn = document.getElementById("nextSetOtherModeBtn");

if(srsSessionMode === "quiz"){
  if(switchBtn){ switchBtn.textContent = "ไปเติมคำ"; switchBtn.style.background = "#7c3aed"; } //ชุดเดิมจากโหมดจับคู่
  if(nextOtherBtn){ nextOtherBtn.textContent = "ชุดใหม่ + เติมคำ"; nextOtherBtn.style.background = "#208deb"; }
} else {
  if(switchBtn){ switchBtn.textContent = "ชุดเดิม + จับคู่"; switchBtn.style.background = "#208deb"; }
  if(nextOtherBtn){ nextOtherBtn.textContent = "ไปจับคู่"; nextOtherBtn.style.background = "#7c3aed"; } //สุ่มไพ่ใหม่
}

  const wrongContainer = document.getElementById("wrongAnswers");
  if(wrongAnswers.length === 0){
    wrongContainer.innerHTML = `<div class="wrong-list"><h3>🎉 ตอบถูกทั้งหมด ยอดเยี่ยมมาก!</h3></div>`;
    return;
  }
  let html = `<div class="wrong-list"><h3>❌ คำที่ตอบผิด (${wrongAnswers.length} คำ)</h3>`;
  wrongAnswers.forEach((item, index) => {
    html += `<div class="wrong-item">${index+1}. <b>${item.word}</b> = ${item.meaning}</div>`;
  });
  html += `</div>`;
  wrongContainer.innerHTML = html;
}

function replayCurrentMode(){
  if(srsSessionType === "wrongbox"){
    startWrongBoxGame(srsSessionMode);
  } else {
    startPracticeGame(srsSessionMode);
  }
}

function switchMode(){
  const newMode = srsSessionMode === "quiz" ? "typing" : "quiz";
  if(srsSessionType === "wrongbox"){
    startWrongBoxGame(newMode);
  } else {
    startPracticeGame(newMode);
  }
}

function stopWrongBoxGame(){
  if(!confirm("⏹ หยุดเล่นกลางคัน?\n\nคำที่เล่นไปแล้วจะไม่ถูกบันทึก")) return;
  speechSynthesis.cancel();
  goToSRSDashboard();
}