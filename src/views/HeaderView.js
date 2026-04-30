import { escapeHtml } from '../utils/utils.js';
import QRCode from 'qrcode';
import { t, withLanguageParam } from '../i18n.js';
import { getActiveBuzzerUrl } from '../utils/localBuzzerUrl.js';
import { createOverlayController } from '../utils/OverlayController.js';

function formatLogTime(iso) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function buildLogMetaParts(entry = {}, { t }) {
  const rawLabel = String(entry?.cellLabel || '');
  const delta = Number(entry?.delta) || 0;
  const hasDelta = delta !== 0;
  const deltaText = hasDelta ? `${delta > 0 ? '+' : '-'}${Math.abs(delta)}` : '';
  const deltaClass = delta > 0 ? 'is-positive' : delta < 0 ? 'is-negative' : '';
  const labelWithoutDelta = hasDelta
    ? rawLabel.replace(/\s*\/\s*[+-]\d+\s*$/u, '').trim()
    : rawLabel;
  const outcomeType = entry?.outcome === 'correct'
    ? 'correct'
    : entry?.outcome === 'incorrect'
      ? 'incorrect'
      : null;
  const reasonText = `${labelWithoutDelta}`;
  const scoreRangeText = Number.isFinite(Number(entry?.scoreBefore)) && Number.isFinite(Number(entry?.scoreAfter))
    ? `${Number(entry.scoreBefore)}→${Number(entry.scoreAfter)}`
    : '';
  return { reasonText, outcomeType, deltaText, deltaClass, scoreRangeText };
}

function resolveCurrentPlayer(players = [], currentPlayerId = null) {
  return (Array.isArray(players) ? players : []).find((player) => String(player?.id) === String(currentPlayerId)) || null;
}

