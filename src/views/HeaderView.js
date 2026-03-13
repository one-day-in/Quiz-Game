// src/views/HeaderView.js
import { escapeHtml } from '../utils/utils.js';

export function HeaderView({ uiState, gameName, onLeaderboardClick, onBackToLobby, onRoundClick, onToggleLiveMode }) {
  const el = document.createElement('header');
  el.className = 'app-header';

  const title = gameName || 'Quiz Game';

  el.innerHTML = `
    <div class="hdr-left">
      <button class="hdr-lobby-btn" type="button" title="Back to lobby">← Lobby</button>
      <button class="round-indicator" type="button" title="Switch round">
        Round: <b class="js-round-value"></b>
      </button>
    </div>
    <div class="hdr-center">
      <h1 class="app-title">${escapeHtml(title)}</h1>
    </div>
    <div class="hdr-right">
      <button class="hdr-live-btn" type="button" aria-pressed="false">Live: Off</button>
      <button class="hdr-leaderboard-btn" type="button">🏆 Leaderboard</button>
    </div>
  `;

  const roundValueEl = el.querySelector('.js-round-value');
  const liveBtnEl = el.querySelector('.hdr-live-btn');

  function update(ui) {
    roundValueEl.textContent = String((ui?.activeRoundId ?? 0) + 1);
    const isLiveArmed = !!ui?.isLiveArmed;
    liveBtnEl.textContent = isLiveArmed ? 'Live: On' : 'Live: Off';
    liveBtnEl.setAttribute('aria-pressed', String(isLiveArmed));
    liveBtnEl.classList.toggle('is-live', isLiveArmed);
  }

  // Initial render
  update(uiState);

  el.querySelector('.hdr-lobby-btn').addEventListener('click', () => onBackToLobby?.());
  el.querySelector('.round-indicator').addEventListener('click', () => onRoundClick?.());
  el.querySelector('.hdr-live-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    onToggleLiveMode?.();
  });
  el.querySelector('.hdr-leaderboard-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    onLeaderboardClick?.();
  });

  return { el, update };
}
