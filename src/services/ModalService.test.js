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

  it('enables press only after a 2 second delay', async () => {
    const setPressEnabled = vi.fn().mockResolvedValue(undefined);
    const gameService = {
      setPressEnabled,
      getGameId: () => 'game-1',
    };
    const service = new ModalService(gameService, {});
    service.view = { updateWinnerName: vi.fn() };

    await service._resetPressRuntime();

    expect(setPressEnabled).toHaveBeenCalledTimes(1);
    expect(setPressEnabled).toHaveBeenNthCalledWith(1, false);

    await vi.advanceTimersByTimeAsync(1999);
    expect(setPressEnabled).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(setPressEnabled).toHaveBeenCalledTimes(2);
    expect(setPressEnabled).toHaveBeenNthCalledWith(2, true);
  });
});
