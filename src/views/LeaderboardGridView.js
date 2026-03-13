import { fitTextToBox } from '../utils/fitText.js';

export function LeaderboardGridView({
  players = [],
  maxPlayers = 8,
  onRemovePlayer = null,
} = {}) {
  const el = document.createElement('footer');
  el.className = 'app-footer';

  const title = document.createElement('div');
  title.className = 'leaderboard__title';
  title.textContent = 'Leaderboard';

  const grid = document.createElement('div');
  grid.className = 'leaderboard__grid';

  el.append(title, grid);

  const normalizedPlayers = (Array.isArray(players) ? players : []).slice(0, maxPlayers);

  for (const player of normalizedPlayers) {
    grid.appendChild(buildPlayerCard(player, onRemovePlayer));
  }

  for (let i = normalizedPlayers.length; i < maxPlayers; i += 1) {
    const ghost = document.createElement('div');
    ghost.className = 'leaderboard__card leaderboard__card--ghost';
    grid.appendChild(ghost);
  }

  fitPlayerNames(grid);
  const ro = new ResizeObserver(() => {
    requestAnimationFrame(() => fitPlayerNames(grid));
  });
  ro.observe(grid);

  el.destroy = () => ro.disconnect();
  return el;
}

function buildPlayerCard(player, onRemovePlayer) {
  const card = document.createElement('div');
  card.className = 'leaderboard__card leaderboard__card--readonly';
  card.dataset.playerId = player.id;

  const nameWrap = document.createElement('div');
  nameWrap.className = 'leaderboard__nameWrap';

  const name = document.createElement('div');
  name.className = 'leaderboard__name leaderboard__name--static';
  name.textContent = player.name || 'Player';

  const scoreWrap = document.createElement('div');
  scoreWrap.className = 'leaderboard__scoreWrap leaderboard__scoreWrap--readonly';

  const points = document.createElement('div');
  points.className = 'leaderboard__points';
  points.textContent = formatPoints(player.points);
  points.setAttribute('aria-label', `Points: ${player.points ?? 0}`);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'leaderboard__remove';
  removeBtn.textContent = '✕';
  removeBtn.title = 'Remove player';
  removeBtn.setAttribute('aria-label', `Remove ${player.name || 'player'}`);

  nameWrap.appendChild(name);
  scoreWrap.appendChild(points);
  card.append(nameWrap, scoreWrap, removeBtn);

  removeBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    onRemovePlayer?.(player);
  });

  return card;
}

function fitPlayerNames(grid) {
  grid.querySelectorAll('.leaderboard__card[data-player-id]').forEach((card) => {
    const nameWrap = card.querySelector('.leaderboard__nameWrap');
    const nameEl = card.querySelector('.leaderboard__name');
    if (!nameWrap || !nameEl) return;
    nameEl.style.width = '100%';
    fitTextToBox(nameWrap, nameEl, {
      widthRatio: 0.96,
      heightRatio: 0.82,
      minSize: 18,
      step: 0.5,
      noWrap: true,
    });
  });
}

function formatPoints(value) {
  const numeric = Number(value) || 0;
  if (numeric === 0) return '000';
  return String(numeric);
}
