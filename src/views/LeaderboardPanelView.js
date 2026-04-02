import QRCode from 'qrcode';
import { LeaderboardGridView } from './LeaderboardGridView.js';
import { ViewDisposer } from '../utils/disposer.js';
import { bindOverlayDismiss } from '../utils/overlayDismiss.js';
import { t, withLanguageParam } from '../i18n.js';

export class LeaderboardPanelView {
  constructor({ gameId, players = [], onAdjustPlayerScore = null, onDeletePlayer = null } = {}) {
    this._gameId = gameId;
    this._players = Array.isArray(players) ? players : [];
    this._onAdjustPlayerScore = onAdjustPlayerScore;
    this._onDeletePlayer = onDeletePlayer;
    this._isExpanded = false;

    this._build();
    this._disposer = new ViewDisposer(this._root);
    this._disposer.autoDestroy();
    this._wire();
    this.updatePlayers(this._players);
  }

  get el() {
    return this._root;
  }

  updatePlayers(players = []) {
    this._players = Array.isArray(players) ? players : [];
    this._previewView?.update?.(this._players);
    this._fullView?.update?.(this._players);
  }

  toggleExpanded() {
    this.setExpanded(!this._isExpanded);
  }

  setExpanded(nextExpanded) {
    const isExpanded = !!nextExpanded;
    if (this._isExpanded === isExpanded) return;

    this._isExpanded = isExpanded;
    this._root.classList.toggle('is-expanded', isExpanded);
    this._toggleBtn.textContent = isExpanded ? '⌄' : '⌃';
    this._toggleBtn.setAttribute('aria-expanded', String(isExpanded));
    this._toggleBtn.setAttribute('aria-label', isExpanded ? t('close') : t('show_all_players'));
    this._toggleBtn.setAttribute('title', isExpanded ? t('close') : t('show_all_players'));
  }

  destroy() {
    this._previewView?.destroy?.();
    this._fullView?.destroy?.();
    this._previewView = null;
    this._fullView = null;
    this._disposer?.destroy();
    this._root?.remove();
    this._root = null;
  }

  _build() {
    const root = document.createElement('footer');
    root.className = 'app-footer leaderboard-panel';

    root.innerHTML = `
      <div class="leaderboard-panel__backdrop"></div>

      <section class="leaderboard-panel__shell" aria-label="${t('leaderboard')}">
        <header class="leaderboard__header leaderboard-panel__header">
          <div class="leaderboard__title">${t('leaderboard')}</div>
          <button
            class="leaderboard__toggleBtn leaderboard__chevronBtn leaderboard__chevronBtn--up"
            type="button"
            aria-label="${t('show_all_players')}"
            aria-expanded="false"
            title="${t('show_all_players')}"
          >⌃</button>
        </header>

        <div class="leaderboard-panel__preview">
          <div class="leaderboard-panel__previewMount"></div>
        </div>

        <div class="leaderboard-panel__expanded">
          <section class="leaderboard-panel__section leaderboard-panel__section--board">
            <div class="leaderboard-panel__boardMount"></div>
          </section>

          <section class="leaderboard-panel__section leaderboard-panel__section--qr">
            <p class="leaderboard-panel__eyebrow">${t('join_from_phone')}</p>
            <p class="leaderboard-panel__copy">${t('scan_player_qr')}</p>
            <div class="leaderboard-panel__qrWrap">
              <div class="leaderboard-panel__qrGlow"></div>
              <img class="leaderboard-panel__qrImg" alt="${t('player_controller_qr_alt')}">
            </div>
          </section>
        </div>
      </section>
    `;

    this._root = root;
    this._backdrop = root.querySelector('.leaderboard-panel__backdrop');
    this._toggleBtn = root.querySelector('.leaderboard__toggleBtn');
    this._previewMount = root.querySelector('.leaderboard-panel__previewMount');
    this._boardMount = root.querySelector('.leaderboard-panel__boardMount');
    this._qrImg = root.querySelector('.leaderboard-panel__qrImg');

    this._previewView = LeaderboardGridView({
      players: this._players,
      variant: 'footer',
      showHeader: false,
      onOpenExpanded: () => this.setExpanded(true),
    });
    this._previewMount.appendChild(this._previewView);

    this._fullView = LeaderboardGridView({
      players: this._players,
      variant: 'drawer',
      showHeader: false,
      onAdjustPlayerScore: this._onAdjustPlayerScore,
      onDeletePlayer: this._onDeletePlayer,
    });
    this._boardMount.appendChild(this._fullView);

    void this._generateQr();
  }

  async _generateQr() {
    if (!this._gameId || !this._qrImg) return;

    const playerUrl = withLanguageParam(`${import.meta.env.BASE_URL}player.html?gameId=${this._gameId}`);

    try {
      this._qrImg.src = await QRCode.toDataURL(playerUrl, {
        width: 512,
        margin: 2,
        color: { dark: '#f8fafc', light: '#111827' },
      });
    } catch (error) {
      console.error('[LeaderboardPanelView] QR generation failed:', error);
    }
  }

  _wire() {
    this._disposer.addEventListener(this._toggleBtn, 'click', () => this.toggleExpanded());

    bindOverlayDismiss({
      disposer: this._disposer,
      overlay: this._backdrop,
      onDismiss: () => this.setExpanded(false),
      shouldDismissOnEscape: () => this._isExpanded,
    });
  }
}
