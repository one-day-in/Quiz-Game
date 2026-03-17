// src/views/HeaderView.js
import { escapeHtml } from '../utils/utils.js';
import { t } from '../i18n.js';

export function HeaderView({ uiState, gameName, onLeaderboardClick, onBackToLobby, onRoundClick }) {
  const el = document.createElement('header');
  el.className = 'app-header';

  const title = gameName || t('app_name');

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
      <button class="hdr-leaderboard-btn" type="button">🏆 ${escapeHtml(t('leaderboard'))}</button>
    </div>
  `;

  const roundValueEl = el.querySelector('.js-round-value');

  function update(ui) {
    roundValueEl.textContent = String((ui?.activeRoundId ?? 0) + 1);
  }

  // Initial render
  update(uiState);

  el.querySelector('.hdr-lobby-btn').addEventListener('click', () => onBackToLobby?.());
  el.querySelector('.round-indicator').addEventListener('click', () => onRoundClick?.());
  el.querySelector('.hdr-leaderboard-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    onLeaderboardClick?.();
  });

  return { el, update };
}
