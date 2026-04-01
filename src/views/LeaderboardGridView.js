const REVEAL_W = 80; // px — width of the delete action strip
let _activeSwipeState = null;

import { sortPlayersByScore } from './leaderboardSort.js';
import { t } from '../i18n.js';

function closeActiveSwipeRow() {
  _activeSwipeState?.close();
}

function getRankLabel(rank) {
  if (rank === 0) return '#1';
  if (rank === 1) return '#2';
  if (rank === 2) return '#3';
  return `#${rank + 1}`;
}

export function LeaderboardGridView({
  players = [],
  variant = 'page',
  collapsed = false,
  onToggleCollapse = null,
  onOpenOverlay = null,
  onCloseOverlay = null,
  onAddPlayer = null,
  onDeletePlayer = null,
} = {}) {
  const el = document.createElement('footer');
  el.className = `app-footer leaderboard leaderboard--${variant}`;
  if (variant === 'overlay') {
    el.tabIndex = -1;
  }

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
  status.hidden = !['footer', 'preview'].includes(variant);
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

  if (variant === 'preview' && typeof onOpenOverlay === 'function') {
    const openButton = document.createElement('button');
    openButton.type = 'button';
    openButton.className = 'leaderboard__openBtn';
    openButton.textContent = '↗';
    openButton.setAttribute('aria-label', t('open_leaderboard'));
    openButton.addEventListener('click', (event) => {
      event.stopPropagation();
      onOpenOverlay();
    });
    header.appendChild(openButton);
    el.addEventListener('click', () => onOpenOverlay());
  }

  if (variant === 'overlay' && typeof onCloseOverlay === 'function') {
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'leaderboard__closeBtn';
    closeButton.textContent = '×';
    closeButton.setAttribute('aria-label', t('close'));
    closeButton.addEventListener('click', () => onCloseOverlay());
    header.appendChild(closeButton);
    el.addEventListener('click', (event) => {
      if (event.target === el) onCloseOverlay();
    });
    document.addEventListener('keydown', onEscClose);
  }

  const list = document.createElement('div');
  list.className = 'leaderboard__list';
  const panel = document.createElement('div');
  panel.className = 'leaderboard__panel';
  panel.append(header, list);

  if (variant === 'overlay') {
    const overlay = document.createElement('div');
    overlay.className = 'leaderboard__overlay';
    overlay.addEventListener('click', () => onCloseOverlay?.());
    el.append(overlay, panel);
  } else {
    el.append(panel);
  }

  // Close any swiped-open row when tapping/clicking outside it
  const onDocPointerDown = (e) => {
    if (_activeSwipeState && !_activeSwipeState.wrap.contains(e.target)) {
      closeActiveSwipeRow();
    }
  };
  document.addEventListener('pointerdown', onDocPointerDown);

  function onEscClose(event) {
    if (event.key === 'Escape') onCloseOverlay?.();
  }

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

    if (['footer', 'preview'].includes(variant)) {
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

    const displayPlayers = variant === 'preview' ? sortedPlayers.slice(0, 4) : sortedPlayers;

    for (const [index, player] of displayPlayers.entries()) {
      list.appendChild(buildRow(player, onDeletePlayer, index, variant));
    }

    if (variant === 'preview' && sortedPlayers.length > displayPlayers.length) {
      const more = document.createElement('div');
      more.className = 'leaderboard__more';
      more.textContent = `+${sortedPlayers.length - displayPlayers.length}`;
      list.appendChild(more);
    }
  }

  setCollapsed(collapsed);
  update(players);

  el.update = update;
  el.setCollapsed = setCollapsed;
  el.destroy = () => {
    document.removeEventListener('pointerdown', onDocPointerDown);
    document.removeEventListener('keydown', onEscClose);
    closeActiveSwipeRow();
  };
  return el;
}

function buildRow(player, onDeletePlayer, rank = 0, variant = 'page') {
  const row = document.createElement('div');
  row.className = 'leaderboard__row';
  if (rank === 0) row.classList.add('is-leading');
  if (variant === 'preview') row.classList.add('leaderboard__row--preview');

  const rankEl = document.createElement('div');
  rankEl.className = 'leaderboard__rank';
  rankEl.textContent = getRankLabel(rank);

  const name = document.createElement('div');
  name.className = 'leaderboard__nameLabel';
  name.textContent = player?.name || t('player_fallback');

  const points = document.createElement('div');
  points.className = 'leaderboard__scoreValue';
  points.textContent = formatPoints(player?.points);
  points.setAttribute('aria-label', `Points: ${player?.points ?? 0}`);

  row.append(rankEl, name, points);

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
