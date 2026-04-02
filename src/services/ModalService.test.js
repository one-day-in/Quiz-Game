/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  adjustPlayerScoreMock,
} = vi.hoisted(() => ({
  adjustPlayerScoreMock: vi.fn(),
}));

vi.mock('../api/gameApi.js', () => ({
  adjustPlayerScore: adjustPlayerScoreMock,
}));

import { ModalService } from './ModalService.js';

describe('ModalService press reset', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
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
