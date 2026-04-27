// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppController } from './AppController.js';

vi.mock('./views/AppView.js', () => ({
  AppView: vi.fn(() => ({
    el: document.createElement('div'),
    update: vi.fn(),
    updatePlayers: vi.fn(),
    syncLive: vi.fn(),
    setRoundTransition: vi.fn(),
    patchCell: vi.fn(),
  })),
}));

vi.mock('./utils/confirm.js', () => ({
  showRoundPicker: vi.fn(async () => null),
}));

function createSubscribeSpy() {
  let callback = null;
  return {
    subscribe(fn) {
      callback = fn;
      return () => {
        callback = null;
      };
    },
    emit(payload) {
      callback?.(payload);
    },
  };
}

describe('AppController openCell sync payload', () => {
  let gameEvents;
  let playersEvents;
  let gameService;
  let playersService;
  let modalService;
  let root;

  beforeEach(() => {
    gameEvents = createSubscribeSpy();
    playersEvents = createSubscribeSpy();

    gameService = {
      subscribe: (fn) => gameEvents.subscribe(fn),
      getState: () => ({
        model: {
          getCell: () => ({
            question: { text: 'Q' },
            answer: { text: 'A' },
            isAnswered: false,
          }),
        },
        uiState: { activeRoundId: 0, isRoundTransitioning: false, pendingRoundId: null },
      }),
      setCurrentPlayerId: vi.fn(),
      updateTopic: vi.fn(),
    };

    playersService = {
      subscribe: (fn) => playersEvents.subscribe(fn),
      getPlayers: () => [],
      adjustPlayerScore: vi.fn(),
      removePlayer: vi.fn(),
    };

    modalService = {
      showQuestionView: vi.fn(),
      isOpen: vi.fn(() => false),
      destroy: vi.fn(),
    };

    root = document.createElement('div');
    document.body.appendChild(root);
  });

  it('rebuilds payload from current model and keeps latest cell content', () => {
    const onCellOpen = vi.fn();
    const controller = createAppController({
      root,
      gameService,
      playersService,
      modalService,
      roundNavigationService: { getState: () => ({ activeRoundId: 0, roundNames: [] }) },
      gameId: 'g1',
      gameName: 'Game',
      onCellOpen,
    });

    controller.render();
    controller.openCell({
      roundId: 0,
      rowId: 0,
      cellId: 0,
      value: 100,
      question: { text: 'stale' },
      answer: { text: 'stale' },
      isAnswered: true,
    });

    expect(modalService.showQuestionView).toHaveBeenCalledTimes(1);
    expect(modalService.showQuestionView).toHaveBeenCalledWith(
      expect.objectContaining({
        roundId: 0,
        rowId: 0,
        cellId: 0,
        value: 100,
        isAnswered: false,
      })
    );
    expect(onCellOpen).toHaveBeenCalledWith(
      expect.objectContaining({
        isAnswered: true,
      })
    );

    controller.destroy();
    root.remove();
  });
});
