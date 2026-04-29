// src/views/AppView.js
import { HeaderView } from './HeaderView.js';
import { GameGridView } from './GameGridView.js';
import { LeaderboardPanelView } from './LeaderboardPanelView.js';
import { ViewDisposer } from '../utils/disposer.js';
import { fitAllCells } from '../utils/fitText.js';

export function AppView({
  model,
  uiState,
  players = [],
  actions,
  gameId,
  gameName,
  showGameTitle = true,
  onCellClick,
  onBackToLobby,
  onRoundClick,
  isReadOnly = false,
  allowCurrentPlayerControl = false,
  allowLeaderboardControls = false,
  showLeaderboardQr = true,
  scoreLogs = [],
  onLeaderboardExpandedChange = null,
  onScoreLogsOpenChange = null,
  onGameModeToggle = null,
}) {
  const container = document.createElement('div');
  container.className = 'app-shell';

  const disposer = new ViewDisposer(container);
  let currentModel = model;
  let currentUiState = uiState;
  let gridEl = null;
  let leaderboardPanel = null;
  let leaderboardPlayers = Array.isArray(players) ? players : [];
  let leaderboardScoreLogs = Array.isArray(scoreLogs) ? scoreLogs : [];

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
    showGameTitle,
    players: leaderboardPlayers,
    currentPlayerId: model?.getCurrentPlayerId?.() ?? null,
    onBackToLobby: isReadOnly ? null : onBackToLobby,
    onRoundClick,
    onScoreLogsClick: () => leaderboardPanel?.toggleScoreLogs?.(),
    onCurrentPlayerChange: (isReadOnly && !allowCurrentPlayerControl) ? null : (playerId) => actions.setCurrentPlayer?.(playerId),
    onGameModeToggle: isReadOnly ? null : onGameModeToggle,
  });
  container.appendChild(header.el);
  disposer.add(() => header.destroy?.());

  function renderGrid(m, ui) {
    const newGrid = GameGridView({
      model: m,
      uiState: ui,
      roundId: ui.activeRoundId ?? 0,
      onCellClick,
      onTopicChange: isReadOnly ? null : (roundId, rowId, topic) => actions.updateTopic(roundId, rowId, topic),
      isReadOnly,
    });

    if (gridEl) {
      gridEl.replaceWith(newGrid);
    } else {
      container.appendChild(newGrid);
    }
    gridEl = newGrid;

    fit();
  }

  function renderLeaderboard(players = leaderboardPlayers) {
    leaderboardPlayers = Array.isArray(players) ? players : [];

    if (!leaderboardPanel) {
      leaderboardPanel = new LeaderboardPanelView({
        gameId,
        players: leaderboardPlayers,
        scoreLogs: leaderboardScoreLogs,
        onAdjustPlayerScore: (playerId, delta) => actions.adjustPlayerScore?.(playerId, delta),
        onDeletePlayer: (isReadOnly && !allowLeaderboardControls) ? null : (playerId) => actions.removePlayer?.(playerId),
        onExpandedChange: (expanded) => onLeaderboardExpandedChange?.(expanded),
        onScoreLogsOpenChange: (isOpen) => onScoreLogsOpenChange?.(isOpen),
        readOnly: isReadOnly && !allowLeaderboardControls,
        showQr: showLeaderboardQr,
      });
      container.appendChild(leaderboardPanel.el);
      fit();
    } else {
      leaderboardPanel.updatePlayers?.(leaderboardPlayers);
      leaderboardPanel.updateScoreLogs?.(leaderboardScoreLogs);
    }
  }

  // Public update — called on every subsequent state change
  function update(m, ui) {
    currentModel = m;
    currentUiState = ui;
    container.classList.toggle('is-round-transitioning', !!ui?.isRoundTransitioning);
    header.update({
      uiState: ui,
      players: leaderboardPlayers,
      currentPlayerId: m?.getCurrentPlayerId?.() ?? null,
    });
    renderGrid(m, ui);
    renderLeaderboard(leaderboardPlayers);
  }

  function syncLive(m, ui = uiState) {
    currentModel = m;
    currentUiState = ui;
    container.classList.toggle('is-round-transitioning', !!ui?.isRoundTransitioning);
    header.update({
      uiState: ui,
      players: leaderboardPlayers,
      currentPlayerId: m?.getCurrentPlayerId?.() ?? null,
    });
    renderLeaderboard(leaderboardPlayers);
  }

  function setRoundTransition(ui = uiState) {
    currentUiState = ui;
    container.classList.toggle('is-round-transitioning', !!ui?.isRoundTransitioning);
    header.update({
      uiState: ui,
      players: leaderboardPlayers,
      currentPlayerId: currentModel?.getCurrentPlayerId?.() ?? null,
    });
  }

  function updatePlayers(nextPlayers = []) {
    leaderboardPlayers = Array.isArray(nextPlayers) ? nextPlayers : [];
    header.update({
      uiState: currentUiState,
      players: leaderboardPlayers,
      currentPlayerId: currentModel?.getCurrentPlayerId?.() ?? null,
    });
    renderLeaderboard(nextPlayers);
  }

  function updateScoreLogs(nextLogs = []) {
    leaderboardScoreLogs = Array.isArray(nextLogs) ? nextLogs : [];
    leaderboardPanel?.updateScoreLogs?.(leaderboardScoreLogs);
  }

  function setLeaderboardExpanded(expanded, options = {}) {
    leaderboardPanel?.setExpanded?.(!!expanded, options);
  }

  function setScoreLogsOpen(isOpen, options = {}) {
    leaderboardPanel?.setScoreLogsOpen?.(!!isOpen, options);
  }

  // Targeted patch for a single cell (avoids full grid rebuild)
  function patchCell(rowId, cellId, isAnswered) {
    const el = gridEl?.querySelector(`[data-cell="r${rowId}c${cellId}"]`);
    if (el) el.classList.toggle('is-answered', isAnswered);
  }

  renderGrid(model, uiState);
  renderLeaderboard(leaderboardPlayers);
  disposer.add(() => leaderboardPanel?.destroy?.());

  return { el: container, update, updatePlayers, updateScoreLogs, setLeaderboardExpanded, setScoreLogsOpen, patchCell, syncLive, setRoundTransition };
}
