const REVEAL_W = 80; // px — width of the delete action strip
let _activeSwipeState = null;

import { sortPlayersByScore } from './leaderboardSort.js';
import { t } from '../i18n.js';

function closeActiveSwipeRow() {
  _activeSwipeState?.close();
}

export function LeaderboardGridView({
  players = [],
  variant = 'page',
  collapsed = false,
  onToggleCollapse = null,
  onAddPlayer = null,
  onDeletePlayer = null,
} = {}) {
  const el = document.createElement('footer');
  el.className = `app-footer leaderboard leaderboard--${variant}`;

  const header = document.createElement('div');
  header.className = 'leaderboard__header';

  const titleGroup = document.createElement('div');
  titleGroup.className = 'leaderboard__titleGroup';

  const title = document.createElement('div');
  title.className = 'leaderboard__title';
  title.textContent = t('leaderboard');
  titleGroup.appendChild(title);

  const status = document.createElement('div');
  status.className = 'leaderboard__status';
  status.hidden = variant !== 'footer';
  titleGroup.appendChild(status);

  header.appendChild(titleGroup);

  if (typeof onAddPlayer === 'function') {
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'leaderboard__addPlayerBtn';
    addButton.textContent = t('add_player');
    addButton.addEventListener('click', () => onAddPlayer());
    header.appendChild(addButton);
  }

  if (variant === 'footer' && typeof onToggleCollapse === 'function') {
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'leaderboard__toggleBtn';
    toggleButton.setAttribute('aria-label', t('leaderboard'));
    toggleButton.addEventListener('click', () => onToggleCollapse());
    header.appendChild(toggleButton);
  }

  const list = document.createElement('div');
  list.className = 'leaderboard__list';

  el.append(header, list);

  // Close any swiped-open row when tapping/clicking outside it
  const onDocPointerDown = (e) => {
    if (_activeSwipeState && !_activeSwipeState.wrap.contains(e.target)) {
      closeActiveSwipeRow();
    }
  };
  document.addEventListener('pointerdown', onDocPointerDown);

  function setCollapsed(nextCollapsed) {
    const isCollapsed = !!nextCollapsed;
    el.classList.toggle('leaderboard--collapsed', isCollapsed);

    const toggleButton = header.querySelector('.leaderboard__toggleBtn');
    if (toggleButton) {
      toggleButton.textContent = isCollapsed ? '▾' : '▴';
      toggleButton.setAttribute('aria-expanded', String(!isCollapsed));
    }
  }

  function update(nextPlayers = []) {
    closeActiveSwipeRow(); // close before rebuilding DOM

    const sortedPlayers = sortPlayersByScore(nextPlayers);
    const playerCount = sortedPlayers.length;
    const leader = sortedPlayers[0] || null;

    if (variant === 'footer') {
      status.textContent = leader
        ? `${playerCount} • ${leader.name} • ${formatPoints(leader.points)}`
        : String(playerCount);
    }

    list.innerHTML = '';

    if (!sortedPlayers.length) {
      const empty = document.createElement('div');
      empty.className = 'leaderboard__empty';
      empty.textContent = t('no_players_yet');
      list.appendChild(empty);
      return;
    }

    for (const player of sortedPlayers) {
      list.appendChild(buildRow(player, onDeletePlayer));
    }
  }

  setCollapsed(collapsed);
  update(players);

  el.update = update;
  el.setCollapsed = setCollapsed;
  el.destroy = () => {
    document.removeEventListener('pointerdown', onDocPointerDown);
    closeActiveSwipeRow();
  };
  return el;
}

