// public/src/views/SettingsView.js
import QRCode from 'qrcode';
import { ViewDisposer } from '../utils/disposer.js';

export class SettingsView {
  constructor({ settingsService, gameId, onClose } = {}) {
    this._svc = settingsService;
    this._gameId = gameId;
    this._onCloseExternal = onClose;

    this._isClosing = false;

    this._build();
    this._disposer = new ViewDisposer(this._root);
    this._disposer.autoDestroy();
    this._wire();
    this._subscribe();
  }

  get el() { return this._root; }

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

    const onEnd = (e) => {
      if (e.target !== panel) return;
      if (e.propertyName !== 'transform' && e.propertyName !== 'opacity') return;

      panel.removeEventListener('transitionend', onEnd);
      this.destroy();
      this._onCloseExternal?.();
    };

    panel.addEventListener('transitionend', onEnd);

    // fallback safety
    this._disposer.setTimeout(() => {
      panel.removeEventListener('transitionend', onEnd);
      if (this._root?.isConnected) {
        this.destroy();
        this._onCloseExternal?.();
      }
    }, 450);
  }

  destroy() {
    this._disposer.destroy();
    this._root?.remove();
    this._root = null;
  }

  _build() {
    const root = document.createElement('div');
    root.className = 'settings';

    root.innerHTML = `
      <div class="settings__overlay"></div>

      <aside class="settings__panel" role="dialog" aria-label="Leaderboard">
        <header class="settings__header">
          <h3 class="settings__title">Leaderboard</h3>
          <button class="settings__close" type="button" aria-label="Close">&times;</button>
        </header>

        <div class="settings__body">
          <div class="settings__section settings__section--leaderboard">
            <div class="settings__qr-wrap">
              <div class="settings__qr-glow"></div>
              <img class="settings__qr-img" alt="Leaderboard QR code">
              <a class="settings__qr-link" target="_blank" rel="noopener noreferrer">Open leaderboard ↗</a>
            </div>
          </div>
        </div>
      </aside>
    `;

    this._root = root;
    this._overlay = root.querySelector('.settings__overlay');
    this._panel = root.querySelector('.settings__panel');
    this._closeBtn = root.querySelector('.settings__close');
    this._qrImg  = root.querySelector('.settings__qr-img');
    this._qrLink = root.querySelector('.settings__qr-link');

    this._generateQR();
  }

  async _generateQR() {
    if (!this._gameId || !this._qrImg || !this._qrLink) return;

    const url = `${window.location.origin}/leaderboard.html?gameId=${this._gameId}`;

    this._qrLink.href = url;
    this._qrLink.textContent = 'Open leaderboard ↗';

    try {
      const dataUrl = await QRCode.toDataURL(url, {
        width: 512,
        margin: 2,
        color: { dark: '#f8fafc', light: '#111827' }
      });
      if (this._qrImg) this._qrImg.src = dataUrl;
    } catch (e) {
      console.error('[SettingsView] QR generation failed:', e);
    }
  }

  _wire() {
    this._disposer.addEventListener(this._overlay, 'click', () => this.beginClose());
    this._disposer.addEventListener(this._closeBtn, 'click', () => this.beginClose());
  }

  _subscribe() {
    this._disposer.addSubscription(
      (fn) => this._svc.subscribe(fn),
      (state) => this._render(state)
    );
  }

  _render(_st) {
    // nothing to update
  }
}
