// src/views/LeaderboardDrawerView.js
import QRCode from 'qrcode';
import { LeaderboardGridView } from './LeaderboardGridView.js';
import { ViewDisposer } from '../utils/disposer.js';
import { t, withLanguageParam } from '../i18n.js';

export class LeaderboardDrawerView {
  constructor({ gameId, players = [], onClose } = {}) {
    this._gameId = gameId;
    this._players = Array.isArray(players) ? players : [];
    this._onCloseExternal = onClose;
    this._isClosing = false;

    this._build();
    this._disposer = new ViewDisposer(this._root);
    this._disposer.autoDestroy();
    this._wire();
  }

  get el() {
    return this._root;
  }

  beginOpen() {
    this._disposer.setTimeout(() => {
      this._root?.classList.add('is-open');
    }, 0);
  }

  beginClose() {
    if (!this._root || this._isClosing) return;
    this._isClosing = true;

    this._root.classList.remove('is-open');

    const panel = this._panel;
    if (!panel) {
      this.destroy();
      this._onCloseExternal?.();
      return;
    }

    const onEnd = (event) => {
      if (event.target !== panel) return;
      if (event.propertyName !== 'transform' && event.propertyName !== 'opacity') return;

      panel.removeEventListener('transitionend', onEnd);
      this.destroy();
      this._onCloseExternal?.();
    };

    panel.addEventListener('transitionend', onEnd);

    this._disposer.setTimeout(() => {
      panel.removeEventListener('transitionend', onEnd);
      if (this._root?.isConnected) {
        this.destroy();
        this._onCloseExternal?.();
      }
    }, 450);
  }

  updatePlayers(players = []) {
    this._players = Array.isArray(players) ? players : [];
    this._leaderboardEl?.update?.(this._players);
  }

  destroy() {
    this._leaderboardEl?.destroy?.();
    this._leaderboardEl = null;
    this._disposer.destroy();
    this._root?.remove();
    this._root = null;
  }

  _build() {
    const root = document.createElement('div');
    root.className = 'leaderboard-drawer';

    root.innerHTML = `
      <div class="leaderboard-drawer__overlay"></div>

      <aside class="leaderboard-drawer__panel" role="dialog" aria-modal="true" aria-label="${t('leaderboard')}">
        <header class="leaderboard-drawer__header">
          <div class="leaderboard-drawer__titleGroup">
            <p class="leaderboard-drawer__eyebrow">${t('leaderboard')}</p>
            <h3 class="leaderboard-drawer__title">${t('show_all_players')}</h3>
          </div>
          <button class="leaderboard-drawer__close" type="button" aria-label="${t('close')}">&times;</button>
        </header>

        <div class="leaderboard-drawer__body">
          <section class="leaderboard-drawer__section leaderboard-drawer__section--board">
            <div class="leaderboard-drawer__boardMount"></div>
          </section>

          <section class="leaderboard-drawer__section leaderboard-drawer__section--qr">
            <p class="leaderboard-drawer__eyebrow">${t('join_from_phone')}</p>
            <p class="leaderboard-drawer__copy">${t('scan_player_qr')}</p>
            <div class="leaderboard-drawer__qr-wrap">
              <div class="leaderboard-drawer__qr-glow"></div>
              <img class="leaderboard-drawer__qr-img" alt="${t('player_controller_qr_alt')}">
              <a class="leaderboard-drawer__qr-link" target="_blank" rel="noopener noreferrer">${t('join_controller')}</a>
              <a class="leaderboard-drawer__secondaryLink" target="_blank" rel="noopener noreferrer">${t('open_leaderboard')}</a>
            </div>
          </section>
        </div>
      </aside>
    `;

    this._root = root;
    this._overlay = root.querySelector('.leaderboard-drawer__overlay');
    this._panel = root.querySelector('.leaderboard-drawer__panel');
    this._closeBtn = root.querySelector('.leaderboard-drawer__close');
    this._qrImg = root.querySelector('.leaderboard-drawer__qr-img');
    this._qrLink = root.querySelector('.leaderboard-drawer__qr-link');
    this._standaloneLink = root.querySelector('.leaderboard-drawer__secondaryLink');
    this._boardMount = root.querySelector('.leaderboard-drawer__boardMount');

    this._leaderboardEl = LeaderboardGridView({
      players: this._players,
      variant: 'drawer',
      showHeader: false,
    });
    this._boardMount?.appendChild(this._leaderboardEl);

    void this._generateLinksAndQr();
  }

  async _generateLinksAndQr() {
    if (!this._gameId || !this._qrImg || !this._qrLink) return;

    const playerUrl = withLanguageParam(`${import.meta.env.BASE_URL}player.html?gameId=${this._gameId}`);
    const leaderboardUrl = withLanguageParam(`${import.meta.env.BASE_URL}leaderboard.html?gameId=${this._gameId}`);

    this._qrLink.href = playerUrl;
    if (this._standaloneLink) this._standaloneLink.href = leaderboardUrl;

    try {
      const dataUrl = await QRCode.toDataURL(playerUrl, {
        width: 512,
        margin: 2,
        color: { dark: '#f8fafc', light: '#111827' },
      });
      if (this._qrImg) this._qrImg.src = dataUrl;
    } catch (error) {
      console.error('[LeaderboardDrawerView] QR generation failed:', error);
    }
  }

  _wire() {
    this._disposer.addEventListener(this._overlay, 'click', () => this.beginClose());
    this._disposer.addEventListener(this._closeBtn, 'click', () => this.beginClose());
    this._disposer.addEventListener(document, 'keydown', (event) => {
      if (event.key === 'Escape') this.beginClose();
    });
  }
}
