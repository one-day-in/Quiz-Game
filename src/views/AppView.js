// src/views/AppView.js
import { HeaderView } from './HeaderView.js';
import { GameGridView } from './GameGridView.js';
import { LeaderboardDrawerView } from './LeaderboardDrawerView.js';
import { ViewDisposer } from '../utils/disposer.js';
import { fitAllCells } from '../utils/fitText.js';

export function AppView({ model, uiState, actions, gameId, gameName, onCellClick, onBackToLobby, onRoundClick, onToggleLiveMode }) {
  const container = document.createElement('div');
  container.className = 'app-shell';

  const disposer = new ViewDisposer(container);
  let leaderboardDrawerInstance = null;
  let gridEl = null;
  let lastModel = model;
  let lastUiState = uiState;
  let buzzOverlayHideTimer = null;
  let activeBuzzOverlayToken = null;
  let dismissedBuzzOverlayToken = null;
  let isBuzzOverlayHydrated = false;

  // ResizeObserver — recalculate fitText on resize
  const ro = new ResizeObserver(() => {
    fitAllCells(container);
  });
  ro.observe(container);
  disposer.add(() => ro.disconnect());

  function fit() {
    requestAnimationFrame(() => fitAllCells(container));
  }

  // Header — created once, stays alive; header.update() refreshes mode/round indicators
  const header = HeaderView({
    uiState,
    gameName,
    onLeaderboardClick: toggleLeaderboardDrawer,
    onBackToLobby,
    onRoundClick,
    onToggleLiveMode,
  });
  container.appendChild(header.el);

  const buzzOverlay = document.createElement('button');
  buzzOverlay.type = 'button';
  buzzOverlay.className = 'app-shell__buzzOverlay';
  buzzOverlay.hidden = true;
  buzzOverlay.innerHTML = `
    <span class="app-shell__buzzEyebrow">First buzz</span>
    <strong class="app-shell__buzzName"></strong>
    <span class="app-shell__buzzHint">Tap anywhere to close</span>
  `;
  buzzOverlay.addEventListener('click', () => {
    if (!activeBuzzOverlayToken) return;
    dismissedBuzzOverlayToken = activeBuzzOverlayToken;
    hideBuzzOverlay();
  });
  container.appendChild(buzzOverlay);
  disposer.add(() => {
    clearTimeout(buzzOverlayHideTimer);
  });

  function renderGrid(m, ui) {
    const newGrid = GameGridView({
      model: m,
      uiState: ui,
      roundId: ui.activeRoundId ?? 0,
      onCellClick,
      onTopicChange: (roundId, rowId, topic) => actions.updateTopic(roundId, rowId, topic)
    });

    if (gridEl) {
      gridEl.replaceWith(newGrid);
    } else {
      container.appendChild(newGrid);
    }
    gridEl = newGrid;

    // Re-append the leaderboard drawer on top if open (replaceWith moves it out).
    if (leaderboardDrawerInstance?.el?.isConnected === false) {
      container.appendChild(leaderboardDrawerInstance.el);
    }

    fit();
  }

  function toggleLeaderboardDrawer() {
    if (leaderboardDrawerInstance) {
      leaderboardDrawerInstance.beginClose();
      leaderboardDrawerInstance = null;
      return;
    }

    leaderboardDrawerInstance = new LeaderboardDrawerView({
      gameId,
      onClose: () => {
        leaderboardDrawerInstance = null;
        // Re-render the grid once the leaderboard drawer closes so the latest
        // round state is visible immediately.
        renderGrid(lastModel, lastUiState);
      }
    });

    container.appendChild(leaderboardDrawerInstance.el);
    leaderboardDrawerInstance.beginOpen();
  }

  function syncBuzzOverlay(m) {
    const players = m?.players ?? [];
    const buzz = m?.live?.buzz ?? null;
    const overlayToken = buzz?.status === 'buzzed' && buzz?.winnerPlayerId
      ? `${buzz.sessionId || 'buzz'}:${buzz.winnerPlayerId}`
      : null;

    if (!overlayToken) {
      dismissedBuzzOverlayToken = null;
      hideBuzzOverlay();
      isBuzzOverlayHydrated = true;
      return;
    }

    if (!isBuzzOverlayHydrated) {
      isBuzzOverlayHydrated = true;
      dismissedBuzzOverlayToken = overlayToken;
      return;
    }

    if (dismissedBuzzOverlayToken === overlayToken || activeBuzzOverlayToken === overlayToken) {
      return;
    }

    const winner = players.find((player) => player.id === buzz.winnerPlayerId);
    buzzOverlay.querySelector('.app-shell__buzzName').textContent = `${winner?.name || 'Player'} buzzed first`;
    activeBuzzOverlayToken = overlayToken;
    buzzOverlay.hidden = false;
    clearTimeout(buzzOverlayHideTimer);
    buzzOverlayHideTimer = setTimeout(() => {
      hideBuzzOverlay();
    }, 10000);
  }

  function hideBuzzOverlay() {
    clearTimeout(buzzOverlayHideTimer);
    buzzOverlayHideTimer = null;
    buzzOverlay.hidden = true;
    activeBuzzOverlayToken = null;
  }

  // Public update — called on every subsequent state change
  function update(m, ui) {
    lastModel = m;
    lastUiState = ui;
    header.update(ui);
    syncBuzzOverlay(m);
    renderGrid(m, ui);
  }

  function syncLive(m, ui = lastUiState) {
    lastModel = m;
    lastUiState = ui;
    header.update(ui);
    syncBuzzOverlay(m);
  }

  // Targeted patch for a single cell (avoids full grid rebuild)
  function patchCell(rowId, cellId, isAnswered) {
    const el = gridEl?.querySelector(`[data-cell="r${rowId}c${cellId}"]`);
    if (el) el.classList.toggle('is-answered', isAnswered);
  }

  renderGrid(model, uiState);
  syncBuzzOverlay(model);

  return { el: container, update, patchCell, syncLive };
}
