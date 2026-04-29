import { escapeHtml } from '../utils/utils.js';
import QRCode from 'qrcode';
import { t, withLanguageParam } from '../i18n.js';
import { getActiveBuzzerUrl } from '../utils/localBuzzerUrl.js';

function resolveCurrentPlayer(players = [], currentPlayerId = null) {
  return (Array.isArray(players) ? players : []).find((player) => String(player?.id) === String(currentPlayerId)) || null;
}

export function HeaderView({
  uiState,
  gameId = '',
  showQrInSettings = false,
  players = [],
  currentPlayerId = null,
  onBackToLobby,
  onRoundClick,
  onScoreLogsClick,
  onCurrentPlayerChange,
  onGameModeToggle,
}) {
  const el = document.createElement('header');
  el.className = 'app-header';

  let currentPlayers = Array.isArray(players) ? players.slice() : [];
  let currentChooserId = currentPlayerId ? String(currentPlayerId) : null;
  let isChooserMenuOpen = false;
  let isSettingsOpen = false;
  const canBackToLobby = typeof onBackToLobby === 'function';
  const canOpenScoreLogs = typeof onScoreLogsClick === 'function';
  const canToggleGameMode = typeof onGameModeToggle === 'function';
  const canShowQr = !!showQrInSettings && !!gameId;
  let currentGameMode = String(uiState?.gameMode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play';

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
          <span class="hdr-current-player-kicker">${escapeHtml(t('current_player_label'))}</span>
          <strong class="js-current-player-value"></strong>
          <span class="hdr-current-player-caret" aria-hidden="true">▾</span>
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
        <div class="hdr-settings-menu" hidden>
          ${canToggleGameMode ? `
          <button class="hdr-settings-item js-settings-mode" type="button"></button>
          ` : ''}
          ${canOpenScoreLogs ? `
          <button class="hdr-settings-item" type="button" data-action="logs">${escapeHtml(t('score_logs'))}</button>
          ` : ''}
          ${canShowQr ? `
          <div class="hdr-settings-qrSection">
            <p class="hdr-settings-qrTitle">${escapeHtml(t('host_controller'))}</p>
            <img class="hdr-settings-qrImg js-host-qr" alt="${escapeHtml(t('host_controller_qr_alt'))}">
            <p class="hdr-settings-qrHint">${escapeHtml(t('scan_host_qr'))}</p>
          </div>
          <div class="hdr-settings-qrSection">
            <p class="hdr-settings-qrTitle">${escapeHtml(t('join_from_phone'))}</p>
            <img class="hdr-settings-qrImg js-player-qr" alt="${escapeHtml(t('player_controller_qr_alt'))}">
            <p class="hdr-settings-qrHint">${escapeHtml(t('scan_player_qr'))}</p>
          </div>
          ` : ''}
        </div>
      </div>
    </div>
  `;

  const roundValueEl = el.querySelector('.js-round-value');
  const chooserValueEl = el.querySelector('.js-current-player-value');
  const chooserBtnEl = el.querySelector('.hdr-current-player-btn');
  const chooserMenuEl = el.querySelector('.hdr-current-player-menu');
  const chooserListEl = el.querySelector('.hdr-current-player-list');
  const settingsBtnEl = el.querySelector('.hdr-settings-btn');
  const settingsMenuEl = el.querySelector('.hdr-settings-menu');
  const settingsModeBtnEl = el.querySelector('.js-settings-mode');
  const hostQrImgEl = el.querySelector('.js-host-qr');
  const playerQrImgEl = el.querySelector('.js-player-qr');

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
    if (!settingsBtnEl || !settingsMenuEl) return;
    isSettingsOpen = false;
    settingsMenuEl.hidden = true;
    settingsBtnEl.setAttribute('aria-expanded', 'false');
  }

  function openSettingsMenu() {
    if (!settingsBtnEl || !settingsMenuEl) return;
    isSettingsOpen = true;
    settingsMenuEl.hidden = false;
    settingsBtnEl.setAttribute('aria-expanded', 'true');
  }

  function renderChooserMenu() {
    if (!chooserListEl) return;

    if (!currentPlayers.length) {
      chooserListEl.innerHTML = `<p class="hdr-current-player-empty">${escapeHtml(t('no_players_available'))}</p>`;
      return;
    }

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
  }

  function renderChooserSummary() {
    const currentPlayer = resolveCurrentPlayer(currentPlayers, currentChooserId);
    chooserValueEl.textContent = currentPlayer?.name || t('choose_current_player');
    chooserBtnEl.classList.toggle('is-unset', !currentPlayer);
  }

  function update(next = {}) {
    const ui = next?.uiState ?? uiState;
    const displayRound = ui?.isRoundTransitioning
      ? (ui?.pendingRoundId ?? ui?.activeRoundId ?? 0)
      : (ui?.activeRoundId ?? 0);
    roundValueEl.textContent = String(displayRound + 1);
    currentGameMode = String(ui?.gameMode || currentGameMode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play';
    if (settingsModeBtnEl) {
      settingsModeBtnEl.textContent = currentGameMode === 'edit' ? t('mode_edit') : t('mode_play');
    }
    el.classList.toggle('app-header--editMode', currentGameMode === 'edit');

    if (Array.isArray(next?.players)) currentPlayers = next.players.slice();
    if (Object.prototype.hasOwnProperty.call(next, 'currentPlayerId')) {
      currentChooserId = next.currentPlayerId ? String(next.currentPlayerId) : null;
    }

    renderChooserSummary();
    renderChooserMenu();
  }

  function handleDocumentPointerDown(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (isChooserMenuOpen && !target.closest('.hdr-current-player')) closeChooserMenu();
    if (isSettingsOpen && !target.closest('.hdr-settings')) closeSettingsMenu();
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
      closeSettingsMenu();
      return;
    }
    if (action === 'logs') onScoreLogsClick?.();
    closeSettingsMenu();
  });
  el.querySelector('.hdr-lobby-btn')?.addEventListener('click', () => onBackToLobby?.());
  el.querySelector('.round-indicator').addEventListener('click', () => onRoundClick?.());
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleDocumentKeyDown);

  update({ uiState, players: currentPlayers, currentPlayerId: currentChooserId });
  void renderQrs();

  async function renderQrs() {
    if (!canShowQr || !hostQrImgEl || !playerQrImgEl) return;
    const playerUrl = new URL(withLanguageParam(`${import.meta.env.BASE_URL}player.html?gameId=${gameId}`), window.location.origin);
    const hostUrl = new URL(withLanguageParam(`${import.meta.env.BASE_URL}host-controller.html?gameId=${gameId}`), window.location.origin);
    const buzzerUrl = getActiveBuzzerUrl();
    if (buzzerUrl) {
      playerUrl.searchParams.set('buzzer', buzzerUrl);
      hostUrl.searchParams.set('buzzer', buzzerUrl);
    }
    try {
      playerQrImgEl.src = await QRCode.toDataURL(playerUrl.toString(), {
        width: 420,
        margin: 2,
        color: { dark: '#f8fafc', light: '#111827' },
      });
      hostQrImgEl.src = await QRCode.toDataURL(hostUrl.toString(), {
        width: 420,
        margin: 2,
        color: { dark: '#f8fafc', light: '#111827' },
      });
    } catch (error) {
      console.warn('[HeaderView] settings QR generation failed:', error);
    }
  }

  return {
    el,
    update,
    destroy() {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    },
  };
}
