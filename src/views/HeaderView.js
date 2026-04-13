import { escapeHtml } from '../utils/utils.js';
import { t } from '../i18n.js';

function resolveCurrentPlayer(players = [], currentPlayerId = null) {
  return (Array.isArray(players) ? players : []).find((player) => String(player?.id) === String(currentPlayerId)) || null;
}

export function HeaderView({
  uiState,
  gameName,
  players = [],
  currentPlayerId = null,
  onBackToLobby,
  onRoundClick,
  onCurrentPlayerChange,
}) {
  const el = document.createElement('header');
  el.className = 'app-header';

  const title = gameName || t('app_name');
  let currentPlayers = Array.isArray(players) ? players.slice() : [];
  let currentChooserId = currentPlayerId ? String(currentPlayerId) : null;
  let isChooserMenuOpen = false;

  el.innerHTML = `
    <div class="hdr-left">
      <button class="hdr-lobby-btn" type="button" title="${escapeHtml(t('back_to_lobby'))}">← ${escapeHtml(t('lobby'))}</button>
      <button class="round-indicator" type="button" title="${escapeHtml(t('switch_round'))}">
        ${escapeHtml(t('round'))}: <b class="js-round-value"></b>
      </button>
    </div>
    <div class="hdr-center">
      <h1 class="app-title">${escapeHtml(title)}</h1>
    </div>
    <div class="hdr-right">
      <div class="hdr-current-player">
        <button
          class="hdr-current-player-btn"
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
  `;

  const roundValueEl = el.querySelector('.js-round-value');
  const chooserValueEl = el.querySelector('.js-current-player-value');
  const chooserBtnEl = el.querySelector('.hdr-current-player-btn');
  const chooserMenuEl = el.querySelector('.hdr-current-player-menu');
  const chooserListEl = el.querySelector('.hdr-current-player-list');

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

    if (Array.isArray(next?.players)) currentPlayers = next.players.slice();
    if (Object.prototype.hasOwnProperty.call(next, 'currentPlayerId')) {
      currentChooserId = next.currentPlayerId ? String(next.currentPlayerId) : null;
    }

    renderChooserSummary();
    renderChooserMenu();
  }

  function handleDocumentPointerDown(event) {
    if (!isChooserMenuOpen) return;
    if (el.contains(event.target)) return;
    closeChooserMenu();
  }

  function handleDocumentKeyDown(event) {
    if (event.key === 'Escape') closeChooserMenu();
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

  el.querySelector('.hdr-lobby-btn').addEventListener('click', () => onBackToLobby?.());
  el.querySelector('.round-indicator').addEventListener('click', () => onRoundClick?.());
  document.addEventListener('pointerdown', handleDocumentPointerDown);
  document.addEventListener('keydown', handleDocumentKeyDown);

  update({ uiState, players: currentPlayers, currentPlayerId: currentChooserId });

  return {
    el,
    update,
    destroy() {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    },
  };
}
