/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getGameRuntimeMock,
  subscribeToGameRuntimeMock,
  adjustPlayerScoreMock,
} = vi.hoisted(() => ({
  getGameRuntimeMock: vi.fn(),
  subscribeToGameRuntimeMock: vi.fn(() => () => {}),
  adjustPlayerScoreMock: vi.fn(),
}));

vi.mock('../api/gameApi.js', () => ({
  adjustPlayerScore: adjustPlayerScoreMock,
  getGameRuntime: getGameRuntimeMock,
  subscribeToGameRuntime: subscribeToGameRuntimeMock,
}));

import { ModalService } from './ModalService.js';

describe('ModalService press reset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getGameRuntimeMock.mockResolvedValue({
      winnerPlayerId: null,
      winnerName: null,
    });
  });

  it('enables press immediately after reset', async () => {
    const setPressEnabled = vi.fn().mockResolvedValue(undefined);
    const gameService = {
      setPressEnabled,
      getGameId: () => 'game-1',
    };
    const service = new ModalService(gameService, {});
    service.view = { updateWinnerName: vi.fn() };

    await service._resetPressRuntime();

    expect(setPressEnabled).toHaveBeenCalledTimes(2);
    expect(setPressEnabled).toHaveBeenNthCalledWith(1, false);
    expect(setPressEnabled).toHaveBeenNthCalledWith(2, true);
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

  it('adds score and closes modal on correct answer', async () => {
    const gameService = {
      getGameId: () => 'game-1',
    };
    const service = new ModalService(gameService, {});
    service._pressWinnerId = 'player-2';
    service._cellValue = 500;
    service.close = vi.fn();

    await service._handleCorrect();

    expect(adjustPlayerScoreMock).toHaveBeenCalledWith('game-1', 'player-2', 500);
    expect(service.close).toHaveBeenCalledTimes(1);
  });
});
