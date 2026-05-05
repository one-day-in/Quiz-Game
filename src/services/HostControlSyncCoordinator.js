import { CONTROL_EVENTS } from '../sync/controlEvents.js';

function normalizeMode(mode = 'play') {
  return mode === 'edit' ? 'edit' : 'play';
}

function syncModalStateSnapshot({ sendControl, modalSyncState, withModalSession }) {
  const openCellPayload = modalSyncState.getOpenCellPayload();
  if (openCellPayload) {
    void sendControl(CONTROL_EVENTS.OPEN_CELL, openCellPayload);
    const modalViewState = modalSyncState.getViewState();
    if (modalViewState) {
      void sendControl(CONTROL_EVENTS.MODAL_VIEW_STATE, modalViewState);
    }
    void sendControl(CONTROL_EVENTS.MODAL_DIRECTED_BET_STATE, modalSyncState.getDirectedBetState() || withModalSession({}));
    void sendControl(CONTROL_EVENTS.MODAL_PRESS_STATE, modalSyncState.getPressState() || withModalSession({}));
    return;
  }
  void sendControl(CONTROL_EVENTS.CLOSE_MODAL, { sessionId: modalSyncState.getSessionId() || null });
}

export function createHostSyncCoordinator(options = {}) {
  const {
    sendControl,
    app,
    gameService,
    modalService,
    modalSyncState,
    playersService,
    roundNavigationService,
    withModalSession,
    appendScoreLog,
    mergeScoreLogs,
    getScoreLogs,
    setScoreLogs,
    clearAllScoreLogs,
    makeManualScoreLog,
    sendRoundState,
    sendGameSnapshot,
    sendPlayersSnapshot,
    markHostControllerActiveFromPing,
    getLeaderboardPanelExpanded,
    setLeaderboardPanelExpanded,
    getScoreLogsOpen,
    setScoreLogsOpen,
    setHasRoundStateSynced,
    stopRoundSyncRetry,
    onLeaderboardAdjustScore,
  } = options;

  const isModalControlCommand = (type) => (
    type === CONTROL_EVENTS.MODAL_INCORRECT
    || type === CONTROL_EVENTS.MODAL_CORRECT
    || type === CONTROL_EVENTS.MODAL_MEDIA_CONTROL
    || type === CONTROL_EVENTS.MODAL_TOGGLE_ANSWER
    || type === CONTROL_EVENTS.MODAL_DIRECTED_BET_ACTION
    || type === CONTROL_EVENTS.CLOSE_MODAL
  );

  const handleMessage = (message = {}) => {
    const type = message?.type;
    const payload = message?.payload || {};
    if (!type) return;

    if (type === CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE) {
      markHostControllerActiveFromPing?.(payload?.active !== false);
      return;
    }

    if (type === CONTROL_EVENTS.HOST_RUNTIME_STATE_REQUEST) {
      void sendControl(CONTROL_EVENTS.HOST_RUNTIME_STATE, {
        active: true,
        sentAt: new Date().toISOString(),
      });
      sendRoundState?.();
      sendGameSnapshot?.({ force: true });
      sendPlayersSnapshot?.({ force: true });
      void sendControl(CONTROL_EVENTS.LEADERBOARD_PANEL_STATE, { isExpanded: !!getLeaderboardPanelExpanded?.() });
      void sendControl(CONTROL_EVENTS.SCORE_LOGS_STATE, { isOpen: !!getScoreLogsOpen?.() });
      void sendControl(CONTROL_EVENTS.GAME_MODE_STATE, { gameMode: gameService?.getState?.()?.uiState?.gameMode || 'play' });
      void sendControl(CONTROL_EVENTS.CURRENT_PLAYER_STATE, { playerId: gameService?.getCurrentPlayerId?.() ?? null });
      syncModalStateSnapshot({ sendControl, modalSyncState, withModalSession });
      return;
    }

    if (type === CONTROL_EVENTS.GAME_SNAPSHOT_REQUEST) {
      sendGameSnapshot?.({ force: true });
      return;
    }

    if (type === CONTROL_EVENTS.PLAYERS_SNAPSHOT_REQUEST) {
      sendPlayersSnapshot?.({ force: true });
      return;
    }

    if (type === CONTROL_EVENTS.GAME_MODE_SET) {
      const nextMode = normalizeMode(payload?.gameMode);
      gameService?.setGameMode?.(nextMode);
      modalService?.setGameMode?.(nextMode);
      void sendControl(CONTROL_EVENTS.GAME_MODE_STATE, { gameMode: nextMode });
      return;
    }

    if (type === CONTROL_EVENTS.GAME_MODE_STATE) {
      const nextMode = normalizeMode(payload?.gameMode);
      gameService?.setGameModeLocal?.(nextMode);
      modalService?.setGameMode?.(nextMode);
      return;
    }

    if (type === CONTROL_EVENTS.GAME_MODE_SYNC_REQUEST) {
      void sendControl(CONTROL_EVENTS.GAME_MODE_STATE, { gameMode: gameService?.getState?.()?.uiState?.gameMode || 'play' });
      return;
    }

    if (type === CONTROL_EVENTS.OPEN_CELL) {
      const hydrated = modalSyncState?.hydrateFromOpenCell?.(payload);
      if (!hydrated) return;
      app?.openCell?.(payload, { skipBroadcast: true, modalMode: payload?.modalMode || 'view' });
      return;
    }

    if (type === CONTROL_EVENTS.MODAL_SYNC_REQUEST) {
      syncModalStateSnapshot({ sendControl, modalSyncState, withModalSession });
      return;
    }

    if (type === CONTROL_EVENTS.LEADERBOARD_PANEL_STATE) {
      setLeaderboardPanelExpanded?.(!!payload?.isExpanded);
      app?.setLeaderboardExpanded?.(!!payload?.isExpanded, { silent: true });
      return;
    }

    if (type === CONTROL_EVENTS.LEADERBOARD_PANEL_SYNC_REQUEST) {
      void sendControl(CONTROL_EVENTS.LEADERBOARD_PANEL_STATE, { isExpanded: !!getLeaderboardPanelExpanded?.() });
      return;
    }

    if (type === CONTROL_EVENTS.SCORE_LOG_APPEND) {
      appendScoreLog?.(payload, { broadcast: false });
      return;
    }

    if (type === CONTROL_EVENTS.SCORE_LOG_SNAPSHOT) {
      setScoreLogs?.(mergeScoreLogs?.(payload?.logs || [], getScoreLogs?.() || []));
      return;
    }

    if (type === CONTROL_EVENTS.SCORE_LOG_SYNC_REQUEST) {
      void sendControl(CONTROL_EVENTS.SCORE_LOG_SNAPSHOT, { logs: getScoreLogs?.() || [] });
      return;
    }

    if (type === CONTROL_EVENTS.SCORE_LOGS_STATE) {
      setScoreLogsOpen?.(!!payload?.isOpen);
      app?.setScoreLogsOpen?.(!!payload?.isOpen, { silent: true });
      return;
    }

    if (type === CONTROL_EVENTS.SCORE_LOGS_SYNC_REQUEST) {
      void sendControl(CONTROL_EVENTS.SCORE_LOGS_STATE, { isOpen: !!getScoreLogsOpen?.() });
      return;
    }

    if (type === CONTROL_EVENTS.SCORE_LOGS_CLEAR_REQUEST) {
      void clearAllScoreLogs?.().catch((error) => {
        console.warn('[HostSyncCoordinator] score logs clear skipped:', error?.message || error);
      });
      return;
    }

    if (type === CONTROL_EVENTS.CURRENT_PLAYER_SET) {
      void gameService?.setCurrentPlayerId?.(payload?.playerId || null).then(() => {
        void sendControl(CONTROL_EVENTS.CURRENT_PLAYER_STATE, { playerId: payload?.playerId || null });
      });
      return;
    }

    if (type === CONTROL_EVENTS.CURRENT_PLAYER_SYNC_REQUEST) {
      void sendControl(CONTROL_EVENTS.CURRENT_PLAYER_STATE, { playerId: gameService?.getCurrentPlayerId?.() ?? null });
      return;
    }

    if (type === CONTROL_EVENTS.ROUND_SET) {
      void roundNavigationService?.setActiveRound?.(payload?.roundId);
      return;
    }

    if (type === CONTROL_EVENTS.ROUND_STATE) {
      gameService?.setRoundStateLocal?.(payload || {});
      setHasRoundStateSynced?.(true);
      stopRoundSyncRetry?.();
      return;
    }

    if (type === CONTROL_EVENTS.ROUND_SYNC_REQUEST) {
      sendRoundState?.();
      return;
    }

    if (type === CONTROL_EVENTS.LEADERBOARD_ADJUST_SCORE) {
      onLeaderboardAdjustScore?.(payload, { makeManualScoreLog });
      return;
    }

    if (type === CONTROL_EVENTS.CURRENT_PLAYER_STATE) {
      gameService?.setCurrentPlayerIdLocal?.(payload?.playerId || null);
      return;
    }

    if (!isModalControlCommand(type)) return;

    if (type === CONTROL_EVENTS.CLOSE_MODAL) {
      if (!modalSyncState?.acceptCloseForActiveSession?.(payload)) return;
    } else if (!modalSyncState?.acceptEventForActiveSession?.(payload)) {
      return;
    }

    const result = modalService?.runRemoteCommand?.(type, payload);
    if (type === CONTROL_EVENTS.MODAL_MEDIA_CONTROL) {
      void Promise.resolve(result).then((state) => {
        if (!state) return;
        void sendControl(CONTROL_EVENTS.MODAL_MEDIA_STATE, withModalSession(state));
      });
    }
  };

  return { handleMessage };
}

