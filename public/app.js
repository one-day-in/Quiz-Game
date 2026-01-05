document.addEventListener("DOMContentLoaded", () => {
  /* =====================
     MODE STATE
  ===================== */
  const KEY_MODE = "quiz_mode";
  let MODE = localStorage.getItem(KEY_MODE) || "game";

  const settingsBtn = document.querySelector(".settings-btn");
  const resetBtn = document.querySelector(".reset-btn");

  function applyMode() {
    document.body.classList.toggle("mode-game", MODE === "game");
    document.body.classList.toggle("mode-edit", MODE === "edit");

    if (settingsBtn) {
      settingsBtn.textContent = MODE === "game" ? "⚙️ Настройки" : "▶️ Играть";
    }
    if (resetBtn) {
      resetBtn.style.display = MODE === "edit" ? "inline-flex" : "none";
    }
  }

  function setMode(next) {
    if (!["game", "edit"].includes(next)) return;
    MODE = next;
    localStorage.setItem(KEY_MODE, MODE);
    applyMode();
  }

  applyMode();
  settingsBtn?.addEventListener("click", () => {
    setMode(MODE === "game" ? "edit" : "game");
  });

  /* =====================
     DATA STORAGE
  ===================== */
  const KEY_CELLS = "quiz_cells";

  function loadCells() {
    try {
      return JSON.parse(localStorage.getItem(KEY_CELLS)) || {};
    } catch {
      return {};
    }
  }

  function saveCells(data) {
    localStorage.setItem(KEY_CELLS, JSON.stringify(data));
  }

  let cellsData = loadCells();

  function cellKey(cell) {
    return `${cell.dataset.row}-${cell.dataset.col}`;
  }

  function ensureCellData(cell) {
    const key = cellKey(cell);
    if (!cellsData[key]) {
      cellsData[key] = { question: "", answer: "", media: null, played: false };
    }
    // defensive
    if (typeof cellsData[key].played !== "boolean") cellsData[key].played = false;
    return cellsData[key];
  }

  function syncPlayedClassesFromStorage() {
    document.querySelectorAll(".cell.slot").forEach((cell) => {
      const key = cellKey(cell);
      cell.classList.toggle("played", !!cellsData[key]?.played);
    });
  }

  /* =====================
     MEDIA HELPERS
  ===================== */
  async function uploadMedia(file) {
    const formData = new FormData();
    formData.append("file", file);

    const res = await fetch("/upload", { method: "POST", body: formData });
    if (!res.ok) throw new Error("Upload failed");
    return res.json(); // { path: "media/xxx.ext" }
  }

  function renderMedia(container, path) {
    if (!container) return;
    container.innerHTML = "";
    if (!path) return;

    if (/\.(jpg|jpeg|png|gif|webp)$/i.test(path)) {
      container.innerHTML = `<img src="${path}" alt="" style="max-width:100%;max-height:100%;object-fit:contain;">`;
    } else if (/\.(mp3|wav|ogg)$/i.test(path)) {
      container.innerHTML = `<audio controls src="${path}" style="width:100%"></audio>`;
    } else if (/\.(mp4|webm)$/i.test(path)) {
      container.innerHTML = `<video controls src="${path}" style="max-width:100%;max-height:100%;object-fit:contain;"></video>`;
    } else {
      // fallback
      container.innerHTML = `<a href="${path}" target="_blank" rel="noreferrer">Open media</a>`;
    }
  }

  /* =====================
     RESET
  ===================== */
  async function resetGame() {
    if (MODE !== "edit") return;
    if (!confirm("⚠️ Ви впевнені?\nУсі дані будуть видалені.")) return;

    localStorage.removeItem(KEY_CELLS);
    cellsData = {};

    // clear played visuals
    document.querySelectorAll(".cell.slot").forEach((cell) => {
      cell.classList.remove("played");
    });

    // reset topics text
    document.querySelectorAll(".cell.topic").forEach((cell, i) => {
      cell.textContent = `Тема ${i + 1}`;
      cell.removeAttribute("contenteditable");
    });

    // try clear media folder on server
    try {
      if (resetBtn) resetBtn.disabled = true;
      await fetch("/reset-media", { method: "POST" });
      alert("✅ Гра скинута");
    } catch {
      alert("⚠️ Дані гри скинуті, але файли не вдалося видалити");
    } finally {
      if (resetBtn) resetBtn.disabled = false;
    }
  }

  resetBtn?.addEventListener("click", resetGame);

  /* =====================
     GAME MODAL (STABLE STATE)
  ===================== */
  const gameModal = document.getElementById("gameModal");
  const gameCloseBtn = document.getElementById("gameCloseBtn");
  const gameBackdrop = gameModal?.querySelector(".modal__backdrop");

  const gameMeta = document.getElementById("gameMeta");
  const gameMedia = document.getElementById("gameMedia");
  const questionText = document.getElementById("questionText");
  const toggleAnswerBtn = document.getElementById("toggleAnswerBtn");
  const answerText = document.getElementById("answerText");
  const togglePlayedBtn = document.getElementById("togglePlayedBtn");
  const gameEmptyState = document.getElementById("gameEmptyState"); // може бути null

  const gameState = {
    cell: null,
    answerVisible: false,
  };

  function show(el) {
    if (!el) return;
    el.classList.remove("hidden");
  }
  function hide(el) {
    if (!el) return;
    el.classList.add("hidden");
  }

  function openGameModal(cell) {
    if (!gameModal) return;

    const data = ensureCellData(cell);
    gameState.cell = cell;
    gameState.answerVisible = false;

    const rowIndex = Number(cell.dataset.row);
    const topicCell = document.querySelectorAll(".board-left .cell.topic")[rowIndex];
    const topicTitle = topicCell?.textContent?.trim() || `Тема ${rowIndex + 1}`;

    if (gameMeta) gameMeta.textContent = `${topicTitle} • ${cell.textContent}`;

    const hasContent = !!(data.question || data.answer || data.media);

    // Reset base UI (avoid leftovers)
    if (gameMedia) gameMedia.innerHTML = "";
    if (questionText) questionText.textContent = "";
    if (answerText) answerText.textContent = "";
    hide(answerText);
    if (toggleAnswerBtn) toggleAnswerBtn.textContent = "Показать ответ";

    if (!hasContent) {
      // EMPTY STATE
      show(gameEmptyState);

      hide(gameMedia);
      hide(questionText);
      hide(toggleAnswerBtn);
      hide(answerText);
      hide(togglePlayedBtn);
    } else {
      // CONTENT STATE
      hide(gameEmptyState);

      // media
      if (data.media) {
        show(gameMedia);
        renderMedia(gameMedia, data.media);
      } else {
        hide(gameMedia);
        if (gameMedia) gameMedia.innerHTML = "";
      }

      // question
      if (data.question) {
        show(questionText);
        questionText.textContent = data.question;
      } else {
        hide(questionText);
        if (questionText) questionText.textContent = "";
      }

      // answer button is visible whenever there is any content (even if answer empty -> placeholder)
      show(toggleAnswerBtn);
      if (answerText) {
        answerText.textContent = data.answer || "Відповідь ще не задана";
        hide(answerText);
      }
      if (toggleAnswerBtn) toggleAnswerBtn.textContent = "Показать ответ";

      // played button visible in content state
      show(togglePlayedBtn);
      if (togglePlayedBtn) {
        togglePlayedBtn.textContent = data.played
          ? "Снять отметку «сыграно»"
          : "Отметить как сыгранную";
      }
    }

    gameModal.classList.add("show");
    gameCloseBtn?.focus();
  }

  function closeGameModal() {
    if (!gameModal) return;

    // remove focus first to avoid aria warnings
    document.activeElement?.blur();

    gameModal.classList.remove("show");

    // reset state
    gameState.cell = null;
    gameState.answerVisible = false;

    // reset UI bits
    hide(answerText);
    if (toggleAnswerBtn) toggleAnswerBtn.textContent = "Показать ответ";
  }

  toggleAnswerBtn?.addEventListener("click", () => {
    if (!gameState.cell) return; // modal not open

    gameState.answerVisible = !gameState.answerVisible;
    if (answerText) {
      answerText.classList.toggle("hidden", !gameState.answerVisible);
    }
    if (toggleAnswerBtn) {
      toggleAnswerBtn.textContent = gameState.answerVisible ? "Скрыть ответ" : "Показать ответ";
    }
  });

  togglePlayedBtn?.addEventListener("click", () => {
    if (!gameState.cell) return;

    const data = ensureCellData(gameState.cell);
    data.played = !data.played;
    saveCells(cellsData);

    gameState.cell.classList.toggle("played", data.played);

    // optional: update button text before close (не обов'язково)
    if (togglePlayedBtn) {
      togglePlayedBtn.textContent = data.played
        ? "Снять отметку «сыграно»"
        : "Отметить как сыгранную";
    }

    closeGameModal();
  });

  gameCloseBtn?.addEventListener("click", closeGameModal);
  gameBackdrop?.addEventListener("click", closeGameModal);

  /* =====================
     EDIT MODAL
  ===================== */
  const editModal = document.getElementById("editModal");
  const editCloseBtn = document.getElementById("editCloseBtn");
  const editBackBtn = document.getElementById("editBackBtn");
  const editBackdrop = editModal?.querySelector(".modal__backdrop");

  const qInput = document.getElementById("qInput");
  const aInput = document.getElementById("aInput");
  const saveCellBtn = document.getElementById("saveCellBtn");
  const editMeta = document.getElementById("editMeta");

  const mediaInput = document.getElementById("mediaInput"); // hidden input
  const chooseFileBtn = document.getElementById("chooseFileBtn");
  const fileName = document.getElementById("fileName");

  const mediaPreview = document.getElementById("mediaPreview");
  const mediaBlock = document.getElementById("mediaBlock");
  const deleteMediaBtn = document.getElementById("deleteMediaBtn");

  let activeSlot = null;

  function updateMediaUI(hasMedia) {
    if (mediaBlock) mediaBlock.style.display = hasMedia ? "none" : "block";
    if (deleteMediaBtn) deleteMediaBtn.style.display = hasMedia ? "inline-flex" : "none";
  }

  function openEditModal(cell) {
    if (!editModal) return;

    activeSlot = cell;
    const data = ensureCellData(cell);

    if (qInput) qInput.value = data.question || "";
    if (aInput) aInput.value = data.answer || "";

    if (mediaInput) mediaInput.value = "";
    if (fileName) fileName.textContent = "";

    const rowIndex = Number(cell.dataset.row);
    const topicCell = document.querySelectorAll(".board-left .cell.topic")[rowIndex];
    const topicTitle = topicCell?.textContent?.trim() || `Тема ${rowIndex + 1}`;
    if (editMeta) editMeta.textContent = `${topicTitle} • ${cell.textContent}`;

    updateMediaUI(!!data.media);
    renderMedia(mediaPreview, data.media);

    editModal.classList.add("show");
    qInput?.focus();
  }

  function closeEditModal() {
    if (!editModal) return;
    document.activeElement?.blur();
    editModal.classList.remove("show");
    activeSlot = null;
  }

  chooseFileBtn?.addEventListener("click", () => {
    mediaInput?.click();
  });

  mediaInput?.addEventListener("change", () => {
    if (!fileName) return;
    if (mediaInput.files && mediaInput.files.length) {
      fileName.textContent = mediaInput.files[0].name;
    } else {
      fileName.textContent = "";
    }
  });

  saveCellBtn?.addEventListener("click", async () => {
    if (!activeSlot) return;

    const data = ensureCellData(activeSlot);
    data.question = (qInput?.value || "").trim();
    data.answer = (aInput?.value || "").trim();

    try {
      if (mediaInput?.files?.[0]) {
        const result = await uploadMedia(mediaInput.files[0]);
        data.media = result.path;

        // UI immediately
        updateMediaUI(true);
        renderMedia(mediaPreview, data.media);

        if (mediaInput) mediaInput.value = "";
        if (fileName) fileName.textContent = "";
      }
    } catch {
      alert("❌ Помилка завантаження файлу");
    }

    saveCells(cellsData);
    closeEditModal();
  });

  deleteMediaBtn?.addEventListener("click", () => {
    if (!activeSlot) return;
    if (!confirm("Удалить медиа из этой ячейки?")) return;

    const data = ensureCellData(activeSlot);
    data.media = null;
    saveCells(cellsData);

    renderMedia(mediaPreview, null);
    updateMediaUI(false);

    if (mediaInput) mediaInput.value = "";
    if (fileName) fileName.textContent = "";
  });

  editCloseBtn?.addEventListener("click", closeEditModal);
  editBackBtn?.addEventListener("click", closeEditModal);
  editBackdrop?.addEventListener("click", closeEditModal);

  /* =====================
     ESC
  ===================== */
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (gameModal?.classList.contains("show")) closeGameModal();
    if (editModal?.classList.contains("show")) closeEditModal();
  });

  /* =====================
     GLOBAL CLICKS
  ===================== */
  document.addEventListener("click", (e) => {
    // don't handle board clicks when modal open
    if (gameModal?.classList.contains("show") || editModal?.classList.contains("show")) return;

    const cell = e.target.closest(".cell");
    if (!cell) return;

    if (MODE === "game") {
      if (cell.classList.contains("slot")) openGameModal(cell);
      return;
    }

    // EDIT mode
    if (cell.classList.contains("topic")) {
      document.querySelectorAll(".cell.topic[contenteditable]").forEach((el) => {
        el.removeAttribute("contenteditable");
      });
      cell.setAttribute("contenteditable", "true");
      cell.focus();
      return;
    }

    if (cell.classList.contains("slot")) {
      openEditModal(cell);
    }
  });

  // initial paint
  syncPlayedClassesFromStorage();
});
