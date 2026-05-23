// =========================
// HISTORY
// =========================
let screenHistory = [];

// =========================
// ELEMENTS
// =========================
const backButton = document.getElementById("backButton");
const homeButton = document.getElementById("homeButton");

// =========================
// CURRENT VOCAB
// =========================
let currentVocabulary = [];

// =========================
// SHOW SCREEN
// =========================
function showScreen(screenId){
  document.querySelectorAll(".screen").forEach(screen => {
    screen.classList.add("hidden");
  });

  const targetScreen = document.getElementById(screenId);
  if(targetScreen){
    targetScreen.classList.remove("hidden");
  }
}

// =========================
// GO TO
// =========================
function goTo(screenId){
  const currentScreen = document.querySelector(".screen:not(.hidden)");
  if(currentScreen){
    screenHistory.push(currentScreen.id);
  }
  showScreen(screenId);
  updateButtons();
}

// =========================
// BACK
// =========================
function goBack(){
  if(screenHistory.length === 0){
    return;
  }
  const previousScreen = screenHistory.pop();
  showScreen(previousScreen);
  updateButtons();
}

// =========================
// HOME
// =========================
function showMainMenu(){
  screenHistory = [];
  showScreen("mainMenu");
  updateButtons();
}

// =========================
// BUTTONS
// =========================
function updateButtons(){
  if(screenHistory.length === 0){
    backButton.classList.add("hidden");
    homeButton.classList.add("hidden");
  }else{
    backButton.classList.remove("hidden");
    homeButton.classList.remove("hidden");
  }
}

// =========================
// COMING SOON
// =========================
function showComingSoon(){
  alert("🚀 เจอกันเร็วๆนี้ครับ!");
}

// ==========================================
// SELECT VOCAB
// ==========================================
function selectFlashcard(targetSet){

  // แมปชุดคำศัพท์ → ข้อมูล
  const vocabMap = {
    'Voflash':  window.flashVocabData,
    'nounset1': window.Vonouns1,
    'nounset2': window.Vonouns2,
    // เพิ่มชุดใหม่ได้ที่นี่ เช่น 'set2': window.Vonouns2
  };

  const vocab = vocabMap[targetSet];

  if (!vocab || vocab.length === 0) {
    alert("📚 ขออภัย ยังไม่มีคำศัพท์ในชุดนี้ครับ");
    return;
  }

  currentVocabulary = vocab;

  goTo("gameMenu");
}
