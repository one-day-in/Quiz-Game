// src/views/FooterView.js

export function FooterView({
  initialPlayers = [],
  maxPlayers = 6,
  onPlayersChange // optional: (players) => void
} = {}) {
  const el = document.createElement('footer');
  el.className = 'app-footer';

  // Local UI state
  const state = {
    players: (Array.isArray(initialPlayers) ? initialPlayers : [])
      .slice(0, maxPlayers)
      .map((p, idx) => ({
        id: p?.id ?? `p_${Date.now()}_${idx}`,
        name: (p?.name ?? 'Player').toString(),
        points: Number.isFinite(p?.points) ? p.points : 0
      }))
  };

  const title = document.createElement('div');
  title.className = 'leaderboard__title';
  title.textContent = 'Leaderboard';

  const grid = document.createElement('div');
  grid.className = 'leaderboard__grid';

  el.append(title, grid);

  // Re-fit names on container resize
  const ro = new ResizeObserver(() => {
    requestAnimationFrame(fitAllNames);
  });
  ro.observe(grid);

  function emit() {
    onPlayersChange?.(state.players.map(p => ({ ...p })));
  }

  function formatPoints(value) {
    const n = Number(value) || 0;
    if (n === 0) return '000';
    return String(n);
  }

  function changePoints(player, delta) {
    player.points = (Number(player.points) || 0) + delta;
    emit();
    render();
  }

  // Fit player name into the card — shrink font until it fits horizontally
  function fitPlayerName(card) {
    const nameWrap = card.querySelector('.leaderboard__nameWrap');
    const nameBtn  = card.querySelector('.leaderboard__name');
    if (!nameWrap || !nameBtn) return;

    const cardH = card.clientHeight;
    if (card.clientWidth <= 0 || cardH <= 0) return;

    const maxW = nameWrap.clientWidth * 0.92;
    let size = Math.max(12, cardH * 0.26);

    // width: auto so scrollWidth reflects actual text width, not container
    nameBtn.style.width = 'auto';
    nameBtn.style.whiteSpace = 'nowrap';
    nameBtn.style.fontSize = size + 'px';

    while (nameBtn.scrollWidth > maxW && size > 10) {
      size -= 0.5;
      nameBtn.style.fontSize = size + 'px';
    }

    nameBtn.style.width = '100%'; // restore
  }

  function fitAllNames() {
    grid.querySelectorAll('.leaderboard__card[data-player-id]').forEach(fitPlayerName);
  }

  function render() {
    grid.innerHTML = '';

    // Player cards
    for (const player of state.players) {
      grid.appendChild(buildPlayerCard(player));
    }

    // Add card (if room)
    if (state.players.length < maxPlayers) {
      grid.appendChild(buildAddCard());
    }

    // Fill remaining slots to keep 2x3 look
    const totalSlots = maxPlayers;
    const used = grid.children.length;
    for (let i = used; i < totalSlots; i++) {
      const ghost = document.createElement('div');
      ghost.className = 'leaderboard__card leaderboard__card--ghost';
      grid.appendChild(ghost);
    }

    requestAnimationFrame(fitAllNames);
  }

  function buildPlayerCard(player) {
    const card = document.createElement('div');
    card.className = 'leaderboard__card';
    card.dataset.playerId = player.id;

    /* ---------- NAME ---------- */
    const nameWrap = document.createElement('div');
    nameWrap.className = 'leaderboard__nameWrap';

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'leaderboard__name';
    nameBtn.textContent = player.name;
    nameBtn.title = 'Click to edit name';

    nameWrap.appendChild(nameBtn);

    /* ---------- SCORE (- 000 +) ---------- */
    const scoreWrap = document.createElement('div');
    scoreWrap.className = 'leaderboard__scoreWrap';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'leaderboard__scoreBtn';
    minusBtn.textContent = '−';
    minusBtn.title = '-100';
    minusBtn.setAttribute('aria-label', 'Minus 100 points');

    const points = document.createElement('div');
    points.className = 'leaderboard__points';
    points.textContent = formatPoints(player.points);
    points.setAttribute('aria-label', `Points: ${player.points}`);

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'leaderboard__scoreBtn';
    plusBtn.textContent = '+';
    plusBtn.title = '+100';
    plusBtn.setAttribute('aria-label', 'Plus 100 points');

    scoreWrap.append(minusBtn, points, plusBtn);

    /* ---------- REMOVE (absolute top-right) ---------- */
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'leaderboard__remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Remove player';
    removeBtn.setAttribute('aria-label', 'Remove player');

    card.append(nameWrap, scoreWrap, removeBtn);

    // Remove
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.players = state.players.filter(p => p.id !== player.id);
      emit();
      render();
    });

    // Inline edit name
    nameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startInlineEditName(nameWrap, player);
    });

    // -100 / +100
    minusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      changePoints(player, -100);
    });

    plusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      changePoints(player, +100);
    });

    return card;
  }

  function startInlineEditName(host, player) {
    if (host.querySelector('input.leaderboard__nameInput')) return;

    const input = document.createElement('input');
    input.className = 'leaderboard__nameInput';
    input.type = 'text';
    input.value = player.name;
    input.maxLength = 24;
    input.placeholder = 'Name...';

    host.innerHTML = '';
    host.appendChild(input);

    input.focus();
    input.select();

    let done = false;

    const commit = () => {
      if (done) return;
      done = true;

      const next = input.value.trim() || 'Player';
      player.name = next;

      emit();
      render();
    };

    const cancel = () => {
      done = true;
      render();
    };

    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        commit();
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        cancel();
      }
    });

    input.addEventListener('blur', commit);
  }

  function buildAddCard() {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'leaderboard__card leaderboard__card--add';
    card.title = 'Add player';

    const plus = document.createElement('div');
    plus.className = 'leaderboard__addPlus';
    plus.textContent = '➕';

    const label = document.createElement('div');
    label.className = 'leaderboard__addLabel';
    label.textContent = 'Add player';

    card.append(plus, label);

    card.addEventListener('click', () => {
      if (state.players.length >= maxPlayers) return;

      const id = `p_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      state.players.push({ id, name: 'Player', points: 0 });

      emit();
      render();

      // Immediately open name edit
      const newCard = grid.querySelector(`[data-player-id="${id}"]`);
      const newNameBtn = newCard?.querySelector('.leaderboard__name');
      newNameBtn?.click();
    });

    return card;
  }

  render();
  return el;
}
