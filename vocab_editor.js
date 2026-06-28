// ============================================================
// VOCABULARY STAGING EDITOR & EXPORTER
// ============================================================

let currentEditWordObj = null; // Store temp edit state { word, oldMeaning, levelId }

function normalizeWord(word) {
  return (word || "").trim().toLowerCase();
}

function mapLevelToId(level) {
  const mapping = {
    "TOPIK1": "topik1",
    "TOPIK2": "topik2",
    "EN A1": "english_a1",
    "EN A2": "english_a2",
    "EN B1": "english_b1",
    "EN B2": "english_b2"
  };
  return mapping[level] || String(level).toLowerCase().replace(/\s+/g, "_");
}

function getVocabEditsList(levelId) {
  try {
    const raw = localStorage.getItem(`${levelId}_vocab_edits`);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveVocabEditsList(levelId, list) {
  localStorage.setItem(`${levelId}_vocab_edits`, JSON.stringify(list));
}

// ---- POPUP OPENERS ----

function openEditPopup(word, oldMeaning, levelId) {
  speechSynthesis.cancel();
  
  const edits = getVocabEditsList(levelId);
  const normalizedWord = normalizeWord(word);
  const existingEdit = edits.find(item => normalizeWord(item.word) === normalizedWord);
  
  currentEditWordObj = { word, oldMeaning, levelId };
  
  const wordInput = document.getElementById("editVocabWord");
  const meaningInput = document.getElementById("editVocabMeaning");
  const modal = document.getElementById("editVocabModal");
  
  if (wordInput && meaningInput && modal) {
    wordInput.value = word;
    // Prefill with existing newMeaning if available, else original meaning
    meaningInput.value = existingEdit ? existingEdit.newMeaning : oldMeaning;
    modal.classList.remove("hidden");
    meaningInput.focus();
  }
}

function openEditCurrentWordPopup() {
  const screenId = getCurrentScreenId();
  let wordObj = null;
  
  if (screenId === "flashcardGame") {
    if (typeof dueStage !== "undefined" && dueStage === 2) {
      if (typeof pendingList !== "undefined" && typeof fillIndex !== "undefined") {
        wordObj = pendingList[fillIndex];
      }
    } else {
      if (typeof shuffledVocabulary !== "undefined" && typeof fcIndex !== "undefined") {
        wordObj = shuffledVocabulary[fcIndex];
      }
    }
  } else if (screenId === "typingGame") {
    if (typeof shuffledVocabulary !== "undefined" && typeof currentIndex !== "undefined") {
      wordObj = shuffledVocabulary[currentIndex];
    }
  } else if (screenId === "quizGame") {
    if (typeof shuffledVocabulary !== "undefined" && typeof quizIndex !== "undefined") {
      wordObj = shuffledVocabulary[quizIndex];
    }
  }
  
  if (!wordObj) return;
  
  const levelId = typeof currentTopik !== "undefined" && currentTopik ? currentTopik : "topik1";
  openEditPopup(wordObj.word, wordObj.meaning, levelId);
}

function closeEditVocabModal(event) {
  if (event && event.target !== event.currentTarget) return;
  
  const modal = document.getElementById("editVocabModal");
  if (modal) {
    modal.classList.add("hidden");
  }
  restoreGameFocus();
}

// Restore focus to typing inputs based on game states
function restoreGameFocus() {
  const screenId = getCurrentScreenId();
  if (screenId === "typingGame") {
    const input = document.getElementById("answerInput");
    if (input) input.focus();
  } else if (screenId === "flashcardGame" && typeof dueStage !== "undefined" && dueStage === 2) {
    const input = document.getElementById("fillInput");
    if (input) input.focus();
  }
}

function openAddVocabPopup() {
  const wordInput = document.getElementById("addVocabWord");
  const meaningInput = document.getElementById("addVocabMeaning");
  const modal = document.getElementById("addVocabModal");
  
  if (wordInput && meaningInput && modal) {
    wordInput.value = "";
    meaningInput.value = "";
    modal.classList.remove("hidden");
    wordInput.focus();
  }
}

function closeAddVocabModal(event) {
  if (event && event.target !== event.currentTarget) return;
  
  const modal = document.getElementById("addVocabModal");
  if (modal) {
    modal.classList.add("hidden");
  }
}

// ---- ACTIONS ----

function saveVocabEdit() {
  if (!currentEditWordObj) return;
  
  const { word, oldMeaning, levelId } = currentEditWordObj;
  const meaningInput = document.getElementById("editVocabMeaning");
  if (!meaningInput) return;
  
  const newMeaning = meaningInput.value.trim();
  const cleanWord = word.trim();
  
  if (!cleanWord || !newMeaning) {
    alert("กรุณากรอกข้อมูลให้ครบถ้วน");
    return;
  }
  
  if (oldMeaning.trim() === newMeaning) {
    alert("ไม่มีการเปลี่ยนแปลง");
    return;
  }
  
  const edits = getVocabEditsList(levelId);
  const normalizedWord = normalizeWord(cleanWord);
  const existingIndex = edits.findIndex(item => normalizeWord(item.word) === normalizedWord);
  
  const today = typeof todayStr === "function" ? todayStr() : new Date().toISOString().split('T')[0];
  
  if (existingIndex !== -1) {
    // Update in place
    edits[existingIndex].newMeaning = newMeaning;
    edits[existingIndex].date = today;
    edits[existingIndex].type = "edit"; // Just in case
    edits[existingIndex].level = levelId;
  } else {
    // Push new edit object
    edits.push({
      type: "edit",
      level: levelId,
      word: cleanWord,
      oldMeaning: oldMeaning.trim(),
      newMeaning: newMeaning,
      date: today
    });
  }
  
  saveVocabEditsList(levelId, edits);
  
  const modal = document.getElementById("editVocabModal");
  if (modal) {
    modal.classList.add("hidden");
  }
  restoreGameFocus();
}

function saveVocabAdd() {
  const wordInput = document.getElementById("addVocabWord");
  const meaningInput = document.getElementById("addVocabMeaning");
  if (!wordInput || !meaningInput) return;
  
  const word = wordInput.value.trim();
  const meaning = meaningInput.value.trim();
  const levelId = typeof currentTopik !== "undefined" && currentTopik ? currentTopik : "topik1";
  
  if (!word || !meaning) {
    alert("กรุณากรอกข้อมูลให้ครบถ้วน");
    return;
  }
  
  const normalizedWord = normalizeWord(word);
  
  // 1. Check original database
  const vocabList = typeof getTopikVocab === "function" ? getTopikVocab(levelId) : [];
  const existsInDb = vocabList.some(item => item && normalizeWord(item.word) === normalizedWord);
  
  // 2. Check staged edits with type "add" (ignore type "edit")
  const edits = getVocabEditsList(levelId);
  const existsInAddEdits = edits.some(item => item.type === "add" && normalizeWord(item.word) === normalizedWord);
  
  if (existsInDb || existsInAddEdits) {
    alert("คำนี้มีอยู่แล้ว");
    return;
  }
  
  const today = typeof todayStr === "function" ? todayStr() : new Date().toISOString().split('T')[0];
  
  edits.push({
    type: "add",
    level: levelId,
    word: word,
    newMeaning: meaning,
    date: today
  });
  
  saveVocabEditsList(levelId, edits);
  
  const modal = document.getElementById("addVocabModal");
  if (modal) {
    modal.classList.add("hidden");
  }
}

function exportVocabEdits() {
  const levelId = typeof currentTopik !== "undefined" && currentTopik ? currentTopik : "topik1";
  const edits = getVocabEditsList(levelId);
  
  if (edits.length === 0) {
    alert("ไม่มีคำศัพท์ที่ต้องส่งออก");
    return;
  }
  
  // Map output elements to match formatting without 'date' property
  const cleanEdits = edits.map(item => {
    if (item.type === "edit") {
      return {
        type: "edit",
        level: item.level,
        word: item.word,
        oldMeaning: item.oldMeaning,
        newMeaning: item.newMeaning
      };
    } else {
      return {
        type: "add",
        level: item.level,
        word: item.word,
        newMeaning: item.newMeaning
      };
    }
  });
  
  const fileContent = `const vocabEdits = ${JSON.stringify(cleanEdits, null, 2)};\n`;
  const blob = new Blob([fileContent], { type: "application/javascript;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const dateStr = typeof todayStr === "function" ? todayStr() : new Date().toISOString().split('T')[0];
  
  a.href = url;
  a.download = `${levelId}_vocab_edits_${dateStr}.js`;
  a.click();
  URL.revokeObjectURL(url);
  
  // Show confirmation modal
  setTimeout(() => {
    const confirmModal = document.getElementById("exportConfirmModal");
    if (confirmModal) {
      confirmModal.classList.remove("hidden");
    }
  }, 500);
}

function closeExportConfirmModal(event) {
  if (event && event.target !== event.currentTarget) return;
  
  const modal = document.getElementById("exportConfirmModal");
  if (modal) {
    modal.classList.add("hidden");
  }
}

function confirmClearEdits() {
  const levelId = typeof currentTopik !== "undefined" && currentTopik ? currentTopik : "topik1";
  localStorage.removeItem(`${levelId}_vocab_edits`);
  
  const modal = document.getElementById("exportConfirmModal");
  if (modal) {
    modal.classList.add("hidden");
  }
  
  alert("ลบรายการรอแก้ไขเรียบร้อยแล้ว");
}
