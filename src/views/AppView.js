// src/views/AppView.js
import { HeaderView } from './HeaderView.js';
import { GameGridView } from './GameGridView.js';
import { LeaderboardGridView } from './LeaderboardGridView.js';
import { LeaderboardDrawerView } from './LeaderboardDrawerView.js';
import { ViewDisposer } from '../utils/disposer.js';
import { fitAllCells } from '../utils/fitText.js';

export function AppView({ model, uiState, players = [], actions, gameId, gameName, onCellClick, onBackToLobby, onRoundClick }) {
  const container = document.createElement('div');
  container.className = 'app-shell';

  const disposer = new ViewDisposer(container);
  let gridEl = null;
  let footerEl = null;
  let drawerView = null;
  let leaderboardPlayers = Array.isArray(players) ? players : [];

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

  function openLeaderboardView() {
    if (drawerView) return;

    drawerView = new LeaderboardDrawerView({
      gameId,
      players: leaderboardPlayers,
      onAdjustPlayerScore: (playerId, delta) => actions.adjustPlayerScore?.(playerId, delta),
      onDeletePlayer: (playerId) => actions.removePlayer?.(playerId),
      onClose: () => {
        drawerView = null;
      },
    });

    document.body.appendChild(drawerView.el);
    drawerView.beginOpen();
  }

  function renderLeaderboard(players = leaderboardPlayers) {
    leaderboardPlayers = Array.isArray(players) ? players : [];

    if (!footerEl) {
      footerEl = LeaderboardGridView({
        players: leaderboardPlayers,
        variant: 'footer',
        onOpenExpanded: () => openLeaderboardView(),
      });
      container.appendChild(footerEl);
      fit();
    } else {
      footerEl.update?.(leaderboardPlayers);
    }

    drawerView?.updatePlayers?.(leaderboardPlayers);
  }

  // Public update — called on every subsequent state change
  function update(m, ui) {
    header.update(ui);
    renderGrid(m, ui);
    renderLeaderboard(leaderboardPlayers);
  }

  function syncLive(m, ui = uiState) {
    header.update(ui);
    renderLeaderboard(leaderboardPlayers);
  }

  function updatePlayers(nextPlayers = []) {
    renderLeaderboard(nextPlayers);
  }

  // Targeted patch for a single cell (avoids full grid rebuild)
  function patchCell(rowId, cellId, isAnswered) {
    const el = gridEl?.querySelector(`[data-cell="r${rowId}c${cellId}"]`);
    if (el) el.classList.toggle('is-answered', isAnswered);
  }

  renderGrid(model, uiState);
  renderLeaderboard(leaderboardPlayers);
  disposer.add(() => footerEl?.destroy?.());
  disposer.add(() => drawerView?.destroy?.());

  return { el: container, update, updatePlayers, patchCell, syncLive };
}
