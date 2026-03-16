export function LeaderboardGridView({
  players = [],
  onAddPlayer = null,
  onDeletePlayer = null,
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

  const list = document.createElement('div');
  list.className = 'leaderboard__list';

  el.append(header, list);

  function update(nextPlayers = []) {
    const sortedPlayers = (Array.isArray(nextPlayers) ? nextPlayers : [])
      .slice()
      .sort((a, b) => {
        const scoreDelta = (Number(b?.points) || 0) - (Number(a?.points) || 0);
        if (scoreDelta !== 0) return scoreDelta;
        return String(a?.name || '').localeCompare(String(b?.name || ''));
      });

    list.innerHTML = '';

    if (!sortedPlayers.length) {
      const empty = document.createElement('div');
      empty.className = 'leaderboard__empty';
      empty.textContent = 'No players yet';
      list.appendChild(empty);
      return;
    }

    for (const player of sortedPlayers) {
      list.appendChild(buildRow(player, onDeletePlayer));
    }
  }

  update(players);

  el.update = update;
  el.destroy = () => {};
  return el;
}

function buildRow(player, onDeletePlayer) {
  const row = document.createElement('div');
  row.className = 'leaderboard__row';

  const name = document.createElement('div');
  name.className = 'leaderboard__nameLabel';
  name.textContent = player?.name || 'Player';

  const points = document.createElement('div');
  points.className = 'leaderboard__scoreValue';
  points.textContent = formatPoints(player?.points);
  points.setAttribute('aria-label', `Points: ${player?.points ?? 0}`);

  row.append(name, points);

  if (typeof onDeletePlayer === 'function') {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'leaderboard__deleteBtn';
    deleteBtn.textContent = '🗑️';
    deleteBtn.title = 'Remove player';
    deleteBtn.setAttribute('aria-label', `Remove ${player?.name || 'Player'}`);
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onDeletePlayer(player.id);
    });
    row.appendChild(deleteBtn);
  }

  return row;
}

function formatPoints(value) {
  const numeric = Number(value) || 0;
  if (numeric === 0) return '000';
  return String(numeric);
}
