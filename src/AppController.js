// src/AppController.js
import { AppView } from './views/AppView.js';
import { Disposer } from './utils/disposer.js';
import { showRoundPicker } from './utils/confirm.js';

export function createAppController({ root, gameService, modalService, settingsService, gameId, gameName, onBackToLobby, onLogout }) {
  let appViewRef = null; // { el, update } — kept alive across state changes
  const disposer = new Disposer();

  const actions = {
    updateTopic: (roundId, rowId, topic) => gameService.updateTopic(roundId, rowId, topic),
  };

  async function handleRoundClick() {
    const st = settingsService.getState();
    const picked = await showRoundPicker({
      rounds: st.roundNames,
      currentRound: st.activeRoundId,
    });
    if (picked !== null) settingsService.setActiveRound(picked);
  }

  function handleCellClick({ roundId, rowId, cellId, value }) {
    const { model } = gameService.getState();
    const cell = model?.getCell(roundId, rowId, cellId);
    if (!cell) return;

    const payload = {
      roundId,
      rowId,
      cellId,
      value,
      question: { ...(cell.question || {}) },
      answer: { ...(cell.answer || {}) },
      isAnswered: !!cell.isAnswered
    };

    modalService.showQuestionView(payload);
  }

  function render(state) {
    const { model, uiState, _cellHint } = state || gameService.getState();
    if (!model) return;

    // While modal is open, skip grid re-renders — they'll block the UI thread.
    if (modalService.isOpen()) return;

    if (!appViewRef) {
      appViewRef = AppView({
        model,
        uiState,
        actions,
        settingsService,
        gameId,
        gameName,
        onCellClick: handleCellClick,
        onBackToLobby,
        onLogout,
        onRoundClick: handleRoundClick
      });
      root.appendChild(appViewRef.el);
      return;
    }

    // Targeted single-cell patch — no full grid rebuild
    if (_cellHint) {
      const cell = model.getCell(_cellHint.roundId, _cellHint.rowId, _cellHint.cellId);
      appViewRef.patchCell(_cellHint.rowId, _cellHint.cellId, !!cell?.isAnswered);
      return;
    }

    // Full grid update (mode/round/data change)
    appViewRef.update(model, uiState);
  }

  disposer.addSubscription(
    (fn) => gameService.subscribe(fn),
    (state) => render(state)
  );

  disposer.add(() => { appViewRef?.el?.remove(); appViewRef = null; });
  disposer.observeRemoval(root, () => modalService?.destroy?.());

  return {
    render,
    destroy: () => disposer.destroy()
  };
}
