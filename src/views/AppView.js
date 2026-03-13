// src/views/AppView.js
import { HeaderView } from './HeaderView.js';
import { GameGridView } from './GameGridView.js';
import { LeaderboardView } from './LeaderboardView.js';
import { ViewDisposer } from '../utils/disposer.js';
import { fitAllCells } from '../utils/fitText.js';

export function AppView({ model, uiState, actions, settingsService, gameId, gameName, onCellClick, onBackToLobby, onLogout, onRoundClick }) {
  const container = document.createElement('div');
  container.className = 'app-shell';

  const disposer = new ViewDisposer(container);
  let settingsViewInstance = null;
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
    onSettingsClick: toggleSettings,
    onBackToLobby,
    onRoundClick
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

    // Re-append settings on top if open (replaceWith moves it out)
    if (settingsViewInstance?.el?.isConnected === false) {
      container.appendChild(settingsViewInstance.el);
    }

    fit();
  }

  function toggleSettings() {
    if (settingsViewInstance) {
      settingsViewInstance.beginClose();
      settingsViewInstance = null;
      return;
    }

    settingsViewInstance = new LeaderboardView({
      gameId,
      onClose: () => {
        settingsViewInstance = null;
        // Re-render grid with last known state — ensures mode/round changes are
        // visible the moment settings closes (guards against any timing edge-cases
        // where the _emit()-triggered render ran while settings was still open)
        renderGrid(lastModel, lastUiState);
      }
    });

    container.appendChild(settingsViewInstance.el);
    settingsViewInstance.beginOpen();
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