export function createControllerSyncCoordinator(options = {}) {
  const {
    sendControl,
    app,
    gameService,
    modalService,
    modalSyncState,
    playersService,
    markMainHostActiveFromPing,
    getHasRoundStateSynced,
    setHasRoundStateSynced,
    startRoundSyncRetry,
    stopRoundSyncRetry,
    setLeaderboardPanelExpanded,
    setScoreLogsOpen,
    appendScoreLog,
    mergeScoreLogs,
    getScoreLogs,
    setScoreLogs,
  } = options;

  const handleMessage = (message = {}) => {
    const type = message?.type;
    const payload = message?.payload || {};
    if (!type) return;

    if (type === CONTROL_EVENTS.HOST_RUNTIME_STATE) {
      markMainHostActiveFromPing?.(payload?.active !== false);
      if (payload?.active === false) {
        setHasRoundStateSynced?.(false);
        stopRoundSyncRetry?.();
      } else if (!getHasRoundStateSynced?.()) {
        startRoundSyncRetry?.();
      }
      return;
    }

    if (type === CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE_REQUEST) {
      void sendControl(CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE, {
        active: true,
        sentAt: new Date().toISOString(),
      });
      return;
    }

    if (type === CONTROL_EVENTS.GAME_SNAPSHOT) {
      if (payload?.game) {
        gameService?.applyRemoteSnapshot?.(payload.game);
      }
      if (payload?.uiState) {
        gameService?.setRoundStateLocal?.(payload.uiState);
      }
      setHasRoundStateSynced?.(true);
      stopRoundSyncRetry?.();
      return;
    }

    if (type === CONTROL_EVENTS.PLAYERS_SNAPSHOT) {
      playersService?.setPlayersLocal?.(payload?.players || []);
      return;
    }

    if (type === CONTROL_EVENTS.GAME_MODE_STATE) {
      const nextMode = normalizeMode(payload?.gameMode);
      gameService?.setGameModeLocal?.(nextMode);
      modalService?.setGameMode?.(nextMode);
      return;
    }

    if (type === CONTROL_EVENTS.OPEN_CELL) {
      const hydrated = modalSyncState?.hydrateFromOpenCell?.(payload);
      if (!hydrated) return;
      if (modalSyncState?.isDuplicateControllerOpen?.(payload)) {
        return;
      }
      modalSyncState?.markControllerOpen?.(payload);
      const roundId = Number(payload?.roundId);
      const rowId = Number(payload?.rowId);
      const cellId = Number(payload?.cellId);
      if (Number.isFinite(roundId) && Number.isFinite(rowId) && Number.isFinite(cellId)) {
        gameService?.setCellAnsweredLocal?.(roundId, rowId, cellId, true);
      }
      app?.openCell?.(payload, { skipBroadcast: true, modalMode: payload?.modalMode || 'view' });
      return;
    }

    if (type === CONTROL_EVENTS.LEADERBOARD_PANEL_STATE) {
      setLeaderboardPanelExpanded?.(!!payload?.isExpanded);
      app?.setLeaderboardExpanded?.(!!payload?.isExpanded, { silent: true });
      return;
    }

    if (type === CONTROL_EVENTS.SCORE_LOG_APPEND) {
      appendScoreLog?.(payload, { broadcast: false });
      return;
    }

    if (type === CONTROL_EVENTS.SCORE_LOG_SNAPSHOT) {
      setScoreLogs?.(mergeScoreLogs?.(payload?.logs || [], getScoreLogs?.() || []));
      return;
    }

    if (type === CONTROL_EVENTS.SCORE_LOGS_STATE) {
      setScoreLogsOpen?.(!!payload?.isOpen);
      app?.setScoreLogsOpen?.(!!payload?.isOpen, { silent: true });
      return;
    }

    if (type === CONTROL_EVENTS.CURRENT_PLAYER_STATE) {
      gameService?.setCurrentPlayerIdLocal?.(payload?.playerId || null);
      return;
    }

    if (type === CONTROL_EVENTS.ROUND_STATE) {
      gameService?.setRoundStateLocal?.(payload || {});
      setHasRoundStateSynced?.(true);
      stopRoundSyncRetry?.();
      return;
    }

    if (
      type === CONTROL_EVENTS.MODAL_VIEW_STATE
      || type === CONTROL_EVENTS.MODAL_MEDIA_STATE
      || type === CONTROL_EVENTS.MODAL_DIRECTED_BET_STATE
      || type === CONTROL_EVENTS.MODAL_PRESS_STATE
      || type === CONTROL_EVENTS.CLOSE_MODAL
    ) {
      if (type === CONTROL_EVENTS.CLOSE_MODAL) {
        if (!modalSyncState?.acceptCloseForActiveSession?.(payload)) return;
        modalSyncState?.closeSession?.();
        modalService?.runRemoteCommand?.(type, payload);
        return;
      }

      if (!modalSyncState?.acceptEventForActiveSession?.(payload)) return;
      if (type === CONTROL_EVENTS.MODAL_VIEW_STATE) {
        modalSyncState?.setViewState?.(payload);
      } else if (type === CONTROL_EVENTS.MODAL_DIRECTED_BET_STATE) {
        modalSyncState?.setDirectedBetState?.(payload);
      } else if (type === CONTROL_EVENTS.MODAL_PRESS_STATE) {
        modalSyncState?.setPressState?.(payload);
      }
      modalService?.runRemoteCommand?.(type, payload);
    }
  };

  return { handleMessage };
}
