/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  adjustPlayerScoreMock,
  updatePlayerMock,
} = vi.hoisted(() => ({
  adjustPlayerScoreMock: vi.fn(),
  updatePlayerMock: vi.fn(),
}));

vi.mock('../api/gameApi.js', () => ({
  adjustPlayerScore: adjustPlayerScoreMock,
}));

vi.mock('../api/playersApi.js', () => ({
  updatePlayer: updatePlayerMock,
}));

import { ModalService } from './ModalService.js';

describe('ModalService press reset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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

    expect(adjustPlayerScoreMock).toHaveBeenCalledWith('game-1', 'player-2', 500);
    expect(gameService.setCurrentPlayerId).toHaveBeenCalledWith('player-2');
    expect(service.close).toHaveBeenCalledTimes(1);
  });

  it('applies flip-score modifier to the current active player and closes the modal', async () => {
    const playersService = {
      getPlayers: () => [{ id: 'player-9', points: 400 }],
    };
    const service = new ModalService({
      getGameId: () => 'game-1',
      getCurrentPlayerId: () => 'player-9',
    }, {}, {}, playersService);
    service.close = vi.fn();

    await service._applyFlipScoreModifierToCurrentPlayer();

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

  it('shows an alert when plus-to-minus opens without an active player', async () => {
    const service = new ModalService({
      getGameId: () => 'game-1',
      getCurrentPlayerId: () => null,
    }, {}, {}, { getPlayers: () => [] });
    service.close = vi.fn();

    const applied = await service._applyFlipScoreModifierToCurrentPlayer();

    expect(applied).toBe(false);
    expect(globalThis.alert).toHaveBeenCalledTimes(1);
    expect(service.close).toHaveBeenCalledTimes(1);
  });

  it('can close the modifier banner early via acknowledge callback', async () => {
    const playersService = {
      getPlayers: () => [{ id: 'player-9', points: 400 }],
    };
    const service = new ModalService({
      getGameId: () => 'game-1',
      getCurrentPlayerId: () => 'player-9',
    }, {}, {}, playersService);
    service.close = vi.fn();

    await service._applyFlipScoreModifierToCurrentPlayer();
    expect(service.close).not.toHaveBeenCalled();

    service.close();

    expect(service.close).toHaveBeenCalledTimes(1);
  });
});
