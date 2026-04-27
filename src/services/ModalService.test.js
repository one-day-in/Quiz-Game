/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  adjustPlayerScoreMock,
  resolveGamePressMock,
  updatePlayerMock,
} = vi.hoisted(() => ({
  adjustPlayerScoreMock: vi.fn(),
  resolveGamePressMock: vi.fn(),
  updatePlayerMock: vi.fn(),
}));

vi.mock('../api/gameApi.js', () => ({
  adjustPlayerScore: adjustPlayerScoreMock,
  resolveGamePress: resolveGamePressMock,
}));

vi.mock('../api/playersApi.js', () => ({
  updatePlayer: updatePlayerMock,
}));

import { ModalService } from './ModalService.js';
import { CELL_MODIFIERS } from '../constants/cellModifiers.js';

describe('ModalService press reset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resolveGamePressMock.mockResolvedValue({
      gameId: 'game-1',
      winnerPlayerId: null,
      pressEnabled: true,
      pressedAt: null,
    });
    updatePlayerMock.mockResolvedValue({});
    vi.stubGlobal('alert', vi.fn());
  });

  it('enables press immediately after reset', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const pressRuntime = {
      openPress: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ModalService(gameService, {}, pressRuntime);
    service.view = { updateWinnerName: vi.fn() };

    await service._resetPressRuntime();

    expect(pressRuntime.openPress).toHaveBeenCalledTimes(1);
  });

  it('subtracts score and resets press on incorrect answer', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const service = new ModalService(gameService, {});
    service._pressWinnerId = 'player-1';
    service._cellValue = 300;
    service._resetPressRuntime = vi.fn().mockResolvedValue(undefined);

    await service._handleIncorrect();

    expect(resolveGamePressMock).toHaveBeenCalledWith('game-1', 'player-1', { pressEnabled: true });
    expect(adjustPlayerScoreMock).toHaveBeenCalledWith('game-1', 'player-1', -300);
    expect(service._resetPressRuntime).toHaveBeenCalledTimes(1);
  });

  it('starts a 30-second countdown for the winner and auto-marks incorrect on timeout', async () => {
    let runtimeHandler = null;
    const gameService = {
      getGameId: () => 'game-1',
    };
    const pressRuntime = {
      subscribe: vi.fn((handler) => {
        runtimeHandler = handler;
        return vi.fn();
      }),
    };
    const service = new ModalService(gameService, {}, pressRuntime);
    service.view = {
      updateWinnerName: vi.fn(),
      updatePressTimer: vi.fn(),
    };
    service._cellValue = 300;
    service._resetPressRuntime = vi.fn().mockResolvedValue(undefined);

    service._bindPressRuntime();
    runtimeHandler?.({ winnerPlayerId: 'player-1', winnerName: 'Maria' });
    await vi.advanceTimersByTimeAsync(30000);

    expect(service.view.updatePressTimer).toHaveBeenCalledWith(30);
    expect(adjustPlayerScoreMock).toHaveBeenCalledWith('game-1', 'player-1', -300);
    expect(service._resetPressRuntime).toHaveBeenCalledTimes(1);
  });

  it('pauses the countdown in answer view and resumes from the same point when returning', async () => {
    let runtimeHandler = null;
    const gameService = {
      getGameId: () => 'game-1',
    };
    const pressRuntime = {
      subscribe: vi.fn((handler) => {
        runtimeHandler = handler;
        return vi.fn();
      }),
    };
    const service = new ModalService(gameService, {}, pressRuntime);
    service.view = {
      updateWinnerName: vi.fn(),
      updatePressTimer: vi.fn(),
    };
    service._cellValue = 300;

    service._bindPressRuntime();
    runtimeHandler?.({ winnerPlayerId: 'player-1', winnerName: 'Maria' });
    await vi.advanceTimersByTimeAsync(12000);
    service._pausePressCountdown();
    await vi.advanceTimersByTimeAsync(30000);

    expect(adjustPlayerScoreMock).not.toHaveBeenCalled();

    service._resumePressCountdown();
    await vi.advanceTimersByTimeAsync(18000);

    expect(adjustPlayerScoreMock).toHaveBeenCalledWith('game-1', 'player-1', -300);
  });

  it('ignores stale winner updates while press reset is in flight', () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const service = new ModalService(gameService, {}, {});
    service.view = {
      updateWinnerName: vi.fn(),
      updatePressTimer: vi.fn(),
    };

    service._setPressWinner('player-1', 'Maria');
    service._isResettingPressRuntime = true;

    service._handlePressRuntimeUpdate({ winnerPlayerId: 'player-1', winnerName: 'Maria' });

    expect(service.view.updateWinnerName).toHaveBeenCalledTimes(1);
    expect(service._pressWinnerId).toBe('player-1');

    service._handlePressRuntimeUpdate({ winnerPlayerId: null, winnerName: '' });

    expect(service._pressWinnerId).toBe(null);
    expect(service._isResettingPressRuntime).toBe(false);
  });

  it('adds score and closes modal on correct answer', async () => {
    const gameService = {
      getGameId: () => 'game-1',
      setCurrentPlayerId: vi.fn().mockResolvedValue(true),
    };
    const service = new ModalService(gameService, {});
    service._pressWinnerId = 'player-2';
    service._cellValue = 500;
    service.close = vi.fn();

    await service._handleCorrect();

    expect(resolveGamePressMock).toHaveBeenCalledWith('game-1', 'player-2', { pressEnabled: false });
    expect(adjustPlayerScoreMock).toHaveBeenCalledWith('game-1', 'player-2', 500);
    expect(gameService.setCurrentPlayerId).toHaveBeenCalledWith('player-2');
    expect(service.close).toHaveBeenCalledTimes(1);
  });

  it('ignores duplicate incorrect resolution when lock is already taken by another host window', async () => {
    resolveGamePressMock.mockRejectedValue(new Error('[Game] resolveGamePress failed: Press already resolved'));
    const gameService = {
      getGameId: () => 'game-1',
    };
    const service = new ModalService(gameService, {});
    service._pressWinnerId = 'player-1';
    service._cellValue = 300;
    service._resetPressRuntime = vi.fn().mockResolvedValue(undefined);

    await service._handleIncorrect();

    expect(adjustPlayerScoreMock).not.toHaveBeenCalled();
    expect(service._resetPressRuntime).not.toHaveBeenCalled();
  });

  it('applies flip-score modifier to the current active player and keeps the banner visible before closing', async () => {
    const playersService = {
      getPlayers: () => [{ id: 'player-9', points: 400 }],
    };
    const service = new ModalService({
      getGameId: () => 'game-1',
      getCurrentPlayerId: () => 'player-9',
    }, {}, {}, playersService);
    service._activeModifier = CELL_MODIFIERS.FLIP_SCORE;
    service.close = vi.fn();

    await service._applyActiveModifierToCurrentPlayer();

    expect(updatePlayerMock).toHaveBeenCalledWith('game-1', 'player-9', { points: -400 });
    expect(updatePlayerMock).toHaveBeenCalledTimes(1);
    expect(service.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(service.close).toHaveBeenCalledTimes(1);
  });

  it('flips negative and zero scores without adding the cell value', async () => {
    const playersService = {
      getPlayers: () => [
        { id: 'negative-player', points: -250 },
        { id: 'zero-player', points: 0 },
      ],
    };
    const service = new ModalService({ getGameId: () => 'game-1' }, {}, {}, playersService);
    service._cellValue = 500;

    await service._applyFlipScoreModifier('negative-player');
    await service._applyFlipScoreModifier('zero-player');

    expect(updatePlayerMock).toHaveBeenNthCalledWith(1, 'game-1', 'negative-player', { points: 250 });
    expect(updatePlayerMock).toHaveBeenNthCalledWith(2, 'game-1', 'zero-player', { points: -0 });
  });

  it('does not update score when the selected modifier player is missing', async () => {
    const playersService = {
      getPlayers: () => [{ id: 'player-1', points: 100 }],
    };
    const service = new ModalService({ getGameId: () => 'game-1' }, {}, {}, playersService);

    const applied = await service._applyFlipScoreModifier('missing-player');

    expect(applied).toBe(false);
    expect(updatePlayerMock).not.toHaveBeenCalled();
  });

  it('defers plus-to-minus activation when active player is not selected', async () => {
    const service = new ModalService({
      getGameId: () => 'game-1',
      getCurrentPlayerId: () => null,
    }, {}, {}, { getPlayers: () => [] });
    service._activeModifier = CELL_MODIFIERS.FLIP_SCORE;
    service.close = vi.fn();

    const applied = await service._applyActiveModifierToCurrentPlayer();

    expect(applied).toBe(false);
    expect(globalThis.alert).not.toHaveBeenCalled();
    expect(service.close).not.toHaveBeenCalled();
  });

  it('can close the modifier banner early via acknowledge callback', async () => {
    const playersService = {
      getPlayers: () => [{ id: 'player-9', points: 400 }],
    };
    const service = new ModalService({
      getGameId: () => 'game-1',
      getCurrentPlayerId: () => 'player-9',
    }, {}, {}, playersService);
    service._activeModifier = CELL_MODIFIERS.FLIP_SCORE;
    service.close = vi.fn();

    await service._applyActiveModifierToCurrentPlayer();
    expect(service.close).not.toHaveBeenCalled();

    service.close();

    expect(service.close).toHaveBeenCalledTimes(1);
  });

  it('steals 1000 points from the leader when chooser is not leading', async () => {
    const playersService = {
      getPlayers: () => [
        { id: 'chooser', points: 500 },
        { id: 'leader', points: 1400 },
        { id: 'other', points: 300 },
      ],
    };
    const service = new ModalService({
      getGameId: () => 'game-1',
      getCurrentPlayerId: () => 'chooser',
    }, {}, {}, playersService);
    service._activeModifier = CELL_MODIFIERS.STEAL_LEADER_POINTS;
    service.close = vi.fn();

    const applied = await service._applyActiveModifierToCurrentPlayer();

    expect(applied).toBe(true);
    expect(updatePlayerMock).toHaveBeenCalledWith('game-1', 'chooser', { points: 1500 });
    expect(updatePlayerMock).toHaveBeenCalledWith('game-1', 'leader', { points: 400 });
    expect(service.close).not.toHaveBeenCalled();
  });

  it('gives 1000 points to the lowest player when chooser already leads', async () => {
    const playersService = {
      getPlayers: () => [
        { id: 'chooser', points: 1800 },
        { id: 'leader-2', points: 1400 },
        { id: 'lowest', points: -200 },
      ],
    };
    const service = new ModalService({
      getGameId: () => 'game-1',
      getCurrentPlayerId: () => 'chooser',
    }, {}, {}, playersService);
    service._activeModifier = CELL_MODIFIERS.STEAL_LEADER_POINTS;

    const applied = await service._applyActiveModifierToCurrentPlayer();

    expect(applied).toBe(true);
    expect(updatePlayerMock).toHaveBeenCalledWith('game-1', 'chooser', { points: 800 });
    expect(updatePlayerMock).toHaveBeenCalledWith('game-1', 'lowest', { points: 800 });
  });

  it('does not auto-apply cell modifier when players are not added yet', () => {
    const service = new ModalService({ getGameId: () => 'game-1' }, {}, {}, { getPlayers: () => [] });

    expect(service._shouldAutoApplyModifier(CELL_MODIFIERS.FLIP_SCORE)).toBe(false);
    expect(service._shouldAutoApplyModifier(CELL_MODIFIERS.STEAL_LEADER_POINTS)).toBe(false);
  });

  it('auto-applies modifier when at least one player exists', () => {
    const service = new ModalService(
      {
        getGameId: () => 'game-1',
        getCurrentPlayerId: () => 'player-1',
      },
      {},
      {},
      { getPlayers: () => [{ id: 'player-1', points: 100 }] }
    );

    expect(service._shouldAutoApplyModifier(CELL_MODIFIERS.FLIP_SCORE)).toBe(true);
  });

  it('keeps selected modifier visible in modal when there are no players yet', () => {
    const mediaService = {
      toViewMedia: (value) => value,
      toViewAudioFiles: (files) => files || [],
    };
    const pressRuntime = {
      subscribe: vi.fn(() => vi.fn()),
      openPress: vi.fn().mockResolvedValue(undefined),
      closePress: vi.fn(),
    };
    const service = new ModalService({
      getGameId: () => 'game-1',
      getCurrentPlayerId: () => null,
      updateCell: vi.fn().mockResolvedValue(true),
      getCell: vi.fn(() => ({ modifier: CELL_MODIFIERS.FLIP_SCORE })),
      touch: vi.fn(),
    }, mediaService, pressRuntime, { getPlayers: () => [] });

    service.showQuestionView({
      roundId: 0,
      rowId: 0,
      cellId: 0,
      value: 300,
      isAnswered: true,
      modifier: CELL_MODIFIERS.FLIP_SCORE,
      question: { text: 'Q', media: null, audioFiles: [] },
      answer: { text: 'A', media: null, audioFiles: [] },
    });

    expect(service.view?.getSelectedModifier?.()).toBe(CELL_MODIFIERS.FLIP_SCORE);
    void service.close();
  });

  it('shows directed-bet panel with empty players list when no players are connected', () => {
    const service = new ModalService(
      {
        getGameId: () => 'game-1',
        getCurrentPlayerId: () => null,
      },
      {},
      {},
      { getPlayers: () => [] }
    );

    service.view = {
      setPressBannerSuppressed: vi.fn(),
      updateDirectedBetTimer: vi.fn(),
      showDirectedBetPanel: vi.fn(),
      setResolutionButtonsEnabled: vi.fn(),
    };
    service.close = vi.fn();
    service._activeModifier = CELL_MODIFIERS.DIRECTED_BET;
    service._cellValue = 300;

    service._startDirectedBetSelection();

    expect(service.view.showDirectedBetPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        players: [],
      })
    );
    expect(service.close).not.toHaveBeenCalled();
    expect(globalThis.alert).not.toHaveBeenCalled();
  });

  it('flushes modifier and pending text updates as a single close patch', async () => {
    const updateCell = vi.fn().mockResolvedValue(true);
    const gameService = {
      getGameId: () => 'game-1',
      updateCell,
      getCell: () => ({ modifier: null }),
      touch: vi.fn(),
    };
    const service = new ModalService(gameService, {}, { closePress: vi.fn() }, { getPlayers: () => [] });
    service.activeCell = { roundId: 0, rowId: 1, cellId: 2 };
    service.view = {
      getSelectedModifier: () => CELL_MODIFIERS.FLIP_SCORE,
      destroy: vi.fn(),
    };
    service._pendingQuestionText = 'Question draft';
    service._pendingAnswerText = 'Answer draft';

    await service.close();

    expect(updateCell).toHaveBeenCalledWith(0, 1, 2, {
      modifier: CELL_MODIFIERS.FLIP_SCORE,
      question: { text: 'Question draft' },
      answer: { text: 'Answer draft' },
    });
  });
});
