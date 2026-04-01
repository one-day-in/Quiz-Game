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
  onAdjustPlayerScore = null,
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

  body.appendChild(list);
  panel.appendChild(body);

  const itemNodes = new Map();
  let emptyNode = null;
  let moreNode = null;

  const onDocPointerDown = (event) => {
    if (_activeSwipeState && !_activeSwipeState.wrap.contains(event.target)) {
      closeActiveSwipeRow();
    }
  };

  if (typeof onDeletePlayer === 'function') {
    document.addEventListener('pointerdown', onDocPointerDown);
  }

  function update(nextPlayers = []) {
    const sortedPlayers = sortPlayersByScore(Array.isArray(nextPlayers) ? nextPlayers : []);

    if (variant === 'footer') {
      syncFooterCards(sortedPlayers);
      return;
    }

    syncRows(sortedPlayers);
  }

  function syncFooterCards(sortedPlayers) {
    list.classList.toggle('is-empty', sortedPlayers.length === 0);

    if (!sortedPlayers.length) {
      clearPlayerNodes();
      removeMoreNode();
      ensureEmptyNode('leaderboard__emptyFooter');
      return;
    }

    removeEmptyNode();

    const visiblePlayers = sortedPlayers.slice(0, footerLimit);
    const visibleKeys = new Set(visiblePlayers.map(getPlayerKey));
    removeStaleNodes(visibleKeys);

    for (const [index, player] of visiblePlayers.entries()) {
      const key = getPlayerKey(player);
      let node = itemNodes.get(key);
      if (!node) {
        node = createFooterCard();
        itemNodes.set(key, node);
      }
      patchFooterCard(node, player, index);
      list.appendChild(node);
    }

    const hiddenCount = sortedPlayers.length - visiblePlayers.length;
    if (hiddenCount > 0) {
      if (!moreNode) {
        moreNode = createMoreCard(onOpenExpanded);
      }
      patchMoreCard(moreNode, hiddenCount);
      list.appendChild(moreNode);
    } else {
      removeMoreNode();
    }
  }

  function syncRows(sortedPlayers) {
    list.classList.remove('is-empty');

    if (!sortedPlayers.length) {
      clearPlayerNodes();
      ensureEmptyNode('leaderboard__empty');
      return;
    }

    removeEmptyNode();

    const playerKeys = new Set(sortedPlayers.map(getPlayerKey));
    removeStaleNodes(playerKeys);

    for (const [index, player] of sortedPlayers.entries()) {
      const key = getPlayerKey(player);
      let node = itemNodes.get(key);
      if (!node) {
        node = createRow(player, { variant, onDeletePlayer, onAdjustPlayerScore });
        itemNodes.set(key, node);
      }
      patchRow(node, player, index, { variant });
      list.appendChild(node);
    }
  }

  function ensureEmptyNode(className) {
    if (!emptyNode) {
      emptyNode = document.createElement('div');
    }
    emptyNode.className = className;
    emptyNode.textContent = t('no_players_yet');
    list.appendChild(emptyNode);
  }

  function removeEmptyNode() {
    emptyNode?.remove();
  }

  function removeMoreNode() {
    moreNode?.remove();
  }

  function clearPlayerNodes() {
    const shouldCloseActiveRow = _activeSwipeState && list.contains(_activeSwipeState.wrap);

    for (const node of itemNodes.values()) {
      node.remove();
    }
    itemNodes.clear();

    if (shouldCloseActiveRow) closeActiveSwipeRow();
  }

  function removeStaleNodes(validKeys) {
    for (const [key, node] of itemNodes.entries()) {
      if (validKeys.has(key)) continue;
      if (_activeSwipeState && (_activeSwipeState.wrap === node || node.contains?.(_activeSwipeState.wrap))) {
        closeActiveSwipeRow();
      }
      node.remove();
      itemNodes.delete(key);
    }
  }

  update(players);

  el.update = update;
  el.destroy = () => {
    if (typeof onDeletePlayer === 'function') {
      document.removeEventListener('pointerdown', onDocPointerDown);
    }
    if (_activeSwipeState && el.contains(_activeSwipeState.wrap)) {
      closeActiveSwipeRow();
    }
  };
  return el;
}

function createFooterCard() {
  const card = document.createElement('div');
  card.className = 'leaderboard__card';

  const name = document.createElement('div');
  name.className = 'leaderboard__cardName';

  const points = document.createElement('div');
  points.className = 'leaderboard__cardScore';

  card.append(name, points);
  card._parts = { name, points };
  return card;
}

function patchFooterCard(card, player, rank = 0) {
  card.classList.toggle('is-leading', rank === 0);
  card._parts.name.textContent = player?.name || t('player_fallback');
  card._parts.points.textContent = formatPoints(player?.points);
}

