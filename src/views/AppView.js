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

  // Public update — called on every subsequent state change
  function update(m, ui) {
    lastModel = m;
    lastUiState = ui;
    header.update(ui);
    renderGrid(m, ui);
  }

  // Targeted patch for a single cell (avoids full grid rebuild)
  function patchCell(rowId, cellId, isAnswered) {
    const el = gridEl?.querySelector(`[data-cell="r${rowId}c${cellId}"]`);
    if (el) el.classList.toggle('is-answered', isAnswered);
  }

  renderGrid(model, uiState);

  return { el: container, update, patchCell };
}