export function HeaderView({
  uiState,
  gameId = '',
  showQrInSettings = false,
  players = [],
  scoreLogs = [],
  currentPlayerId = null,
  onBackToLobby,
  onRoundClick,
  onCurrentPlayerChange,
  onGameModeToggle,
  onClearScoreLogs,
}) {
  const el = document.createElement('header');
  el.className = 'app-header';

  let currentPlayers = Array.isArray(players) ? players.slice() : [];
  let currentChooserId = currentPlayerId ? String(currentPlayerId) : null;
  let isChooserMenuOpen = false;
  let isSettingsOpen = false;
  let currentScoreLogs = Array.isArray(scoreLogs) ? scoreLogs.slice() : [];
  let scoreLogsSignature = '';
  const canBackToLobby = typeof onBackToLobby === 'function';
  const canToggleGameMode = typeof onGameModeToggle === 'function';
  const canShowQr = !!showQrInSettings && !!gameId;
  let currentGameMode = String(uiState?.gameMode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play';
  let lastModeLabel = '';
  let chooserMenuSignature = '';
  let chooserSummarySignature = '';

  el.innerHTML = `
    <div class="hdr-left">
      ${canBackToLobby ? `<button class="hdr-lobby-btn" type="button" title="${escapeHtml(t('back_to_lobby'))}">← ${escapeHtml(t('lobby'))}</button>` : ''}
      <button class="round-indicator" type="button" title="${escapeHtml(t('switch_round'))}">
        ${escapeHtml(t('round'))}: <b class="js-round-value"></b>
      </button>
    </div>
    <div class="hdr-center">
      <div class="hdr-current-player hdr-current-player--center">
        <button
          class="hdr-current-player-btn hdr-current-player-btn--center"
          type="button"
          aria-haspopup="true"
          aria-expanded="false"
          title="${escapeHtml(t('choose_current_player'))}"
        >
          <span class="hdr-current-player-top">
            <span class="hdr-current-player-kicker">${escapeHtml(t('current_player_label'))}</span>
            <span class="hdr-current-player-caret" aria-hidden="true">▾</span>
          </span>
          <strong class="js-current-player-value"></strong>
          <span class="js-current-player-score"></span>
        </button>
        <div class="hdr-current-player-menu" hidden>
          <div class="hdr-current-player-list"></div>
        </div>
      </div>
    </div>
    <div class="hdr-right">
      <div class="hdr-settings">
        <button class="hdr-settings-btn" type="button" aria-haspopup="true" aria-expanded="false" title="${escapeHtml(t('settings'))}" aria-label="${escapeHtml(t('settings'))}">
          <svg class="hdr-settings-icon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M12 8.25a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z"/>
            <path d="M19.5 12a7.5 7.5 0 0 0-.12-1.31l2.02-1.57-1.92-3.32-2.45.72a7.67 7.67 0 0 0-2.27-1.31L14.25 2h-4.5l-.51 3.21a7.67 7.67 0 0 0-2.27 1.31l-2.45-.72-1.92 3.32 2.02 1.57A7.5 7.5 0 0 0 4.5 12c0 .45.04.89.12 1.31L2.6 14.88l1.92 3.32 2.45-.72c.69.56 1.45 1 2.27 1.31L9.75 22h4.5l.51-3.21c.82-.31 1.58-.75 2.27-1.31l2.45.72 1.92-3.32-2.02-1.57c.08-.42.12-.86.12-1.31Z"/>
          </svg>
        </button>
        <div class="hdr-settings-overlay" hidden>
          <div class="hdr-settings-overlayBackdrop"></div>
          <div class="hdr-settings-menu" role="dialog" aria-label="${escapeHtml(t('settings'))}">
            ${canToggleGameMode ? `
            <button class="hdr-settings-qrBtn js-settings-mode" type="button"></button>
            ` : ''}
            ${canShowQr ? `
            <div class="hdr-settings-qrRow">
              <button class="hdr-settings-qrBtn" type="button" data-action="host-qr" title="${escapeHtml(t('connect_host'))}" aria-label="${escapeHtml(t('connect_host'))}">
                <span>${escapeHtml(t('connect_host'))}</span>
              </button>
              <button class="hdr-settings-qrBtn" type="button" data-action="player-qr" title="${escapeHtml(t('connect_player'))}" aria-label="${escapeHtml(t('connect_player'))}">
                <span>${escapeHtml(t('connect_player'))}</span>
              </button>
            </div>
            ` : ''}
            <section class="hdr-settings-logs" aria-label="${escapeHtml(t('score_logs'))}">
              <div class="hdr-settings-logsHead">
                <p class="hdr-settings-logsTitle">${escapeHtml(t('score_logs'))}</p>
                <button class="hdr-settings-logsClearBtn" type="button" data-action="clear-score-logs" title="${escapeHtml(t('clear_score_logs'))}" aria-label="${escapeHtml(t('clear_score_logs'))}">
                  ${escapeHtml(t('clear'))}
                </button>
              </div>
              <div class="hdr-settings-logsListWrap">
                <div class="hdr-settings-logsList"></div>
                <div class="hdr-settings-logsSpacer" aria-hidden="true"></div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
    <div class="hdr-qrOverlay" hidden>
      <div class="hdr-qrOverlayBackdrop"></div>
      <div class="hdr-qrOverlayCard">
        <img class="hdr-qrOverlayImg" alt="">
        <p class="hdr-qrOverlayHint"></p>
      </div>
    </div>
  `;

  const roundValueEl = el.querySelector('.js-round-value');
  const chooserValueEl = el.querySelector('.js-current-player-value');
  const chooserScoreEl = el.querySelector('.js-current-player-score');
  const chooserBtnEl = el.querySelector('.hdr-current-player-btn');
  const chooserMenuEl = el.querySelector('.hdr-current-player-menu');
  const chooserListEl = el.querySelector('.hdr-current-player-list');
  const settingsBtnEl = el.querySelector('.hdr-settings-btn');
  const settingsOverlayEl = el.querySelector('.hdr-settings-overlay');
  const settingsMenuEl = el.querySelector('.hdr-settings-menu');
  const settingsLogsListEl = el.querySelector('.hdr-settings-logsList');
  const settingsModeBtnEl = el.querySelector('.js-settings-mode');
  const qrOverlayEl = el.querySelector('.hdr-qrOverlay');
  const qrOverlayImgEl = el.querySelector('.hdr-qrOverlayImg');
  const qrOverlayHintEl = el.querySelector('.hdr-qrOverlayHint');
  const qrButtons = Array.from(el.querySelectorAll('.hdr-settings-qrBtn'));
  let hostQrDataUrl = '';
  let playerQrDataUrl = '';
  let settingsOverlayController = null;
  let qrOverlayController = null;
  let settingsOverlayHost = null;
  let qrOverlayHost = null;

  function closeChooserMenu() {
    isChooserMenuOpen = false;
    chooserMenuEl.hidden = true;
    chooserBtnEl.setAttribute('aria-expanded', 'false');
  }

  function openChooserMenu() {
    isChooserMenuOpen = true;
    chooserMenuEl.hidden = false;
    chooserBtnEl.setAttribute('aria-expanded', 'true');
  }

  function closeSettingsMenu() {
    if (!settingsBtnEl || !settingsMenuEl || !settingsOverlayEl) return;
    isSettingsOpen = false;
    settingsOverlayEl.hidden = true;
    settingsBtnEl.setAttribute('aria-expanded', 'false');
  }

  function openSettingsMenu() {
    if (!settingsBtnEl || !settingsMenuEl || !settingsOverlayEl) return;
    isSettingsOpen = true;
    settingsOverlayEl.hidden = false;
    settingsBtnEl.setAttribute('aria-expanded', 'true');
  }

  function renderChooserMenu() {
    if (!chooserListEl) return;

    if (!currentPlayers.length) {
      const emptySignature = '__empty__';
      if (chooserMenuSignature === emptySignature) return;
      chooserListEl.innerHTML = `<p class="hdr-current-player-empty">${escapeHtml(t('no_players_available'))}</p>`;
      chooserMenuSignature = emptySignature;
      return;
    }

    const nextSignature = JSON.stringify({
      currentChooserId: String(currentChooserId || ''),
      players: currentPlayers.map((player) => ({
        id: String(player?.id || ''),
        name: String(player?.name || ''),
        points: Number(player?.points) || 0,
      })),
    });
    if (nextSignature === chooserMenuSignature) return;

    chooserListEl.innerHTML = currentPlayers.map((player) => {
      const isActive = String(player?.id) === String(currentChooserId);
      return `
        <button
          class="hdr-current-player-option${isActive ? ' is-active' : ''}"
          type="button"
          data-player-id="${escapeHtml(String(player?.id || ''))}"
        >
          <span class="hdr-current-player-optionName">${escapeHtml(player?.name || t('player_fallback'))}</span>
          <span class="hdr-current-player-optionScore">${escapeHtml(String(Number(player?.points) || 0))}</span>
        </button>
      `;
    }).join('');
    chooserMenuSignature = nextSignature;
  }

  function renderChooserSummary() {
    const currentPlayer = resolveCurrentPlayer(currentPlayers, currentChooserId);
    const nextSignature = JSON.stringify({
      id: String(currentPlayer?.id || ''),
      name: String(currentPlayer?.name || ''),
      points: currentPlayer ? Number(currentPlayer?.points) || 0 : null,
    });
    if (nextSignature === chooserSummarySignature) return;

    chooserValueEl.textContent = currentPlayer?.name || t('choose_current_player');
    chooserScoreEl.textContent = currentPlayer ? String(Number(currentPlayer?.points) || 0) : '—';
    chooserBtnEl.classList.toggle('is-unset', !currentPlayer);
    chooserSummarySignature = nextSignature;
  }

  function update(next = {}) {
    const ui = next?.uiState ?? uiState;
    const displayRound = ui?.isRoundTransitioning
      ? (ui?.pendingRoundId ?? ui?.activeRoundId ?? 0)
      : (ui?.activeRoundId ?? 0);
    roundValueEl.textContent = String(displayRound + 1);
    currentGameMode = String(ui?.gameMode || currentGameMode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play';
    if (settingsModeBtnEl) {
      const nextModeLabel = currentGameMode === 'edit' ? t('mode_edit') : t('mode_play');
      if (nextModeLabel !== lastModeLabel) {
        settingsModeBtnEl.textContent = nextModeLabel;
        lastModeLabel = nextModeLabel;
      }
    }
    el.classList.toggle('app-header--editMode', currentGameMode === 'edit');

    if (Array.isArray(next?.players)) currentPlayers = next.players.slice();
    if (Array.isArray(next?.scoreLogs)) currentScoreLogs = next.scoreLogs.slice();
    if (Object.prototype.hasOwnProperty.call(next, 'currentPlayerId')) {
      currentChooserId = next.currentPlayerId ? String(next.currentPlayerId) : null;
    }

    renderChooserSummary();
    renderChooserMenu();
    renderScoreLogs();
  }

  function renderScoreLogs() {
    if (!settingsLogsListEl) return;
    const hasLogs = Array.isArray(currentScoreLogs) && currentScoreLogs.length > 0;
    if (!hasLogs) {
      const emptySignature = '__empty__';
      if (scoreLogsSignature === emptySignature) return;
      settingsLogsListEl.innerHTML = `<p class="leaderboard-panel__copy">${escapeHtml(t('score_logs_empty'))}</p>`;
      scoreLogsSignature = emptySignature;
      return;
    }

    const nextSignature = JSON.stringify(currentScoreLogs);
    if (nextSignature === scoreLogsSignature) return;

    settingsLogsListEl.innerHTML = currentScoreLogs.map((entry) => {
      const meta = buildLogMetaParts(entry, { t });
      const hasPill = !!meta.scoreRangeText;
      const hasRange = !!meta.scoreRangeText;
      return `
      <article class="leaderboard-panel__logItem">
        <p class="leaderboard-panel__logTop">
          <strong>${escapeHtml(entry?.playerName || t('player_fallback'))}</strong>
          <span class="leaderboard-panel__logTime">${escapeHtml(formatLogTime(entry?.happenedAt))}</span>
        </p>
        <p class="leaderboard-panel__logSub">
          <span class="leaderboard-panel__logReason">
            ${escapeHtml(meta.reasonText)}
            ${meta.outcomeType === 'correct' ? '<span class="leaderboard-panel__logOutcomeMark is-correct" aria-label="Correct" title="Correct">✓</span>' : ''}
            ${meta.outcomeType === 'incorrect' ? '<span class="leaderboard-panel__logOutcomeMark is-incorrect" aria-label="Incorrect" title="Incorrect">✕</span>' : ''}
            ${meta.deltaText ? `<span class="hdr-settings-logDelta ${meta.deltaClass}">${escapeHtml(meta.deltaText)}</span>` : ''}
          </span>
          ${hasPill ? `
            <span class="leaderboard-panel__logDeltaPill">
              ${hasRange ? `<span class="leaderboard-panel__logRange">${escapeHtml(meta.scoreRangeText)}</span>` : ''}
            </span>
          ` : ''}
        </p>
      </article>
    `;
    }).join('');
    scoreLogsSignature = nextSignature;
  }

  function handleDocumentPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest('.hdr-qrOverlay')) return;
    if (isChooserMenuOpen && !target.closest('.hdr-current-player')) closeChooserMenu();
  }

  function handleDocumentKeyDown(event) {
    if (event.key !== 'Escape') return;
    closeChooserMenu();
    closeSettingsMenu();
  }

  chooserBtnEl.addEventListener('click', () => {
    if (isChooserMenuOpen) closeChooserMenu();
    else openChooserMenu();
  });

  chooserListEl.addEventListener('click', (event) => {
    const button = event.target.closest('[data-player-id]');
    if (!button) return;
    closeChooserMenu();
    onCurrentPlayerChange?.(button.dataset.playerId || null);
  });

  settingsBtnEl?.addEventListener('click', () => {
    if (isSettingsOpen) closeSettingsMenu();
    else openSettingsMenu();
  });
  settingsMenuEl?.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    const action = button.dataset.action || '';
    if (button.classList.contains('js-settings-mode')) {
      onGameModeToggle?.(currentGameMode === 'edit' ? 'play' : 'edit');
      return;
    }
    if (action === 'host-qr' || action === 'player-qr') {
      showQrOverlay(action);
      return;
    }
    if (action === 'clear-score-logs') {
      onClearScoreLogs?.();
      return;
    }
  });
  settingsOverlayController = createOverlayController({
    overlay: settingsOverlayEl,
    panel: settingsMenuEl,
    isOpen: () => isSettingsOpen,
    onRequestClose: () => closeSettingsMenu(),
  });
  qrOverlayController = createOverlayController({
    overlay: qrOverlayEl,
    panel: el.querySelector('.hdr-qrOverlayCard'),
    isOpen: () => !qrOverlayEl?.hidden,
    onRequestClose: () => hideQrOverlay(),
  });

  // Render overlays at document level so they always cover the whole viewport
  // and are not constrained by header stacking contexts.
  if (settingsOverlayEl && settingsOverlayEl.parentElement !== document.body) {
    settingsOverlayHost = settingsOverlayEl.parentElement;
    document.body.appendChild(settingsOverlayEl);
  }
  if (qrOverlayEl && qrOverlayEl.parentElement !== document.body) {
    qrOverlayHost = qrOverlayEl.parentElement;
    document.body.appendChild(qrOverlayEl);
  }
  el.querySelector('.hdr-lobby-btn')?.addEventListener('click', () => onBackToLobby?.());
  el.querySelector('.round-indicator').addEventListener('click', () => onRoundClick?.());
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleDocumentKeyDown);

  update({ uiState, players: currentPlayers, currentPlayerId: currentChooserId });
  void renderQrs();

  async function renderQrs() {
    if (!canShowQr) return;
    const playerUrl = new URL(withLanguageParam(`${import.meta.env.BASE_URL}player.html?gameId=${gameId}`), window.location.origin);
    const hostUrl = new URL(withLanguageParam(`${import.meta.env.BASE_URL}host-controller.html?gameId=${gameId}`), window.location.origin);
    const buzzerUrl = getActiveBuzzerUrl();
    if (buzzerUrl) {
      playerUrl.searchParams.set('buzzer', buzzerUrl);
      hostUrl.searchParams.set('buzzer', buzzerUrl);
    }
    try {
      playerQrDataUrl = await QRCode.toDataURL(playerUrl.toString(), {
        width: 420,
        margin: 2,
        color: { dark: '#f8fafc', light: '#111827' },
      });
      hostQrDataUrl = await QRCode.toDataURL(hostUrl.toString(), {
        width: 420,
        margin: 2,
        color: { dark: '#f8fafc', light: '#111827' },
      });
    } catch (error) {
      console.warn('[HeaderView] settings QR generation failed:', error);
    }
  }

  function showQrOverlay(kind) {
    if (!qrOverlayEl || !qrOverlayImgEl) return;
    const isHost = kind === 'host-qr';
    const src = isHost ? hostQrDataUrl : playerQrDataUrl;
    if (!src) return;
    qrOverlayImgEl.src = src;
    qrOverlayImgEl.alt = isHost ? t('host_controller_qr_alt') : t('player_controller_qr_alt');
    if (qrOverlayHintEl) {
      qrOverlayHintEl.textContent = isHost ? t('scan_host_qr') : t('scan_player_qr');
    }
    qrOverlayEl.hidden = false;
  }

  function hideQrOverlay() {
    if (!qrOverlayEl) return;
    qrOverlayEl.hidden = true;
  }

  return {
    el,
    update,
    destroy() {
      hideQrOverlay();
      if (settingsOverlayEl && settingsOverlayHost && settingsOverlayEl.parentElement === document.body) {
        settingsOverlayHost.appendChild(settingsOverlayEl);
      }
      if (qrOverlayEl && qrOverlayHost && qrOverlayEl.parentElement === document.body) {
        qrOverlayHost.appendChild(qrOverlayEl);
      }
      settingsOverlayController?.destroy?.();
      qrOverlayController?.destroy?.();
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    },
  };
}
