/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HeaderView } from './HeaderView.js';

describe('HeaderView current player picker', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the current chooser name and lets the host switch it manually', () => {
    const onCurrentPlayerChange = vi.fn();
    const view = HeaderView({
      uiState: { activeRoundId: 0 },
      gameName: 'Quiz Game',
      players: [
        { id: 'player-1', name: 'Maria', points: 300 },
        { id: 'player-2', name: 'Oleh', points: 100 },
      ],
      currentPlayerId: 'player-1',
      onCurrentPlayerChange,
    });

    document.body.appendChild(view.el);

    expect(view.el.querySelector('.js-current-player-value')?.textContent).toBe('Maria');

    view.el.querySelector('.hdr-current-player-btn')?.click();
    view.el.querySelector('[data-player-id="player-2"]')?.click();

    expect(onCurrentPlayerChange).toHaveBeenCalledWith('player-2');
  });
});
