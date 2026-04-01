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
  footerLimit = 4,
  showHeader = true,
  onOpenExpanded = null,
  onAddPlayer = null,
  onDeletePlayer = null,
} = {}) {
  const el = document.createElement('footer');
  el.className = variant === 'drawer'
    ? `leaderboard leaderboard--${variant}`
    : `app-footer leaderboard leaderboard--${variant}`;

  const panel = document.createElement('div');
  panel.className = 'leaderboard__panel';
  el.appendChild(panel);

  let header = null;
  if (showHeader) {
    header = document.createElement('div');
    header.className = 'leaderboard__header';

    const title = document.createElement('div');
    title.className = 'leaderboard__title';
    title.textContent = t('leaderboard');
    header.appendChild(title);

    if (variant === 'page' && typeof onAddPlayer === 'function') {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'leaderboard__addPlayerBtn';
      addButton.textContent = t('add_player');
      addButton.addEventListener('click', () => onAddPlayer());
      header.appendChild(addButton);
    }

    if (variant === 'footer' && typeof onOpenExpanded === 'function') {
      const openButton = document.createElement('button');
      openButton.type = 'button';
      openButton.className = 'leaderboard__toggleBtn';
      openButton.textContent = t('show_all_players');
      openButton.setAttribute('aria-label', t('show_all_players'));
      openButton.addEventListener('click', () => onOpenExpanded());
      header.appendChild(openButton);
    }

    panel.appendChild(header);
  }

  const body = document.createElement('div');
  body.className = 'leaderboard__body';

  const list = document.createElement('div');
  list.className = 'leaderboard__list';
  if (variant === 'footer') list.classList.add('leaderboard__list--cards');
  if (variant === 'drawer') list.classList.add('leaderboard__list--drawer');

  body.appendChild(list);
  panel.appendChild(body);

  const onDocPointerDown = (event) => {
    if (_activeSwipeState && !_activeSwipeState.wrap.contains(event.target)) {
      closeActiveSwipeRow();
    }
  };

  if (typeof onDeletePlayer === 'function') {
    document.addEventListener('pointerdown', onDocPointerDown);
  }

  function update(nextPlayers = []) {
    closeActiveSwipeRow();

    const sortedPlayers = sortPlayersByScore(nextPlayers);
    list.innerHTML = '';

    if (variant === 'footer') {
      renderFooterCards(sortedPlayers);
      return;
    }

    renderRows(sortedPlayers);
  }

  function renderFooterCards(sortedPlayers) {
    if (!sortedPlayers.length) {
      const empty = document.createElement('div');
      empty.className = 'leaderboard__emptyCard';
      empty.textContent = t('no_players_yet');
      list.appendChild(empty);
      return;
    }

    const visiblePlayers = sortedPlayers.slice(0, footerLimit);
    for (const [index, player] of visiblePlayers.entries()) {
      list.appendChild(buildFooterCard(player, index));
    }

    const hiddenCount = sortedPlayers.length - visiblePlayers.length;
    if (hiddenCount > 0) {
      const moreCard = document.createElement('button');
      moreCard.type = 'button';
      moreCard.className = 'leaderboard__card leaderboard__card--more';
      moreCard.innerHTML = `
        <span class="leaderboard__cardMoreCount">+${hiddenCount}</span>
        <span class="leaderboard__cardMoreLabel">${t('show_all_players')}</span>
      `;
      moreCard.addEventListener('click', () => onOpenExpanded?.());
      list.appendChild(moreCard);
    }
  }

  function renderRows(sortedPlayers) {
    if (!sortedPlayers.length) {
      const empty = document.createElement('div');
      empty.className = 'leaderboard__empty';
      empty.textContent = t('no_players_yet');
      list.appendChild(empty);
      return;
    }

    for (const [index, player] of sortedPlayers.entries()) {
      list.appendChild(buildRow(player, onDeletePlayer, index));
    }
  }

  update(players);

  el.update = update;
  el.destroy = () => {
    if (typeof onDeletePlayer === 'function') {
      document.removeEventListener('pointerdown', onDocPointerDown);
    }
    closeActiveSwipeRow();
  };
  return el;
}

function buildFooterCard(player, rank = 0) {
  const card = document.createElement('div');
  card.className = 'leaderboard__card';
  if (rank === 0) card.classList.add('is-leading');

  const rankEl = document.createElement('div');
  rankEl.className = 'leaderboard__cardRank';
  rankEl.textContent = getRankLabel(rank);

  const name = document.createElement('div');
  name.className = 'leaderboard__cardName';
  name.textContent = player?.name || t('player_fallback');

  const points = document.createElement('div');
  points.className = 'leaderboard__cardScore';
  points.textContent = formatPoints(player?.points);

  card.append(rankEl, name, points);
  return card;
}

function buildRow(player, onDeletePlayer, rank = 0) {
  const row = document.createElement('div');
  row.className = 'leaderboard__row';
  if (rank === 0) row.classList.add('is-leading');

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

  if (typeof onDeletePlayer !== 'function') return row;

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

function bindSwipeDelete(wrap, row) {
  let startX = 0;
  let startY = 0;
  let isDragging = false;
  let isScrolling = false;
  let baseOffset = 0;
  let isOpen = false;

  function setTranslate(x, animated) {
    row.style.transition = animated
      ? 'transform 0.28s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
      : 'none';
    row.style.transform = x === 0 ? '' : `translateX(${x}px)`;
  }

  function openRow() {
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

  wrap.addEventListener('touchstart', (event) => {
    const touch = event.touches[0];
    startX = touch.clientX;
    startY = touch.clientY;
    baseOffset = isOpen ? -REVEAL_W : 0;
    isDragging = false;
    isScrolling = false;
    row.style.transition = 'none';
  }, { passive: true });

  wrap.addEventListener('touchmove', (event) => {
    if (isScrolling) return;

    const touch = event.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (!isDragging) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        isScrolling = true;
        return;
      }
      isDragging = true;
    }

    event.preventDefault();
    const clamped = Math.max(-REVEAL_W, Math.min(0, baseOffset + dx));
    row.style.transform = `translateX(${clamped}px)`;
  }, { passive: false });

  wrap.addEventListener('touchend', (event) => {
    if (!isDragging) {
      isDragging = false;
      isScrolling = false;
      return;
    }

    const touch = event.changedTouches[0];
    const total = baseOffset + (touch.clientX - startX);
    isDragging = false;
    isScrolling = false;

    if (total < -(REVEAL_W / 2)) openRow();
    else closeRow();
  });

  wrap.addEventListener('touchcancel', () => {
    isDragging = false;
    isScrolling = false;
    closeRow();
  });

  wrap.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;

    const dragStartX = event.clientX;
    const dragBaseOffset = isOpen ? -REVEAL_W : 0;
    let dragging = false;

    row.style.transition = 'none';

    function onMove(moveEvent) {
      const dx = moveEvent.clientX - dragStartX;
      if (!dragging && Math.abs(dx) < 5) return;
      dragging = true;
      const clamped = Math.max(-REVEAL_W, Math.min(0, dragBaseOffset + dx));
      row.style.transform = `translateX(${clamped}px)`;
    }

    function onUp(upEvent) {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragging) return;
      const total = dragBaseOffset + (upEvent.clientX - dragStartX);
      if (total < -(REVEAL_W / 2)) openRow();
      else closeRow();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function formatPoints(points) {
  return String(points ?? 0);
}
