import QRCode from 'qrcode';
import { LeaderboardGridView } from './LeaderboardGridView.js';
import { ViewDisposer } from '../utils/disposer.js';
import { bindOverlayDismiss } from '../utils/overlayDismiss.js';
import { t, withLanguageParam } from '../i18n.js';
import {
  getActiveBuzzerUrl,
  getCloudBuzzerUrl,
  getStoredBuzzerMode,
  getSuggestedLocalBuzzerUrl,
  setStoredBuzzerMode,
  setStoredLocalBuzzerUrl,
} from '../utils/localBuzzerUrl.js';

export class LeaderboardPanelView {
  constructor({ gameId, players = [], onAdjustPlayerScore = null, onDeletePlayer = null } = {}) {
    this._gameId = gameId;
    this._players = Array.isArray(players) ? players : [];
    this._onAdjustPlayerScore = onAdjustPlayerScore;
    this._onDeletePlayer = onDeletePlayer;
    this._isExpanded = false;
    this._selectedPlayerId = null;
    this._buzzerMode = getStoredBuzzerMode();
    this._localBuzzerUrl = getSuggestedLocalBuzzerUrl();
    this._cloudBuzzerUrl = getCloudBuzzerUrl();

    this._build();
    this._disposer = new ViewDisposer(this._root);
    this._disposer.autoDestroy();
    this._buildScoreBar();
    this._wire();
    this.updatePlayers(this._players);
  }

  get el() {
    return this._root;
  }

  updatePlayers(players = []) {
    this._players = Array.isArray(players) ? players : [];
    this._syncSelectedPlayer();
    this._previewView?.update?.(this._players);
    this._fullView?.update?.(this._players);
    this._fullView?.setSelectedPlayerId?.(this._selectedPlayerId);
    this._renderSelectionState();
  }

  toggleExpanded() {
    this.setExpanded(!this._isExpanded);
  }

