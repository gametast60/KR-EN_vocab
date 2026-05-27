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
let currentMode = "";
let currentIndex = 0;
let quizIndex = 0;
let fcIndex = 0;
let fcForgotten = [];
let isDueMode = false;   // ← true เฉพาะ "ทวนวันนี้"

// =========================
// SPEAK
// =========================
function speak(text){
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "ko-KR";
  utterance.rate = 0.9;
  speechSynthesis.speak(utterance);
}
function speakWord(){ speak(shuffledVocabulary[currentIndex].word); }
function speakQuizWord(){ speak(shuffledVocabulary[quizIndex].word); }
function speakFlashcard(){ speak(shuffledVocabulary[fcIndex].word); }

// =========================
// FLASHCARD MODE (SRS เท่านั้น — ใช้ใน "ทวนวันนี้")
// =========================
function showFlashcard(){
  const currentWord = shuffledVocabulary[fcIndex];
  document.getElementById("flashcardFront").classList.remove("hidden");
  document.getElementById("flashcardBack").classList.add("hidden");
  document.getElementById("fcWord").textContent = currentWord.word;
  document.getElementById("fcWordBack").textContent = currentWord.word;
  document.getElementById("fcMeaning").textContent = currentWord.meaning;
  document.getElementById("flashcardProgress").textContent =
    `คำที่ ${fcIndex + 1} / ${shuffledVocabulary.length}`;
  speak(currentWord.word);
}

function flipCard(){
  document.getElementById("flashcardFront").classList.add("hidden");
  document.getElementById("flashcardBack").classList.remove("hidden");
}

function fcAnswer(known){
  const currentWord = shuffledVocabulary[fcIndex];

  // อัปเดต SRS เฉพาะโหมด "ทวนวันนี้" เท่านั้น
  if(isDueMode){
    recordAnswer(currentWord.word, known);
    if(!known){
      addToWrongBox(currentWord);
      if(!fcForgotten.some(item => item.word === currentWord.word)){
        fcForgotten.push(currentWord);
      }
    }
  }

  fcIndex++;

  // ถ้ากล่องคำผิดเต็มแล้ว — หยุดกลางคันทันที
  if(isDueMode && isWrongBoxFull()){
    showSRSFinish(fcForgotten);
    return;
  }

  if(fcIndex >= shuffledVocabulary.length){
    showSRSFinish(fcForgotten);
  } else {
    showFlashcard();
  }
}

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
  input.focus();
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

  if(userAnswer === currentWord.word){
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
    result.textContent = `❌ ${currentWord.word}`;
    result.className = "result wrong";
    input.value = "";
    input.focus();
    if(!wrongAnswers.some(item => item.word === currentWord.word)){
      wrongAnswers.push(currentWord);
    }
  }
}

function showQuiz(){
  const currentWord = shuffledVocabulary[quizIndex];
  document.getElementById("quizWord").textContent = currentWord.word;
  document.getElementById("quizResult").textContent = "";
  document.getElementById("quizProgress").textContent =
    `คำที่ ${quizIndex + 1} / ${shuffledVocabulary.length}`;

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
    result.textContent = `❌ ${currentWord.meaning}`;
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
// FINISH (ฝึกหัด / ทวนคำผิด — ไม่มีผล SRS)
// =========================
function showFinish(){
  goTo("finishScreen");

  // ตั้งป้ายปุ่ม switch mode
  const switchBtn = document.getElementById("switchModeBtn");
  if(switchBtn){
    if(srsSessionMode === "quiz"){
      switchBtn.textContent = "⌨️ เล่นชุดนี้แบบเติมคำ";
    } else {
      switchBtn.textContent = "🔤 เล่นชุดนี้แบบจับคู่";
    }
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
  // เล่นซ้ำโหมดเดิม คำชุดเดิม
  if(srsSessionType === "wrongbox"){
    startWrongBoxGame(srsSessionMode);
  } else {
    startPracticeGame(srsSessionMode);
  }
}

function switchMode(){
  // สลับโหมด คำชุดเดิม
  const newMode = srsSessionMode === "quiz" ? "typing" : "quiz";
  if(srsSessionType === "wrongbox"){
    startWrongBoxGame(newMode);
  } else {
    startPracticeGame(newMode);
  }
}

function stopFlashcard(){
  if(!confirm("⏹ หยุดเล่นกลางคัน?\n\nคำที่กดไปแล้วจะถูกบันทึก\nคำที่ยังไม่ได้เล่นจะไม่มีผล")) return;
  speechSynthesis.cancel();
  goBack();
  renderSRSHome();
  updateNavButtons();
}