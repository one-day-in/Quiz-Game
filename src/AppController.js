// src/AppController.js
import { AppView } from './views/AppView.js';
import { Disposer } from './utils/disposer.js';
import { showRoundPicker } from './utils/confirm.js';

export function createAppController({
  root,
  gameService,
  playersService,
  modalService,
  roundNavigationService,
  gameId,
  gameName,
  showGameTitle = true,
  onBackToLobby,
  onCellOpen = null,
  isReadOnly = false,
  onCurrentPlayerChange = null,
  allowCurrentPlayerControl = false,
  allowLeaderboardControls = false,
  showLeaderboardQr = true,
  scoreLogs = [],
  onAdjustPlayerScore = null,
  onLeaderboardExpandedChange = null,
  onScoreLogsOpenChange = null,
  onRoundChangeRequest = null,
}) {
  let appViewRef = null; // { el, update } — kept alive across state changes
  const disposer = new Disposer();

  const actions = {
    updateTopic: (roundId, rowId, topic) => {
      if (isReadOnly) return;
      return gameService.updateTopic(roundId, rowId, topic);
    },
    adjustPlayerScore: (playerId, delta) => {
      if (typeof onAdjustPlayerScore === 'function') {
        return onAdjustPlayerScore(playerId, delta);
      }
      if (isReadOnly && !allowLeaderboardControls) return;
      return playersService.adjustPlayerScore(playerId, delta);
    },
    removePlayer: (playerId) => {
      if (isReadOnly && !allowLeaderboardControls) return;
      return playersService.removePlayer(playerId);
    },
    setCurrentPlayer: async (playerId) => {
      if (typeof onCurrentPlayerChange === 'function') {
        return onCurrentPlayerChange(playerId);
      }
      if (isReadOnly && !allowCurrentPlayerControl) return;
      return gameService.setCurrentPlayerId(playerId);
    },
  };

  async function handleRoundClick() {
    const st = roundNavigationService.getState();
    const picked = await showRoundPicker({
      rounds: st.roundNames,
      currentRound: st.activeRoundId,
    });
    if (picked === null) return;
    if (typeof onRoundChangeRequest === 'function') {
      onRoundChangeRequest(picked);
      return;
    }
    roundNavigationService.setActiveRound(picked);
  }

  function buildCellPayload({ roundId, rowId, cellId, value }) {
    const { model } = gameService.getState();
    const cell = model?.getCell(roundId, rowId, cellId);
    if (!cell) return null;

    return {
      roundId,
      rowId,
      cellId,
      value,
      question: { ...(cell.question || {}) },
      answer: { ...(cell.answer || {}) },
      isAnswered: !!cell.isAnswered
    };
  }

  function resolveCellPayload(payload) {
    if (!payload) return null;
    const roundId = Number(payload.roundId);
    const rowId = Number(payload.rowId);
    const cellId = Number(payload.cellId);
    if (!Number.isFinite(roundId) || !Number.isFinite(rowId) || !Number.isFinite(cellId)) {
      return payload;
    }

    const rebuilt = buildCellPayload({
      roundId,
      rowId,
      cellId,
      value: payload.value,
    });

    if (!rebuilt) return payload;
    return rebuilt;
  }

  function openCell(payload, { skipBroadcast = false, resolvePayload = true } = {}) {
    const resolvedPayload = (skipBroadcast || !resolvePayload) ? payload : resolveCellPayload(payload);
    if (!resolvedPayload) return;
    modalService.showQuestionView(resolvedPayload);
    if (!skipBroadcast) {
      onCellOpen?.(resolvedPayload);
    }
  }

  function handleCellClick({ roundId, rowId, cellId, value }) {
    const payload = buildCellPayload({ roundId, rowId, cellId, value });
    if (!payload) return;

    // Controller should reflect the opened cell immediately, but host must
    // persist answered state from ModalService without pre-flipping payload.
    if (isReadOnly) {
      gameService.setCellAnsweredLocal?.(roundId, rowId, cellId, true);
    }

    openCell(payload, { resolvePayload: false });
  }

  function render(state) {
    const { model, uiState, _cellHint } = state || gameService.getState();
    const players = playersService?.getPlayers?.() || [];
    if (!model) return;

    // While modal is open, skip grid re-renders — they'll block the UI thread.
    if (modalService.isOpen()) {
      appViewRef?.updatePlayers?.(players);
      appViewRef?.syncLive?.(model, uiState);
      return;
    }

    if (!appViewRef) {
      appViewRef = AppView({
        model,
        uiState,
        players,
        actions,
        gameId,
        gameName,
        showGameTitle,
        onCellClick: handleCellClick,
        onBackToLobby,
        onRoundClick: handleRoundClick,
        isReadOnly,
        allowCurrentPlayerControl,
        allowLeaderboardControls,
        showLeaderboardQr,
        scoreLogs,
        onLeaderboardExpandedChange,
        onScoreLogsOpenChange,
      });
      root.appendChild(appViewRef.el);
      return;
    }

    appViewRef.setRoundTransition?.(uiState);

    if (uiState?.isRoundTransitioning) {
      return;
    }

    // Targeted single-cell patch — no full grid rebuild
    if (_cellHint) {
      const cell = model.getCell(_cellHint.roundId, _cellHint.rowId, _cellHint.cellId);
      appViewRef.updatePlayers?.(players);
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

  disposer.addSubscription(
    (fn) => playersService.subscribe(fn),
    (players) => appViewRef?.updatePlayers?.(players)
  );

  disposer.add(() => { appViewRef?.el?.remove(); appViewRef = null; });
  disposer.observeRemoval(root, () => modalService?.destroy?.());

  return {
    render,
    openCell: (payload, options) => openCell(payload, options),
    updateScoreLogs: (nextLogs) => appViewRef?.updateScoreLogs?.(nextLogs),
    setLeaderboardExpanded: (expanded, options = {}) => appViewRef?.setLeaderboardExpanded?.(expanded, options),
    setScoreLogsOpen: (isOpen, options = {}) => appViewRef?.setScoreLogsOpen?.(isOpen, options),
    destroy: () => disposer.destroy()
  };
}