function buildRow(player, onDeletePlayer) {
  const row = document.createElement('div');
  row.className = 'leaderboard__row';

  const name = document.createElement('div');
  name.className = 'leaderboard__nameLabel';
  name.textContent = player?.name || t('player_fallback');

  const points = document.createElement('div');
  points.className = 'leaderboard__scoreValue';
  points.textContent = formatPoints(player?.points);
  points.setAttribute('aria-label', `Points: ${player?.points ?? 0}`);

  row.append(name, points);

  // No swipe needed when delete is not available (e.g. in-game footer)
  if (typeof onDeletePlayer !== 'function') return row;

  // ── Swipe-to-delete wrapper ──────────────────────────────────────────────
  const wrap = document.createElement('div');
  wrap.className = 'leaderboard__rowWrap';

  const reveal = document.createElement('div');
  reveal.className = 'leaderboard__deleteReveal';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'leaderboard__deleteRevealBtn';
  deleteBtn.setAttribute('aria-label', t('remove_player_aria', { name: player?.name || t('player_fallback') }));
  deleteBtn.textContent = t('delete');
  deleteBtn.addEventListener('click', () => onDeletePlayer(player.id));

  reveal.appendChild(deleteBtn);
  wrap.append(reveal, row);

  bindSwipeDelete(wrap, row);

  return wrap;
}

// ── Swipe gesture handler ────────────────────────────────────────────────────

function bindSwipeDelete(wrap, row) {
  let startX = 0, startY = 0;
  let isDragging  = false; // committed to horizontal swipe
  let isScrolling = false; // committed to vertical scroll
  let baseOffset  = 0;     // translation at touchstart: 0 or -REVEAL_W
  let isOpen      = false;

  function setTranslate(x, animated) {
    row.style.transition = animated
      ? 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      : 'none';
    row.style.transform = x === 0 ? '' : `translateX(${x}px)`;
  }

  function openRow() {
    // Close whichever other row is currently open
    if (_activeSwipeState && _activeSwipeState.wrap !== wrap) {
      _activeSwipeState.close();
    }
    isOpen = true;
    _activeSwipeState = { wrap, close: closeRow };
    setTranslate(-REVEAL_W, true);
  }

  function closeRow() {
    isOpen = false;
    if (_activeSwipeState?.wrap === wrap) _activeSwipeState = null;
    setTranslate(0, true);
  }

  // ── Touch events ────────────────────────────────────────────────────────

  wrap.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX     = t.clientX;
    startY     = t.clientY;
    baseOffset = isOpen ? -REVEAL_W : 0;
    isDragging  = false;
    isScrolling = false;
    row.style.transition = 'none';
  }, { passive: true });

  wrap.addEventListener('touchmove', (e) => {
    if (isScrolling) return;

    const t  = e.touches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (!isDragging) {
      // Wait for a clear directional signal
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      if (Math.abs(dy) > Math.abs(dx)) { isScrolling = true; return; }
      isDragging = true;
    }

    e.preventDefault(); // block scroll once we own the swipe
    const clamped = Math.max(-REVEAL_W, Math.min(0, baseOffset + dx));
    row.style.transform = `translateX(${clamped}px)`;
  }, { passive: false });

  wrap.addEventListener('touchend', (e) => {
    if (!isDragging) { isDragging = false; isScrolling = false; return; }

    const t     = e.changedTouches[0];
    const dx    = t.clientX - startX;
    const total = baseOffset + dx;
    isDragging  = false;
    isScrolling = false;

    // Snap open if dragged more than halfway, otherwise snap shut
    if (total < -(REVEAL_W / 2)) {
      openRow();
    } else {
      closeRow();
    }
  });

  wrap.addEventListener('touchcancel', () => {
    isDragging  = false;
    isScrolling = false;
    closeRow();
  });

  // ── Mouse drag (desktop) ─────────────────────────────────────────────────

  wrap.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;

    const startX    = e.clientX;
    const baseOff   = isOpen ? -REVEAL_W : 0;
    let   dragging  = false;

    row.style.transition = 'none';

    function onMove(e) {
      const dx = e.clientX - startX;
      if (!dragging && Math.abs(dx) < 5) return;
      dragging = true;
      const clamped = Math.max(-REVEAL_W, Math.min(0, baseOff + dx));
      row.style.transform = `translateX(${clamped}px)`;
    }

    function onUp(e) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
      if (!dragging) return;
      const total = baseOff + (e.clientX - startX);
      if (total < -(REVEAL_W / 2)) openRow(); else closeRow();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

function formatPoints(value) {
  const numeric = Number(value) || 0;
  if (numeric === 0) return '000';
  return String(numeric);
}
