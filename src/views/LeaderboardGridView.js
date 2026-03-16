import { fitTextToBox } from '../utils/fitText.js';

export function LeaderboardGridView({
  players = [],
  maxPlayers = 8,
  onRemovePlayer = null,
  onAddPlayer = null,
} = {}) {
  const el = document.createElement('footer');
  el.className = 'app-footer';

  const header = document.createElement('div');
  header.className = 'leaderboard__header';

  const title = document.createElement('div');
  title.className = 'leaderboard__title';
  title.textContent = 'Leaderboard';

  header.appendChild(title);

  if (typeof onAddPlayer === 'function') {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'leaderboard__addPlayerBtn';
    addButton.textContent = 'Add player';
    addButton.addEventListener('click', () => onAddPlayer());
    header.appendChild(addButton);
  }

  const grid = document.createElement('div');
  grid.className = 'leaderboard__grid';

  const slots = Array.from({ length: maxPlayers }, () => createSlot(onRemovePlayer));
  for (const slot of slots) grid.appendChild(slot.card);

  el.append(header, grid);

  let lastNameSignature = '';

  function update(nextPlayers = []) {
    const normalizedPlayers = (Array.isArray(nextPlayers) ? nextPlayers : []).slice(0, maxPlayers);
    const nextNameSignature = normalizedPlayers
      .map((player) => `${player.id}:${player.name}`)
      .join('|');

    slots.forEach((slot, idx) => {
      const player = normalizedPlayers[idx] ?? null;
      updateSlot(slot, player);
    });

    if (nextNameSignature !== lastNameSignature) {
      fitPlayerNames(grid);
      lastNameSignature = nextNameSignature;
    }
  }

  const ro = new ResizeObserver(() => {
    requestAnimationFrame(() => fitPlayerNames(grid));
  });
  ro.observe(grid);

  update(players);

  el.update = update;
  el.destroy = () => ro.disconnect();
  return el;
}

function createSlot(onRemovePlayer) {
  const card = document.createElement('div');
  card.className = 'leaderboard__card leaderboard__card--ghost';

  const nameWrap = document.createElement('div');
  nameWrap.className = 'leaderboard__nameWrap';

  const name = document.createElement('div');
  name.className = 'leaderboard__name leaderboard__name--static';

  const scoreWrap = document.createElement('div');
  scoreWrap.className = 'leaderboard__scoreWrap leaderboard__scoreWrap--readonly';

  const points = document.createElement('div');
  points.className = 'leaderboard__points';
  points.hidden = true;

  nameWrap.appendChild(name);
  scoreWrap.appendChild(points);
  card.append(nameWrap, scoreWrap);

  let removeBtn = null;
  if (typeof onRemovePlayer === 'function') {
    removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'leaderboard__remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove player';
    removeBtn.hidden = true;
    removeBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      const payload = removeBtn._player;
      if (payload) onRemovePlayer(payload);
    });
    card.appendChild(removeBtn);
  }

  return { card, name, points, removeBtn };
}

function updateSlot(slot, player) {
  if (!player) {
    slot.card.className = 'leaderboard__card leaderboard__card--ghost';
    delete slot.card.dataset.playerId;
    slot.name.textContent = '';
    slot.name.style.fontSize = '';
    slot.points.hidden = true;
    slot.points.textContent = '';
    slot.points.removeAttribute('aria-label');
    if (slot.removeBtn) {
      slot.removeBtn.hidden = true;
      slot.removeBtn._player = null;
      slot.removeBtn.removeAttribute('aria-label');
    }
    return;
  }

  slot.card.className = 'leaderboard__card leaderboard__card--readonly';
  slot.card.dataset.playerId = player.id;
  slot.name.textContent = player.name || 'Player';
  slot.points.hidden = false;
  slot.points.textContent = formatPoints(player.points);
  slot.points.setAttribute('aria-label', `Points: ${player.points ?? 0}`);

  if (slot.removeBtn) {
    slot.removeBtn.hidden = false;
    slot.removeBtn.title = 'Remove player';
    slot.removeBtn.setAttribute('aria-label', `Remove ${player.name || 'player'}`);
    slot.removeBtn._player = player;
  }
}

function fitPlayerNames(grid) {
  grid.querySelectorAll('.leaderboard__card[data-player-id]').forEach((card) => {
    const nameWrap = card.querySelector('.leaderboard__nameWrap');
    const nameEl = card.querySelector('.leaderboard__name');
    if (!nameWrap || !nameEl) return;

    nameEl.style.width = '100%';
    nameEl.style.fontSize = '';
    fitTextToBox(nameWrap, nameEl, {
      widthRatio: 0.92,
      heightRatio: 0.58,
      minSize: 18,
      step: 0.5,
      noWrap: false,
      respectMinSizeOnStart: true,
    });
  });
}

function formatPoints(value) {
  const numeric = Number(value) || 0;
  if (numeric === 0) return '000';
  return String(numeric);
}
