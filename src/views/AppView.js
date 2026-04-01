// src/views/AppView.js
import { HeaderView } from './HeaderView.js';
import { GameGridView } from './GameGridView.js';
import { LeaderboardGridView } from './LeaderboardGridView.js';
import { getPlayers, subscribeToPlayers } from '../api/gameApi.js';
import { ViewDisposer } from '../utils/disposer.js';
import { fitAllCells } from '../utils/fitText.js';

export function AppView({ model, uiState, actions, gameId, gameName, onCellClick, onBackToLobby, onRoundClick }) {
  const OVERLAY_STATE_KEY = `quiz-game:leaderboard-overlay:${gameId}`;
  const container = document.createElement('div');
  container.className = 'app-shell';

  const disposer = new ViewDisposer(container);
  let gridEl = null;
  let previewEl = null;
  let overlayEl = null;
  let leaderboardPlayers = Array.isArray(model?.players) ? model.players : [];
  let hasHydratedPlayers = false;
  let isOverlayOpen = localStorage.getItem(OVERLAY_STATE_KEY) === 'open';

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
    onBackToLobby,
    onRoundClick,
  });
  container.appendChild(header.el);

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

    fit();
  }

  function persistOverlayState() {
    localStorage.setItem(OVERLAY_STATE_KEY, isOverlayOpen ? 'open' : 'closed');
  }

  function closeOverlay() {
    if (!overlayEl) return;
    isOverlayOpen = false;
    persistOverlayState();
    overlayEl.hidden = true;
    fit();
  }

  function openOverlay() {
    if (!overlayEl) return;
    isOverlayOpen = true;
    persistOverlayState();
    overlayEl.hidden = false;
    fit();
  }

  function renderLeaderboard(players = leaderboardPlayers) {
    leaderboardPlayers = Array.isArray(players) ? players : [];

    if (!previewEl) {
      previewEl = LeaderboardGridView({
        players: leaderboardPlayers,
        variant: 'preview',
        onOpenOverlay: () => openOverlay(),
      });
      container.appendChild(previewEl);
    } else {
      previewEl.update?.(leaderboardPlayers);
    }

    if (!overlayEl) {
      overlayEl = LeaderboardGridView({
        players: leaderboardPlayers,
        variant: 'overlay',
        onCloseOverlay: () => closeOverlay(),
      });
      overlayEl.hidden = !isOverlayOpen;
      container.appendChild(overlayEl);
    } else {
      overlayEl.update?.(leaderboardPlayers);
      overlayEl.hidden = !isOverlayOpen;
    }

    if (isOverlayOpen) {
      overlayEl?.focus?.();
    }

    if (previewEl && previewEl.isConnected === false) {
      container.appendChild(previewEl);
    }

    if (overlayEl && overlayEl.isConnected === false) {
      container.appendChild(overlayEl);
    }

    if (!previewEl || !overlayEl) {
      fit();
    }
  }

  function bindPlayers() {
    const syncPlayers = (players) => {
      hasHydratedPlayers = true;
      renderLeaderboard(players);
    };

    void getPlayers(gameId)
      .then(syncPlayers)
      .catch((error) => console.error('[AppView] getPlayers failed:', error));

    const stopPlayersSubscription = subscribeToPlayers(gameId, syncPlayers);
    disposer.add(() => stopPlayersSubscription?.());
  }

  // Public update — called on every subsequent state change
  function update(m, ui) {
    header.update(ui);
    renderGrid(m, ui);
    renderLeaderboard(hasHydratedPlayers ? leaderboardPlayers : (m?.players || leaderboardPlayers));
  }

  function syncLive(m, ui = uiState) {
    header.update(ui);
    renderLeaderboard(hasHydratedPlayers ? leaderboardPlayers : (m?.players || leaderboardPlayers));
  }

  // Targeted patch for a single cell (avoids full grid rebuild)
  function patchCell(rowId, cellId, isAnswered) {
    const el = gridEl?.querySelector(`[data-cell="r${rowId}c${cellId}"]`);
    if (el) el.classList.toggle('is-answered', isAnswered);
  }

  renderGrid(model, uiState);
  renderLeaderboard(leaderboardPlayers);
  bindPlayers();
  disposer.add(() => previewEl?.destroy?.());
  disposer.add(() => overlayEl?.destroy?.());

  return { el: container, update, patchCell, syncLive };
}
