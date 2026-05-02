/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  adjustPlayerScoreMock,
  resolveGamePressMock,
  resolveGamePressTimeoutMock,
} = vi.hoisted(() => ({
  adjustPlayerScoreMock: vi.fn(),
  resolveGamePressMock: vi.fn(),
  resolveGamePressTimeoutMock: vi.fn(),
}));

vi.mock('../api/gameApi.js', () => ({
  adjustPlayerScore: adjustPlayerScoreMock,
  resolveGamePress: resolveGamePressMock,
  resolveGamePressTimeout: resolveGamePressTimeoutMock,
}));

import { ModalService } from './ModalService.js';

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
    resolveGamePressTimeoutMock.mockResolvedValue({
      gameId: 'game-1',
      winnerPlayerId: null,
      pressEnabled: true,
      pressedAt: null,
    });
    vi.stubGlobal('alert', vi.fn());
  });

  it('keeps press closed after reset when modal is not open', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const pressRuntime = {
      openPress: vi.fn().mockResolvedValue(undefined),
      closePress: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ModalService(gameService, {}, pressRuntime);
    service.view = { updateWinnerName: vi.fn() };

    await service._resetPressRuntime();

    expect(pressRuntime.openPress).not.toHaveBeenCalled();
    expect(pressRuntime.closePress).toHaveBeenCalledTimes(1);
  });

  it('keeps press closed when switching from edit to play with no open modal', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const pressRuntime = {
      openPress: vi.fn().mockResolvedValue(undefined),
      closePress: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ModalService(gameService, {}, pressRuntime);

    service.setGameMode('edit');
    service.setGameMode('play');
    await vi.runAllTimersAsync();

    expect(pressRuntime.openPress).not.toHaveBeenCalled();
    expect(pressRuntime.closePress).toHaveBeenCalled();
  });

  it('keeps press closed when answer is shown', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const pressRuntime = {
      openPress: vi.fn().mockResolvedValue(undefined),
      closePress: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ModalService(gameService, {}, pressRuntime);
    service.view = { updateWinnerName: vi.fn() };
    service._modalViewMode = 'view';
    service._modalIsAnswerShown = true;

    await service._resetPressRuntime();

    expect(pressRuntime.openPress).not.toHaveBeenCalled();
    expect(pressRuntime.closePress).toHaveBeenCalledTimes(1);
  });

  it('keeps press closed in edit mode', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const pressRuntime = {
      openPress: vi.fn().mockResolvedValue(undefined),
      closePress: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ModalService(gameService, {}, pressRuntime);
    service.view = { updateWinnerName: vi.fn() };
    service._modalViewMode = 'edit';
    service._modalIsAnswerShown = true;

    await service._resetPressRuntime();

    expect(pressRuntime.openPress).not.toHaveBeenCalled();
    expect(pressRuntime.closePress).toHaveBeenCalledTimes(1);
  });

  it('keeps press closed for steal 1000 modifier in play view mode', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const pressRuntime = {
      openPress: vi.fn().mockResolvedValue(undefined),
      closePress: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ModalService(gameService, {}, pressRuntime);
    service.view = { updateWinnerName: vi.fn() };
    service.activeCell = { roundId: 0, rowId: 0, cellId: 0 };
    service._globalGameMode = 'play';
    service._modalViewMode = 'view';
    service._modalIsAnswerShown = false;
    service._activeModifier = { type: 'steal_leader_points' };

    await service._resetPressRuntime();

    expect(pressRuntime.openPress).not.toHaveBeenCalled();
    expect(pressRuntime.closePress).toHaveBeenCalledTimes(1);
  });

  it('closes stale openPress after switching to answer view', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    let resolveOpen;
    const openPromise = new Promise((resolve) => {
      resolveOpen = resolve;
    });
    const pressRuntime = {
      openPress: vi.fn().mockReturnValue(openPromise),
      closePress: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ModalService(gameService, {}, pressRuntime);
    service.activeCell = { roundId: 'r1', rowId: 'row1', cellId: 'c1' };
    service._globalGameMode = 'play';
    service._modalViewMode = 'view';
    service._modalIsAnswerShown = false;

    const firstSync = service._syncPressAvailability({ force: true });
    expect(pressRuntime.openPress).toHaveBeenCalledTimes(1);

    service._modalIsAnswerShown = true;
    await service._syncPressAvailability({ force: true });
    expect(pressRuntime.closePress).toHaveBeenCalledTimes(1);

    resolveOpen();
    await firstSync;

    expect(pressRuntime.closePress).toHaveBeenCalledTimes(2);
  });

  it('subtracts score and resets press on incorrect answer', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const service = new ModalService(gameService, {});
    service._pressWinnerId = 'player-1';
    service._cellValue = 300;
    service.view = {
      updateWinnerName: vi.fn(),
      updatePressTimer: vi.fn(),
      _mode: 'view',
      _isAnswerShown: false,
    };
    service._resetPressRuntime = vi.fn().mockResolvedValue(undefined);

    await service._handleIncorrect();

    expect(resolveGamePressMock).toHaveBeenCalledWith('game-1', 'player-1', { pressEnabled: true });
    expect(adjustPlayerScoreMock).toHaveBeenCalledWith('game-1', 'player-1', -300);
    expect(service._resetPressRuntime).toHaveBeenCalledTimes(1);
  });

  it('uses generic resolve for timeout flow and still applies incorrect path', async () => {
    resolveGamePressMock.mockResolvedValue({
      gameId: 'game-1',
      winnerPlayerId: null,
      pressEnabled: true,
      pressedAt: null,
    });

    const gameService = {
      getGameId: () => 'game-1',
    };
    const service = new ModalService(gameService, {});
    service._pressWinnerId = 'player-1';
    service._cellValue = 300;
    service.view = {
      updateWinnerName: vi.fn(),
      updatePressTimer: vi.fn(),
      _mode: 'view',
      _isAnswerShown: false,
    };
    service._resetPressRuntime = vi.fn().mockResolvedValue(undefined);

    await service._handleIncorrect({ source: 'timeout' });

    expect(resolveGamePressTimeoutMock).not.toHaveBeenCalled();
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
      _mode: 'view',
      _isAnswerShown: false,
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

  it('starts countdown when winner arrives immediately during reset handshake', async () => {
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
    service.activeCell = { roundId: 'r1', rowId: 'row1', cellId: 'c1' };
    service._globalGameMode = 'play';
    service._modalViewMode = 'view';
    service._modalIsAnswerShown = false;
    service._pressAvailabilityIntent = true;
    service._isResettingPressRuntime = true;
    service.view = {
      updateWinnerName: vi.fn(),
      updatePressTimer: vi.fn(),
      setResolutionButtonsEnabled: vi.fn(),
      _mode: 'view',
      _isAnswerShown: false,
    };
    service._cellValue = 300;
    service._resetPressRuntime = vi.fn().mockResolvedValue(undefined);

    service._bindPressRuntime();
    runtimeHandler?.({
      pressEnabled: true,
      winnerPlayerId: 'player-1',
      winnerName: 'Maria',
    });
    await vi.advanceTimersByTimeAsync(30000);

    expect(service.view.updatePressTimer).toHaveBeenCalledWith(30);
    expect(adjustPlayerScoreMock).toHaveBeenCalledWith('game-1', 'player-1', -300);
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
      _mode: 'view',
      _isAnswerShown: false,
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

  it('keeps winner lock when answer is shown so resolution buttons stay clickable', async () => {
    const gameService = {
      getGameId: () => 'game-1',
      getModel: () => ({ getTopic: () => 'Topic' }),
      updateCell: vi.fn().mockResolvedValue(true),
      touch: vi.fn(),
    };
    const mediaService = {
      toViewMedia: (media) => media,
      toViewAudioFiles: (audioFiles) => audioFiles || [],
    };
    const pressRuntime = {
      openPress: vi.fn().mockResolvedValue(undefined),
      closePress: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn(() => vi.fn()),
    };
    const service = new ModalService(gameService, mediaService, pressRuntime, { getPlayers: () => [] });

    service._open('view', {
      roundId: 0,
      rowId: 0,
      cellId: 0,
      value: 100,
      isAnswered: true,
      question: { text: 'Question', media: null, audioFiles: [] },
      answer: { text: 'Answer', media: null, audioFiles: [] },
      modifier: null,
    });

    await Promise.resolve();
    await Promise.resolve();
    service._setPressWinner('player-1', 'Maria');
    pressRuntime.closePress.mockClear();

    service.view?.toggleAnswerVisibility?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(service._pressWinnerId).toBe('player-1');
    expect(service.view?._refs?.btnIncorrect?.disabled).toBe(false);
    expect(service.view?._refs?.btnCorrect?.disabled).toBe(false);
    expect(pressRuntime.closePress).not.toHaveBeenCalled();

    await service.close();
  });

  it('does not auto-mark incorrect when answer is shown right before timeout', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const service = new ModalService(gameService, {}, {});
    service.view = {
      updateWinnerName: vi.fn(),
      updatePressTimer: vi.fn(),
      _mode: 'view',
      _isAnswerShown: false,
    };
    service._pressWinnerId = 'player-1';
    service._cellValue = 300;

    service._startPressCountdown(2000);
    await vi.advanceTimersByTimeAsync(1900);

    service.view._isAnswerShown = true;
    await vi.advanceTimersByTimeAsync(2000);

    expect(adjustPlayerScoreMock).not.toHaveBeenCalled();
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

  it('flushes pending text updates as a single close patch', async () => {
    const updateCell = vi.fn().mockResolvedValue(true);
    const gameService = {
      getGameId: () => 'game-1',
      updateCell,
      touch: vi.fn(),
    };
    const service = new ModalService(gameService, {}, { closePress: vi.fn() }, { getPlayers: () => [] });
    service.activeCell = { roundId: 0, rowId: 1, cellId: 2 };
    service.view = {
      destroy: vi.fn(),
    };
    service._pendingQuestionText = 'Question draft';
    service._pendingAnswerText = 'Answer draft';

    await service.close();

    expect(updateCell).toHaveBeenCalledWith(0, 1, 2, {
      question: { text: 'Question draft' },
      answer: { text: 'Answer draft' },
    });
  });
});
