// src/views/AppView.js
import { HeaderView } from './HeaderView.js';
import { GameGridView } from './GameGridView.js';
import { LeaderboardGridView } from './LeaderboardGridView.js';
import { getPlayers, subscribeToPlayers } from '../api/gameApi.js';
import { ViewDisposer } from '../utils/disposer.js';
import { fitAllCells } from '../utils/fitText.js';

export function AppView({ model, uiState, actions, gameId, gameName, onCellClick, onBackToLobby, onRoundClick }) {
  const container = document.createElement('div');
  container.className = 'app-shell';

  const disposer = new ViewDisposer(container);
  let gridEl = null;
  let footerEl = null;
  let leaderboardPlayers = Array.isArray(model?.players) ? model.players : [];
  let hasHydratedPlayers = false;
  let isFooterExpanded = false;

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

  function toggleFooter() {
    isFooterExpanded = !isFooterExpanded;
    footerEl?.setExpanded?.(isFooterExpanded);
  }

  function renderLeaderboard(players = leaderboardPlayers) {
    leaderboardPlayers = Array.isArray(players) ? players : [];

    if (!footerEl) {
      footerEl = LeaderboardGridView({
        players: leaderboardPlayers,
        variant: 'footer',
        expanded: isFooterExpanded,
        onToggleExpanded: () => toggleFooter(),
      });
      container.appendChild(footerEl);
      fit();
    } else {
      footerEl.update?.(leaderboardPlayers);
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
  disposer.add(() => footerEl?.destroy?.());

  return { el: container, update, patchCell, syncLive };
}
