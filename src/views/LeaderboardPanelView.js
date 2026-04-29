import QRCode from 'qrcode';
import { LeaderboardGridView } from './LeaderboardGridView.js';
import { ViewDisposer } from '../utils/disposer.js';
import { createModalController } from '../utils/ModalController.js';
import { createOverlayController } from '../utils/OverlayController.js';
import { t, withLanguageParam } from '../i18n.js';
import { getActiveBuzzerUrl } from '../utils/localBuzzerUrl.js';
import { escapeHtml } from '../utils/utils.js';

function formatLogTime(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export class LeaderboardPanelView {
  constructor({
    gameId,
    players = [],
    scoreLogs = [],
    onAdjustPlayerScore = null,
    onDeletePlayer = null,
    onExpandedChange = null,
    onScoreLogsOpenChange = null,
    readOnly = false,
    showQr = true
  } = {}) {
    this._gameId = gameId;
    this._players = Array.isArray(players) ? players : [];
    this._scoreLogs = Array.isArray(scoreLogs) ? scoreLogs : [];
    this._onAdjustPlayerScore = onAdjustPlayerScore;
    this._onDeletePlayer = onDeletePlayer;
    this._onExpandedChange = onExpandedChange;
    this._onScoreLogsOpenChange = onScoreLogsOpenChange;
    this._readOnly = !!readOnly;
    this._showQr = !!showQr;
    this._isExpanded = false;
    this._openQrDock = null;
    this._selectedPlayerId = null;
    this._isScoreLogsOpen = false;
    this._overlayHost = null;
    this._dockSignature = '';

    this._build();
    this._disposer = new ViewDisposer(this._root);
    this._disposer.autoDestroy();
    this._buildScoreLogsModal();
    this._buildScoreBar();
    this._wire();
    this._overlayController = createOverlayController({
      overlay: this._overlay,
      panel: this._root.querySelector('.leaderboard-panel__shell'),
      isOpen: () => this._isExpanded,
      onRequestClose: () => {
        this._setQrOpen(null);
        this.setScoreLogsOpen(false, { silent: true });
        this.setExpanded(false);
      },
    });
    if (this._overlay && this._overlay.parentElement !== document.body) {
      this._overlayHost = this._overlay.parentElement;
      document.body.appendChild(this._overlay);
    }
    this.updatePlayers(this._players);
  }

  get el() {
    return this._root;
  }

  updatePlayers(players = []) {
    const scoreChanges = this._collectScoreChanges(this._players, players);
    this._players = Array.isArray(players) ? players : [];
    this._syncSelectedPlayer();
    this._fullView?.update?.(this._players);
    this._fullView?.setSelectedPlayerId?.(this._selectedPlayerId);
    this._renderSelectionState();
    this._renderDockSummary();
    for (const change of scoreChanges) {
      this._fullView?.pulseScoreChange?.(change.playerId, change.delta);
    }
  }

  updateScoreLogs(logs = []) {
    this._scoreLogs = Array.isArray(logs) ? logs : [];
    this._renderScoreLogs();
  }

  toggleExpanded() {
    this.setExpanded(!this._isExpanded);
  }

  toggleScoreLogs() {
    this.setScoreLogsOpen(!this._isScoreLogsOpen);
  }

  openQr(kind) {
    const qrKind = kind === 'host' ? 'host' : kind === 'player' ? 'player' : null;
    if (!qrKind || !this._showQr) return;
    if (!this._isExpanded) this.setExpanded(true, { silent: true });
    this._setQrOpen(qrKind);
  }

  setExpanded(nextExpanded, { silent = false } = {}) {
    const isExpanded = !!nextExpanded;
    if (this._isExpanded === isExpanded) return;

    this._isExpanded = isExpanded;
    this._root.classList.toggle('is-expanded', isExpanded);
    this._overlay?.classList.toggle('is-open', isExpanded);
    if (this._dockBtn) this._dockBtn.setAttribute('aria-expanded', String(isExpanded));
    this._toggleChevron.classList.toggle('is-down', isExpanded);
    this._toggleBtn.setAttribute('aria-expanded', String(isExpanded));
    this._toggleBtn.setAttribute('aria-label', isExpanded ? t('close') : t('show_all_players'));
    this._toggleBtn.setAttribute('title', isExpanded ? t('close') : t('show_all_players'));
    if (!isExpanded) {
      this._setQrOpen(null);
      this.setScoreLogsOpen(false, { silent: true });
    }
    if (!silent) {
      this._onExpandedChange?.(isExpanded);
    }
  }

  setScoreLogsOpen(nextOpen, { silent = false } = {}) {
    const isOpen = !!nextOpen;
    if (this._isScoreLogsOpen === isOpen) return;
    this._isScoreLogsOpen = isOpen;
    if (isOpen) {
      this._scoreLogsModal?.open?.();
    } else {
      this._scoreLogsModal?.close?.();
    }
    this._root?.classList.toggle('is-score-logs-open', isOpen);
    if (!silent) this._onScoreLogsOpenChange?.(isOpen);
  }

  destroy() {
    this._overlayController?.destroy?.();
    this._overlayController = null;
    this._scoreLogsModal?.destroy?.();
    this._scoreLogsModal = null;
    this._fullView?.destroy?.();
    this._fullView = null;
    if (this._overlay && this._overlayHost && this._overlay.parentElement === document.body) {
      this._overlayHost.appendChild(this._overlay);
    }
    this._overlayHost = null;
    this._disposer?.destroy();
    this._root?.remove();
    this._root = null;
  }

  _build() {
    const root = document.createElement('footer');
    root.className = 'app-footer leaderboard-panel';
    root.classList.add('leaderboard-panel--overlayV2');
    if (!this._showQr) {
      root.classList.add('leaderboard-panel--noQr');
    }

    root.innerHTML = `
      <button
        class="leaderboard-panel__dock"
        type="button"
        aria-expanded="false"
        aria-label="${t('show_all_players')}"
        title="${t('show_all_players')}"
      >
        <span class="leaderboard-panel__dockTitle">${t('leaderboard')}</span>
        <div class="leaderboard-panel__dockSummary">${t('players')}</div>
      </button>

      <div class="leaderboard-panel__overlay leaderboard-panel__overlay--v2">
        <div class="leaderboard-panel__backdrop"></div>
        <section class="leaderboard-panel__shell" aria-label="${t('leaderboard')}">
          <div class="leaderboard-panel__headerBar">
          <button
            class="leaderboard__header leaderboard-panel__toggle leaderboard-panel__actionBtn"
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

          ${this._showQr ? `
          <div class="leaderboard-panel__qrDock leaderboard-panel__qrDock--left" data-qr-dock="host">
            <button
              class="leaderboard-panel__qrTrigger"
              type="button"
              aria-label="${t('host_controller')}"
              aria-expanded="false"
              title="${t('host_controller')}"
            >
              <svg class="leaderboard-panel__qrTriggerIcon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
                <path d="M16 14h2v2h-2zM18 16h2v2h-2zM14 18h2v2h-2zM16 20h4M20 14v2" />
              </svg>
            </button>

            <div class="leaderboard-panel__qrPopover" role="dialog" aria-label="${t('host_controller')}" aria-hidden="true">
              <p class="leaderboard-panel__eyebrow">${t('host_controller')}</p>
              <div class="leaderboard-panel__qrWrap">
                <div class="leaderboard-panel__qrGlow"></div>
                <img class="leaderboard-panel__qrImg leaderboard-panel__hostQrImg" alt="${t('host_controller_qr_alt')}">
              </div>
              <p class="leaderboard-panel__copy">${t('scan_host_qr')}</p>
            </div>
          </div>

          <div class="leaderboard-panel__qrDock leaderboard-panel__qrDock--right" data-qr-dock="player">
            <button
              class="leaderboard-panel__qrTrigger"
              type="button"
              aria-label="${t('join_from_phone')}"
              aria-expanded="false"
              title="${t('join_from_phone')}"
            >
              <svg class="leaderboard-panel__qrTriggerIcon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" />
                <path d="M16 14h2v2h-2zM18 16h2v2h-2zM14 18h2v2h-2zM16 20h4M20 14v2" />
              </svg>
            </button>

            <div class="leaderboard-panel__qrPopover" role="dialog" aria-label="${t('join_from_phone')}" aria-hidden="true">
              <p class="leaderboard-panel__eyebrow">${t('join_from_phone')}</p>
              <div class="leaderboard-panel__qrWrap">
                <div class="leaderboard-panel__qrGlow"></div>
                <img class="leaderboard-panel__qrImg leaderboard-panel__playerQrImg" alt="${t('player_controller_qr_alt')}">
              </div>
              <p class="leaderboard-panel__copy">${t('scan_player_qr')}</p>
            </div>
          </div>
          ` : ''}
          </div>

          <div class="leaderboard-panel__expanded is-open">
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
      </div>
    `;

    this._root = root;
    this._dockBtn = root.querySelector('.leaderboard-panel__dock');
    this._dockSummary = root.querySelector('.leaderboard-panel__dockSummary');
    this._overlay = root.querySelector('.leaderboard-panel__overlay');
    this._backdrop = root.querySelector('.leaderboard-panel__backdrop');
    this._toggleBtn = root.querySelector('.leaderboard-panel__toggle');
    this._toggleChevron = root.querySelector('.leaderboard-panel__titleChevron');
    this._qrDocks = Array.from(root.querySelectorAll('.leaderboard-panel__qrDock'));
    this._boardMount = root.querySelector('.leaderboard-panel__boardMount');
    this._selectionText = root.querySelector('.leaderboard-panel__selectionText');
    this._scoreBar = root.querySelector('.leaderboard-panel__scoreBar');
    this._playerQrImg = root.querySelector('.leaderboard-panel__playerQrImg');
    this._hostQrImg = root.querySelector('.leaderboard-panel__hostQrImg');

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
    this._renderScoreLogs();
    this._renderDockSummary();
  }

  _buildScoreLogsModal() {
    this._scoreLogsModal = createModalController({
      modalClassName: 'qmodal--scoreLogs',
      dialogClassName: 'qmodal__dialog--scoreLogs',
      ariaLabel: t('score_logs'),
      onRequestClose: () => this.setScoreLogsOpen(false),
    });

    const content = document.createElement('section');
    content.className = 'leaderboard-panel__logsModalContent';
    content.innerHTML = `
      <header class="leaderboard-panel__logsModalHeader">
        <h2 class="leaderboard-panel__logsModalTitle">${t('score_logs')}</h2>
        <button class="qmodal__btn qmodal__btn--secondary qmodal__btn--compact qmodal__btn--icon qmodal__btn--circle leaderboard-panel__logsModalClose" type="button" aria-label="${t('close')}" title="${t('close')}">
          <span aria-hidden="true">✕</span>
        </button>
      </header>
      <div class="leaderboard-panel__logsModalBody">
        <div class="leaderboard-panel__logsList">
          <div class="leaderboard-panel__logsListTrack">
            <div class="leaderboard-panel__logsItems"></div>
            <div class="leaderboard-panel__logsListSpacer" aria-hidden="true"></div>
          </div>
        </div>
      </div>
    `;
    this._scoreLogsModal.setContent(content);
    this._logsList = content.querySelector('.leaderboard-panel__logsItems');
    const closeBtn = content.querySelector('.leaderboard-panel__logsModalClose');
    this._disposer.addEventListener(closeBtn, 'click', () => this.setScoreLogsOpen(false));
  }

  async _generateQr() {
    if (!this._showQr || !this._gameId || !this._playerQrImg) return;

    const playerUrl = new URL(withLanguageParam(`${import.meta.env.BASE_URL}player.html?gameId=${this._gameId}`));
    const hostControllerUrl = new URL(withLanguageParam(`${import.meta.env.BASE_URL}host-controller.html?gameId=${this._gameId}`));
    const buzzerUrl = getActiveBuzzerUrl();
    if (buzzerUrl) {
      playerUrl.searchParams.set('buzzer', buzzerUrl);
      hostControllerUrl.searchParams.set('buzzer', buzzerUrl);
    } else {
      playerUrl.searchParams.delete('buzzer');
      hostControllerUrl.searchParams.delete('buzzer');
    }

    try {
      this._playerQrImg.src = await QRCode.toDataURL(playerUrl.toString(), {
        width: 512,
        margin: 2,
        color: { dark: '#f8fafc', light: '#111827' },
      });
      if (this._hostQrImg) {
        this._hostQrImg.src = await QRCode.toDataURL(hostControllerUrl.toString(), {
          width: 512,
          margin: 2,
          color: { dark: '#f8fafc', light: '#111827' },
        });
      }
    } catch (error) {
      console.error('[LeaderboardPanelView] QR generation failed:', error);
    }
  }

  _wire() {
    this._disposer.addEventListener(this._dockBtn, 'click', () => this.toggleExpanded());
    this._disposer.addEventListener(this._toggleBtn, 'click', () => this.setExpanded(false));
    if (this._showQr) {
      for (const dock of this._qrDocks) {
        const trigger = dock.querySelector('.leaderboard-panel__qrTrigger');
        const kind = dock.dataset.qrDock || '';
        this._disposer.addEventListener(trigger, 'click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!this._isExpanded || !kind) return;
          this._setQrOpen(this._openQrDock === kind ? null : kind);
        });
      }
    }

    this._disposer.addEventListener(this._root.querySelector('.leaderboard-panel__shell'), 'pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (this._isExpanded && this._openQrDock && !target.closest('.leaderboard-panel__qrDock')) {
        this._setQrOpen(null);
      }
      if (!this._isExpanded || !this._selectedPlayerId) return;
      if (target.closest('.leaderboard__rowWrap, .leaderboard__row')) return;
      if (target.closest('.leaderboard-panel__scoreBar, .leaderboard-panel__qrDock, .leaderboard-panel__toggle, .leaderboard-panel__logsModalContent, .hdr-settings, .hdr-settings-menu')) return;

      this._clearSelectedPlayer();
    }, true);

  }

  _renderScoreLogs() {
    if (!this._logsList) return;
    if (!this._scoreLogs.length) {
      this._logsList.innerHTML = `<p class="leaderboard-panel__copy">${t('score_logs_empty')}</p>`;
      return;
    }

    this._logsList.innerHTML = this._scoreLogs.map((entry) => `
      <article class="leaderboard-panel__logItem">
        <p class="leaderboard-panel__logMain">
          <strong>${escapeHtml(entry.playerName || t('player_fallback'))}</strong>
          <span>${escapeHtml(`${entry.cellLabel || ''}${entry.outcome ? `, ${entry.outcome === 'correct' ? t('correct') : t('not_correct')}` : ''}`)}</span>
        </p>
        <p class="leaderboard-panel__logTime">${escapeHtml(formatLogTime(entry.happenedAt))}</p>
      </article>
    `).join('');
  }

  _setQrOpen(kind) {
    if (!this._showQr) return;
    this._openQrDock = kind || null;
    for (const dock of this._qrDocks) {
      const dockKind = dock.dataset.qrDock || '';
      const isOpen = !!this._openQrDock && this._openQrDock === dockKind;
      dock.classList.toggle('is-open', isOpen);
      dock.querySelector('.leaderboard-panel__qrTrigger')?.setAttribute('aria-expanded', String(isOpen));
      dock.querySelector('.leaderboard-panel__qrPopover')?.setAttribute('aria-hidden', String(!isOpen));
    }
  }

  _buildScoreBar() {
    const deltas = [-500, -400, -300, -200, -100, 100, 200, 300, 400, 500];
    for (const delta of deltas) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'leaderboard-panel__scoreBtn leaderboard-panel__actionBtn';
      button.textContent = delta > 0 ? `+${delta}` : String(delta);
      button.dataset.delta = String(delta);
      button.disabled = true;
      this._disposer.addEventListener(button, 'click', async () => {
        this._animateScoreButton(button, 'is-hit');
        if (this._readOnly) return;
        if (!this._selectedPlayerId) return;
        button.classList.add('is-pending');
        try {
          await this._onAdjustPlayerScore?.(this._selectedPlayerId, delta);
        } finally {
          button.classList.remove('is-pending');
        }
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
        button.disabled = this._readOnly || !selectedPlayer;
      }
    }
  }

  _renderDockSummary() {
    if (!this._dockSummary) return;
    if (!Array.isArray(this._players) || !this._players.length) {
      const emptySignature = '__empty__';
      if (this._dockSignature !== emptySignature) {
        this._dockSummary.innerHTML = `
          <div class="leaderboard-panel__dockEmpty">${escapeHtml(t('no_players_available'))}</div>
        `;
        this._dockSignature = emptySignature;
      }
      return;
    }
    const getPlayerScore = (player) => Number(player?.points ?? player?.score) || 0;
    const leaders = this._players
      .slice()
      .sort((a, b) => getPlayerScore(b) - getPlayerScore(a))
      .slice(0, 5)
      .map((player, index) => ({
        rank: index + 1,
        name: player?.name || t('player_fallback'),
        score: getPlayerScore(player),
      }));

    const nextSignature = JSON.stringify(leaders);
    if (nextSignature === this._dockSignature) return;
    this._dockSignature = nextSignature;

    this._dockSummary.innerHTML = `
      <div class="leaderboard-panel__dockList">
        ${leaders.map((entry) => `
          <article class="leaderboard-panel__dockItem">
            <span class="leaderboard-panel__dockRank">${entry.rank}</span>
            <span class="leaderboard-panel__dockName">${escapeHtml(entry.name)}</span>
            <span class="leaderboard-panel__dockScore">${entry.score}</span>
          </article>
        `).join('')}
      </div>
    `;
  }

  _collectScoreChanges(prevPlayers = [], nextPlayers = []) {
    const prevById = new Map();
    for (const player of (Array.isArray(prevPlayers) ? prevPlayers : [])) {
      const id = String(player?.id ?? '');
      if (!id) continue;
      prevById.set(id, Number(player?.points ?? player?.score) || 0);
    }

    const changes = [];
    for (const player of (Array.isArray(nextPlayers) ? nextPlayers : [])) {
      const id = String(player?.id ?? '');
      if (!id || !prevById.has(id)) continue;
      const prevScore = Number(prevById.get(id)) || 0;
      const nextScore = Number(player?.points ?? player?.score) || 0;
      const delta = nextScore - prevScore;
      if (!delta) continue;
      changes.push({ playerId: id, delta });
    }
    return changes;
  }

  _animateScoreButton(button, className) {
    if (!button || !className) return;
    button.classList.remove(className);
    // Force reflow so fast consecutive clicks still replay the animation.
    void button.offsetWidth;
    button.classList.add(className);
  }

}
