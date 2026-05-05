import { describe, expect, it, vi } from 'vitest';

import { createControllerSyncCoordinator, createHostSyncCoordinator } from './HostControlSyncCoordinator.js';
import { CONTROL_EVENTS } from '../sync/controlEvents.js';

describe('HostControlSyncCoordinator', () => {
  it('sends full host snapshot on host_runtime_state_request', () => {
    const sendControl = vi.fn().mockResolvedValue(true);
    const modalSyncState = {
      getOpenCellPayload: vi.fn().mockReturnValue({ roundId: 1, rowId: 1, cellId: 1, sessionId: 'modal-1' }),
      getViewState: vi.fn().mockReturnValue({ mode: 'view', isAnswerShown: false, sessionId: 'modal-1' }),
      getDirectedBetState: vi.fn().mockReturnValue({ sessionId: 'modal-1' }),
      getPressState: vi.fn().mockReturnValue({ sessionId: 'modal-1', winnerPlayerId: null }),
      getSessionId: vi.fn().mockReturnValue('modal-1'),
      acceptCloseForActiveSession: vi.fn().mockReturnValue(true),
      acceptEventForActiveSession: vi.fn().mockReturnValue(true),
      hydrateFromOpenCell: vi.fn().mockReturnValue(true),
    };

    const coordinator = createHostSyncCoordinator({
      sendControl,
      app: {},
      gameService: {
        getState: () => ({ uiState: { gameMode: 'play' } }),
        getCurrentPlayerId: () => 'player-1',
      },
      modalService: {},
      modalSyncState,
      playersService: {},
      roundNavigationService: {},
      withModalSession: (payload) => ({ ...(payload || {}), sessionId: 'modal-1' }),
      appendScoreLog: vi.fn(),
      mergeScoreLogs: (a, b) => [...(a || []), ...(b || [])],
      getScoreLogs: () => [],
      setScoreLogs: vi.fn(),
      clearAllScoreLogs: vi.fn(),
      makeManualScoreLog: vi.fn(),
      sendRoundState: vi.fn(),
      sendGameSnapshot: vi.fn(),
      sendPlayersSnapshot: vi.fn(),
      markHostControllerActiveFromPing: vi.fn(),
      getLeaderboardPanelExpanded: () => true,
      setLeaderboardPanelExpanded: vi.fn(),
      getScoreLogsOpen: () => false,
      setScoreLogsOpen: vi.fn(),
      setHasRoundStateSynced: vi.fn(),
      stopRoundSyncRetry: vi.fn(),
      onLeaderboardAdjustScore: vi.fn(),
    });

    coordinator.handleMessage({
      type: CONTROL_EVENTS.HOST_RUNTIME_STATE_REQUEST,
      payload: {},
    });

    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.HOST_RUNTIME_STATE, expect.any(Object));
    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.OPEN_CELL, expect.objectContaining({ sessionId: 'modal-1' }));
    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.MODAL_VIEW_STATE, expect.objectContaining({ sessionId: 'modal-1' }));
    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.MODAL_DIRECTED_BET_STATE, expect.objectContaining({ sessionId: 'modal-1' }));
    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.MODAL_PRESS_STATE, expect.objectContaining({ sessionId: 'modal-1' }));
  });
});

describe('ControllerSyncCoordinator', () => {
  it('dedupes repeated open_cell for the same modal session', () => {
    const app = { openCell: vi.fn() };
    const modalSyncState = {
      hydrateFromOpenCell: vi.fn().mockReturnValue(true),
      isDuplicateControllerOpen: vi.fn().mockReturnValueOnce(false).mockReturnValue(true),
      markControllerOpen: vi.fn(),
      acceptCloseForActiveSession: vi.fn().mockReturnValue(true),
      acceptEventForActiveSession: vi.fn().mockReturnValue(true),
      closeSession: vi.fn(),
      setViewState: vi.fn(),
      setDirectedBetState: vi.fn(),
      setPressState: vi.fn(),
    };
    const gameService = {
      setCellAnsweredLocal: vi.fn(),
      setRoundStateLocal: vi.fn(),
      setCurrentPlayerIdLocal: vi.fn(),
      applyRemoteSnapshot: vi.fn(),
      setGameModeLocal: vi.fn(),
    };

    const coordinator = createControllerSyncCoordinator({
      sendControl: vi.fn(),
      app,
      gameService,
      modalService: { setGameMode: vi.fn(), runRemoteCommand: vi.fn() },
      modalSyncState,
      playersService: { setPlayersLocal: vi.fn() },
      markMainHostActiveFromPing: vi.fn(),
      getHasRoundStateSynced: vi.fn().mockReturnValue(false),
      setHasRoundStateSynced: vi.fn(),
      startRoundSyncRetry: vi.fn(),
      stopRoundSyncRetry: vi.fn(),
      setLeaderboardPanelExpanded: vi.fn(),
      setScoreLogsOpen: vi.fn(),
      appendScoreLog: vi.fn(),
      mergeScoreLogs: (a, b) => [...(a || []), ...(b || [])],
      getScoreLogs: () => [],
      setScoreLogs: vi.fn(),
    });

    const payload = { roundId: 1, rowId: 2, cellId: 3, sessionId: 'modal-1', modalMode: 'view' };
    coordinator.handleMessage({ type: CONTROL_EVENTS.OPEN_CELL, payload });
    coordinator.handleMessage({ type: CONTROL_EVENTS.OPEN_CELL, payload });

    expect(modalSyncState.markControllerOpen).toHaveBeenCalledTimes(1);
    expect(gameService.setCellAnsweredLocal).toHaveBeenCalledTimes(1);
    expect(app.openCell).toHaveBeenCalledTimes(1);
  });
});