  setExpanded(nextExpanded) {
    const isExpanded = !!nextExpanded;
    if (this._isExpanded === isExpanded) return;

    this._isExpanded = isExpanded;
    this._root.classList.toggle('is-expanded', isExpanded);
    this._toggleChevron.classList.toggle('is-down', isExpanded);
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
        <div class="leaderboard-panel__headerBar">
          <button
            class="leaderboard__header leaderboard-panel__toggle"
            type="button"
            aria-label="${t('show_all_players')}"
            aria-expanded="false"
            title="${t('show_all_players')}"
          >
            <span class="leaderboard__title leaderboard-panel__titleText">${t('leaderboard')}</span>
            <span class="leaderboard-panel__titleChevron" aria-hidden="true">
              <svg class="leaderboard-panel__titleChevronIcon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M6 15l6-6 6 6" />
              </svg>
            </span>
          </button>

          <div class="leaderboard-panel__qrDock">
            <button
              class="leaderboard-panel__qrTrigger"
              type="button"
              aria-label="${t('join_from_phone')}"
              title="${t('join_from_phone')}"
            >
              <svg class="leaderboard-panel__qrTriggerIcon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
                <path d="M16 14h2v2h-2zM18 16h2v2h-2zM14 18h2v2h-2zM16 20h4M20 14v2" />
              </svg>
            </button>

            <div class="leaderboard-panel__qrPopover" role="dialog" aria-label="${t('join_from_phone')}">
              <p class="leaderboard-panel__eyebrow">${t('join_from_phone')}</p>
              <div class="leaderboard-panel__modeSwitch" role="group" aria-label="${t('buzzer_mode')}">
                <button
                  type="button"
                  class="leaderboard-panel__modeBtn leaderboard-panel__modeBtn--local"
                  data-mode="local"
                  aria-pressed="${this._buzzerMode === 'local'}"
                >${t('local_room_mode')}</button>
                <button
                  type="button"
                  class="leaderboard-panel__modeBtn leaderboard-panel__modeBtn--cloud"
                  data-mode="cloud"
                  aria-pressed="${this._buzzerMode === 'cloud'}"
                  ${this._cloudBuzzerUrl ? '' : 'disabled'}
                >${t('cloud_room_mode')}</button>
              </div>
              <label class="leaderboard-panel__roomField">
                <span class="leaderboard-panel__roomLabel">${t('local_room_server')}</span>
                <input
                  class="leaderboard-panel__roomInput"
                  type="text"
                  value="${escapeHtml(this._localBuzzerUrl)}"
                  placeholder="${t('local_room_server_placeholder')}"
                  spellcheck="false"
                  autocomplete="off"
                >
              </label>
              <p class="leaderboard-panel__roomHint"></p>
              <div class="leaderboard-panel__localGuide">
                <p class="leaderboard-panel__localGuideTitle">${t('local_room_setup_title')}</p>
                <ol class="leaderboard-panel__localGuideList">
                  <li>${t('local_room_setup_step_1')}</li>
                  <li>${t('local_room_setup_step_2')}</li>
                  <li>${t('local_room_setup_step_3')}</li>
                </ol>
              </div>
              <div class="leaderboard-panel__qrWrap">
                <div class="leaderboard-panel__qrGlow"></div>
                <img class="leaderboard-panel__qrImg" alt="${t('player_controller_qr_alt')}">
              </div>
              <p class="leaderboard-panel__copy">${t('scan_player_qr')}</p>
            </div>
          </div>
        </div>

        <div class="leaderboard-panel__preview">
          <div class="leaderboard-panel__previewMount"></div>
        </div>

        <div class="leaderboard-panel__expanded">
          <div class="leaderboard-panel__expandedInner">
            <section class="leaderboard-panel__section leaderboard-panel__section--board">
              <div class="leaderboard-panel__boardMount"></div>
            </section>

            <section class="leaderboard-panel__section leaderboard-panel__section--controls">
              <div class="leaderboard-panel__controlsInner">
                <div class="leaderboard-panel__selectionMeta">
                  <p class="leaderboard-panel__selectionText">${t('players')}</p>
                </div>

                <div class="leaderboard-panel__scoreBar" role="group" aria-label="${t('manage_score')}"></div>
              </div>
            </section>
          </div>
        </div>
      </section>
    `;

    this._root = root;
    this._backdrop = root.querySelector('.leaderboard-panel__backdrop');
    this._toggleBtn = root.querySelector('.leaderboard-panel__toggle');
    this._toggleChevron = root.querySelector('.leaderboard-panel__titleChevron');
    this._previewMount = root.querySelector('.leaderboard-panel__previewMount');
    this._boardMount = root.querySelector('.leaderboard-panel__boardMount');
    this._selectionText = root.querySelector('.leaderboard-panel__selectionText');
    this._scoreBar = root.querySelector('.leaderboard-panel__scoreBar');
    this._qrImg = root.querySelector('.leaderboard-panel__qrImg');
    this._roomInput = root.querySelector('.leaderboard-panel__roomInput');
    this._roomHint = root.querySelector('.leaderboard-panel__roomHint');
    this._localGuide = root.querySelector('.leaderboard-panel__localGuide');
    this._modeButtons = Array.from(root.querySelectorAll('.leaderboard-panel__modeBtn'));

    this._previewView = LeaderboardGridView({
      players: this._players,
      variant: 'footer',
      showHeader: false,
    });
    this._previewMount.appendChild(this._previewView);

    this._fullView = LeaderboardGridView({
      players: this._players,
      variant: 'drawer',
      showHeader: false,
      selectedPlayerId: this._selectedPlayerId,
      onSelectPlayer: (playerId) => this._setSelectedPlayer(playerId),
      onDeletePlayer: this._onDeletePlayer,
    });
    this._boardMount.appendChild(this._fullView);

    void this._generateQr();
    this._renderBuzzerModeState();
  }

  async _generateQr() {
    if (!this._gameId || !this._qrImg) return;

    const playerUrl = new URL(withLanguageParam(`${import.meta.env.BASE_URL}player.html?gameId=${this._gameId}`));
    const buzzerUrl = getActiveBuzzerUrl({
      mode: this._buzzerMode,
      overrideUrl: this._buzzerMode === 'local' ? this._localBuzzerUrl : this._cloudBuzzerUrl,
    });
    if (buzzerUrl) {
      playerUrl.searchParams.set('buzzer', buzzerUrl);
    } else {
      playerUrl.searchParams.delete('buzzer');
    }
    playerUrl.searchParams.set('mode', this._buzzerMode);

    try {
      this._qrImg.src = await QRCode.toDataURL(playerUrl.toString(), {
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
    this._disposer.addEventListener(this._roomInput, 'change', () => this._handleRoomInputCommit());
    this._disposer.addEventListener(this._roomInput, 'blur', () => this._handleRoomInputCommit());
    this._disposer.addEventListener(this._roomInput, 'keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this._roomInput.blur();
      }
    });
    for (const button of this._modeButtons) {
      this._disposer.addEventListener(button, 'click', () => {
        const nextMode = button.dataset.mode === 'local' ? 'local' : 'cloud';
        if (nextMode === 'cloud' && !this._cloudBuzzerUrl) return;
        this._buzzerMode = setStoredBuzzerMode(nextMode);
        this._renderBuzzerModeState();
        void this._generateQr();
      });
    }

    this._disposer.addEventListener(document, 'pointerdown', (event) => {
      if (!this._isExpanded || !this._selectedPlayerId) return;

      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('.leaderboard__rowWrap, .leaderboard__row')) return;
      if (target.closest('.leaderboard-panel__scoreBar, .leaderboard-panel__qrDock, .leaderboard-panel__toggle')) return;

      this._clearSelectedPlayer();
    }, true);

    bindOverlayDismiss({
      disposer: this._disposer,
      overlay: this._backdrop,
      onDismiss: () => this.setExpanded(false),
      shouldDismissOnEscape: () => this._isExpanded,
    });
  }

  _buildScoreBar() {
    const deltas = [-500, -400, -300, -200, -100, 100, 200, 300, 400, 500];
    for (const delta of deltas) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'leaderboard-panel__scoreBtn';
      button.textContent = delta > 0 ? `+${delta}` : String(delta);
      button.dataset.delta = String(delta);
      button.disabled = true;
      this._disposer.addEventListener(button, 'click', () => {
        if (!this._selectedPlayerId) return;
        this._onAdjustPlayerScore?.(this._selectedPlayerId, delta);
      });
      this._scoreBar.appendChild(button);
    }
  }

  _setSelectedPlayer(playerId) {
    const nextId = String(playerId ?? '');
    this._selectedPlayerId = this._selectedPlayerId === nextId ? null : nextId;
    this._fullView?.setSelectedPlayerId?.(this._selectedPlayerId);
    this._renderSelectionState();
  }

  _clearSelectedPlayer() {
    if (!this._selectedPlayerId) return;
    this._selectedPlayerId = null;
    this._fullView?.setSelectedPlayerId?.(this._selectedPlayerId);
    this._renderSelectionState();
  }

  _syncSelectedPlayer() {
    if (!this._selectedPlayerId) return;
    const stillExists = this._players.some((player) => String(player?.id ?? '') === this._selectedPlayerId);
    if (!stillExists) this._selectedPlayerId = null;
  }

  _renderSelectionState() {
    const selectedPlayer = this._players.find((player) => String(player?.id ?? '') === this._selectedPlayerId) || null;

    if (this._selectionText) {
      this._selectionText.textContent = selectedPlayer
        ? t('selected_player_label', { name: selectedPlayer.name || t('player_fallback') })
        : t('select_player_for_manual_score');
      this._selectionText.classList.toggle('is-placeholder', !selectedPlayer);
    }

    if (this._scoreBar) {
      for (const button of this._scoreBar.querySelectorAll('.leaderboard-panel__scoreBtn')) {
        button.disabled = !selectedPlayer;
      }
    }
  }

  _handleRoomInputCommit() {
    const nextUrl = setStoredLocalBuzzerUrl(this._roomInput?.value || '');
    this._localBuzzerUrl = nextUrl;
    if (this._roomInput) {
      this._roomInput.value = nextUrl;
    }
    this._renderBuzzerModeState();
    void this._generateQr();
  }

  _renderBuzzerModeState() {
    for (const button of this._modeButtons) {
      const mode = button.dataset.mode === 'local' ? 'local' : 'cloud';
      button.setAttribute('aria-pressed', String(this._buzzerMode === mode));
      button.classList.toggle('is-active', this._buzzerMode === mode);
    }

    const isLocal = this._buzzerMode === 'local';
    this._root.classList.toggle('is-local-room-mode', isLocal);
    this._root.classList.toggle('is-cloud-room-mode', !isLocal);

    if (this._roomInput) {
      this._roomInput.disabled = !isLocal;
    }

    if (this._roomHint) {
      this._roomHint.textContent = isLocal
        ? t('local_room_server_hint')
        : this._cloudBuzzerUrl
          ? t('cloud_room_server_hint')
          : t('cloud_room_server_missing');
    }

    if (this._localGuide) {
      this._localGuide.hidden = !isLocal;
    }
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
