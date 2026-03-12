// src/views/HeaderView.js
import { escapeHtml } from '../utils/utils.js';

export function HeaderView({ uiState, gameName, onSettingsClick, onBackToLobby, onRoundClick }) {
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
      <button class="hdr-settings-btn" type="button">⚙ Settings</button>
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
  el.querySelector('.hdr-settings-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    onSettingsClick?.();
  });

  return { el, update };
}
