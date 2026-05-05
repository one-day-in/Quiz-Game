/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HeaderView } from './HeaderView.js';
import { t } from '../i18n.js';

describe('HeaderView current player picker', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
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

  it('shows host controller connection indicator in settings host button', () => {
    const view = HeaderView({
      uiState: { activeRoundId: 0 },
      gameId: 'game-1',
      showQrInSettings: true,
      hostControllerConnected: false,
      players: [],
      currentPlayerId: null,
    });

    document.body.appendChild(view.el);
    const dot = document.body.querySelector('.js-host-controller-dot');
    expect(dot).toBeTruthy();
    expect(dot?.classList.contains('is-active')).toBe(false);

    view.update({ hostControllerConnected: true });
    expect(dot?.classList.contains('is-active')).toBe(true);
  });

  it('toggles fullscreen button state in header', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      writable: true,
      value: null,
    });
    const requestFullscreen = vi.fn().mockImplementation(async () => {
      document.fullscreenElement = document.documentElement;
    });
    const exitFullscreen = vi.fn().mockImplementation(async () => {
      document.fullscreenElement = null;
    });
    Object.defineProperty(document.documentElement, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });

    const view = HeaderView({
      uiState: { activeRoundId: 0 },
      players: [],
      currentPlayerId: null,
    });

    document.body.appendChild(view.el);
    const btn = view.el.querySelector('.hdr-fullscreen-btn');
    expect(btn).toBeTruthy();
    expect(btn?.hidden).toBe(false);
    expect(btn?.getAttribute('title')).toBe(t('enter_fullscreen'));

    btn?.click();
    await Promise.resolve();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(btn?.getAttribute('aria-pressed')).toBe('true');
    expect(btn?.getAttribute('title')).toBe(t('exit_fullscreen'));

    btn?.click();
    await Promise.resolve();
    document.dispatchEvent(new Event('fullscreenchange'));
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
    expect(btn?.getAttribute('title')).toBe(t('enter_fullscreen'));
  });
});