function createMoreCard(onOpenExpanded) {
  const moreCard = document.createElement('button');
  moreCard.type = 'button';
  moreCard.className = 'leaderboard__card leaderboard__card--more';

  const count = document.createElement('span');
  count.className = 'leaderboard__cardMoreCount';

  const label = document.createElement('span');
  label.className = 'leaderboard__cardMoreLabel';
  label.textContent = t('show_all_players');

  moreCard.append(count, label);
  moreCard._parts = { count, label };
  moreCard.addEventListener('click', () => onOpenExpanded?.());
  return moreCard;
}

function patchMoreCard(moreCard, hiddenCount) {
  moreCard._parts.count.textContent = `+${hiddenCount}`;
}

function createRow(player, { variant = 'page', onDeletePlayer = null, onAdjustPlayerScore = null } = {}) {
  const row = document.createElement('div');
  row.className = 'leaderboard__row';

  const rankEl = document.createElement('div');
  rankEl.className = 'leaderboard__rank';

  const name = document.createElement('div');
  name.className = 'leaderboard__nameLabel';

  const points = document.createElement('div');
  points.className = 'leaderboard__scoreValue';

  row.append(rankEl, name, points);
  row._parts = { rankEl, name, points };

  if (variant === 'drawer') {
    const actions = document.createElement('div');
    actions.className = 'leaderboard__rowActions';

    const minusBtn = document.createElement('button');
    minusBtn.type = 'button';
    minusBtn.className = 'leaderboard__rowActionBtn';
    minusBtn.textContent = '-100';
    minusBtn.addEventListener('click', (event) => {
      const playerId = event.currentTarget.closest('.leaderboard__row')?.dataset.playerId;
      if (playerId) onAdjustPlayerScore?.(playerId, -100);
    });

    const plusBtn = document.createElement('button');
    plusBtn.type = 'button';
    plusBtn.className = 'leaderboard__rowActionBtn';
    plusBtn.textContent = '+100';
    plusBtn.addEventListener('click', (event) => {
      const playerId = event.currentTarget.closest('.leaderboard__row')?.dataset.playerId;
      if (playerId) onAdjustPlayerScore?.(playerId, 100);
    });

    actions.append(minusBtn, plusBtn);
    row.appendChild(actions);
    row._parts.actions = actions;
    row._parts.minusBtn = minusBtn;
    row._parts.plusBtn = plusBtn;
  }

  if (typeof onDeletePlayer !== 'function') return row;

  const wrap = document.createElement('div');
  wrap.className = 'leaderboard__rowWrap';

  const reveal = document.createElement('div');
  reveal.className = 'leaderboard__deleteReveal';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'leaderboard__deleteRevealBtn';
  deleteBtn.textContent = t('delete');
  deleteBtn.addEventListener('click', () => {
    const playerId = wrap._row?.dataset.playerId;
    if (playerId) onDeletePlayer(playerId);
  });

  reveal.appendChild(deleteBtn);
  wrap.append(reveal, row);
  wrap._row = row;
  wrap._deleteBtn = deleteBtn;

  bindSwipeDelete(wrap, row);

  return wrap;
}

function patchRow(node, player, rank = 0, { variant = 'page' } = {}) {
  const row = node._row || node;
  row.dataset.playerId = String(player?.id ?? '');
  if (node !== row) node.dataset.playerId = String(player?.id ?? '');
  row.classList.toggle('is-leading', rank === 0);
  row._parts.rankEl.textContent = getRankLabel(rank);
  row._parts.name.textContent = player?.name || t('player_fallback');
  row._parts.points.textContent = formatPoints(player?.points);
  row._parts.points.setAttribute('aria-label', `Points: ${player?.points ?? 0}`);
  node._deleteBtn?.setAttribute('aria-label', t('remove_player_aria', { name: player?.name || t('player_fallback') }));
}

function getPlayerKey(player) {
  return String(player?.id ?? player?.controllerId ?? player?.joinedAt ?? player?.name ?? 'unknown-player');
}

function bindSwipeDelete(wrap, row) {
  let startX = 0;
  let startY = 0;
  let isDragging = false;
  let isScrolling = false;
  let baseOffset = 0;
  let isOpen = false;

  function setTranslate(x, animated) {
    wrap.classList.toggle('is-revealing', x < 0);
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
    wrap.classList.add('is-open');
    _activeSwipeState = { wrap, close: closeRow };
    setTranslate(-REVEAL_W, true);
  }

  function closeRow() {
    isOpen = false;
    wrap.classList.remove('is-open');
    if (_activeSwipeState?.wrap === wrap) _activeSwipeState = null;
    setTranslate(0, true);
  }

  function shouldIgnoreSwipeStart(target) {
    return !!target?.closest?.('.leaderboard__rowActions, .leaderboard__deleteRevealBtn, button, a, input, textarea, select, label');
  }

  wrap.addEventListener('touchstart', (event) => {
    if (shouldIgnoreSwipeStart(event.target)) return;
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
    if (shouldIgnoreSwipeStart(event.target)) return;

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
