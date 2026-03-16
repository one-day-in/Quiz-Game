import {
  MAX_PLAYERS,
  adjustPlayerScoreByController,
  claimPlayerSlot,
  getPlayerByController,
  getPlayers,
  removePlayerByController,
  subscribeToPlayers,
  updatePlayerByController,
} from './api/gameApi.js';

const root = document.getElementById('player-controller-app');
const params = new URLSearchParams(window.location.search);
const gameId = params.get('gameId');
const STORAGE_PREFIX = 'quiz-game:player-controller';

let player = null;
let controllerId = null;
let stopPlayersSubscription = null;
let gameRefreshTimer = null;
let confirmedScore = 0;
let pendingScoreDelta = 0;
let isScoreSyncInFlight = false;
let scoreFlushTimer = null;

const SCORE_FLUSH_DELAY_MS = 220;

async function startPlayerController() {
  if (!gameId) {
    renderError('No game selected', 'Scan the QR code from the game screen.');
    return;
  }

  controllerId = getOrCreateControllerId(gameId);
  renderLoading('Loading player controller...');

  try {
    player = await getPlayerByController(gameId, controllerId);
    bindRealtimePlayers();
    startGameRefreshLoop();
    if (player) {
      renderController(player);
      return;
    }

    renderJoin();
  } catch (error) {
    renderError('Failed to load player', error.message);
  }
}

function renderLoading(message) {
  root.innerHTML = `
    <div class="player-controller">
      <div class="page-loader">
        <div class="page-loader__ring"></div>
        <p class="page-loader__text">${message}</p>
      </div>
    </div>
  `;
}

function renderError(title, detail) {
  root.innerHTML = `
    <div class="player-controller">
      <div class="page-error">
        <h2 class="page-error__title">${title}</h2>
        <pre class="page-error__detail">${detail}</pre>
      </div>
    </div>
  `;
}

function renderJoin() {
  root.innerHTML = `
    <main class="player-controller">
      <section class="player-controller__card">
        <p class="player-controller__eyebrow">Join game</p>
        <h1 class="player-controller__title">Choose your player name</h1>
        <p class="player-controller__copy">Up to ${MAX_PLAYERS} players can connect to this game.</p>
        <form class="player-controller__joinForm" id="playerJoinForm">
          <label class="player-controller__field">
            <span class="player-controller__label">Player name</span>
            <input
              id="playerNameInput"
              class="player-controller__input"
              type="text"
              maxlength="24"
              autocomplete="nickname"
              placeholder="Your name"
              required
            >
          </label>
          <button class="player-controller__primary" type="submit">Join controller</button>
        </form>
        <p id="playerJoinError" class="player-controller__error" hidden></p>
      </section>
    </main>
  `;

  const form = document.getElementById('playerJoinForm');
  const input = document.getElementById('playerNameInput');
  const errorEl = document.getElementById('playerJoinError');
  input?.focus();

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = input?.value?.trim();
    if (!name) return;

    toggleJoinPending(true);
    errorEl.hidden = true;

    try {
      player = await claimPlayerSlot(gameId, { name, controllerId });
      savePlayerBinding(gameId, { playerId: player.id, controllerId });
      renderController(player);
      bindRealtimePlayers();
    } catch (error) {
      errorEl.textContent = error.message || 'Could not join the game';
      errorEl.hidden = false;
      toggleJoinPending(false);
    }
  });
}

function renderController(currentPlayer) {
  player = currentPlayer;
  confirmedScore = Number(currentPlayer.points) || 0;
  pendingScoreDelta = 0;
  clearTimeout(scoreFlushTimer);
  scoreFlushTimer = null;

  root.innerHTML = `
    <main class="player-controller">
      <section class="player-controller__card player-controller__card--controller">
        <p class="player-controller__eyebrow">Player controller</p>
        <h1 class="player-controller__title">Manage your score</h1>
        <label class="player-controller__field">
          <span class="player-controller__label">Your name</span>
          <input
            id="playerControllerName"
            class="player-controller__input"
            type="text"
            maxlength="24"
            value="${escapeHtml(currentPlayer.name)}"
          >
        </label>
        <div class="player-controller__scoreCard">
          <span class="player-controller__scoreLabel">Current score</span>
          <strong id="playerScoreValue" class="player-controller__scoreValue">${formatPoints(currentPlayer.points)}</strong>
        </div>
        <div class="player-controller__actions">
          <button class="player-controller__scoreBtn player-controller__scoreBtn--minus" data-delta="-100" type="button">-100</button>
          <button class="player-controller__scoreBtn player-controller__scoreBtn--plus" data-delta="100" type="button">+100</button>
        </div>
        <button id="playerDeleteBtn" class="player-controller__secondary player-controller__secondary--danger" type="button">Leave game</button>
        <p id="playerControllerStatus" class="player-controller__status" hidden></p>
      </section>
    </main>
  `;

  const scoreEl = document.getElementById('playerScoreValue');
  const statusEl = document.getElementById('playerControllerStatus');
  const nameInput = document.getElementById('playerControllerName');
  const deleteBtn = document.getElementById('playerDeleteBtn');

  root.querySelectorAll('[data-delta]').forEach((button) => {
    button.addEventListener('click', async () => {
      const delta = Number(button.dataset.delta);
      queueScoreDelta(delta, scoreEl, statusEl);
    });
  });

  nameInput?.addEventListener('change', async () => {
    const nextName = nameInput.value.trim();
    if (!nextName || nextName === player.name) {
      nameInput.value = player.name;
      return;
    }

    setControllerPending(true);
    try {
      player = await updatePlayerByController(gameId, controllerId, { name: nextName });
      nameInput.value = player.name;
      statusEl.hidden = true;
    } catch (error) {
      statusEl.textContent = error.message || 'Could not update name';
      statusEl.hidden = false;
      nameInput.value = player.name;
    } finally {
      setControllerPending(false);
    }
  });

  deleteBtn?.addEventListener('click', async () => {
    if (!player || !window.confirm(`Remove ${player.name} from this game?`)) return;

    setControllerPending(true);
    try {
      await removePlayerByController(gameId, controllerId);
      clearPlayerBinding(gameId);
      player = null;
      renderJoin();
    } catch (error) {
      statusEl.textContent = error.message || 'Could not leave the game';
      statusEl.hidden = false;
    } finally {
      setControllerPending(false);
    }
  });
}

function bindRealtimePlayers() {
  stopPlayersSubscription?.();
  stopPlayersSubscription = subscribeToPlayers(gameId, (players) => {
    syncControllerFromPlayers(players);
  });
}

function startGameRefreshLoop() {
  clearInterval(gameRefreshTimer);
  gameRefreshTimer = window.setInterval(async () => {
    try {
      const players = await getPlayers(gameId);
      syncControllerFromPlayers(players);
    } catch (_) {
      // Ignore transient refresh failures on mobile.
    }
  }, 1000);
}

function syncControllerFromPlayers(players = []) {
  const nextPlayer = players.find((entry) => entry.controllerId === controllerId || entry.id === player?.id) ?? null;
  if (!nextPlayer) {
    if (player) {
      player = null;
      clearPlayerBinding(gameId);
      renderJoin();
    }
    return;
  }

  const scoreEl = document.getElementById('playerScoreValue');
  const nameInput = document.getElementById('playerControllerName');
  if (!scoreEl || !nameInput) {
    renderController(nextPlayer);
    return;
  }

  player = nextPlayer;
  confirmedScore = Number(nextPlayer.points) || 0;
  scoreEl.textContent = formatPoints(confirmedScore + pendingScoreDelta);
  if (document.activeElement !== nameInput) {
    nameInput.value = nextPlayer.name;
  }
}

function queueScoreDelta(delta, scoreEl, statusEl) {
  pendingScoreDelta += Number(delta) || 0;
  scoreEl.textContent = formatPoints(confirmedScore + pendingScoreDelta);
  statusEl.hidden = true;

  clearTimeout(scoreFlushTimer);
  scoreFlushTimer = window.setTimeout(() => {
    void flushQueuedScoreDelta(scoreEl, statusEl);
  }, SCORE_FLUSH_DELAY_MS);
}

async function flushQueuedScoreDelta(scoreEl, statusEl) {
  if (isScoreSyncInFlight || pendingScoreDelta === 0 || !controllerId) return;

  const delta = pendingScoreDelta;
  pendingScoreDelta = 0;
  isScoreSyncInFlight = true;

  try {
    player = await adjustPlayerScoreByController(gameId, controllerId, delta);
    confirmedScore = Number(player.points) || 0;
    scoreEl.textContent = formatPoints(confirmedScore + pendingScoreDelta);
    statusEl.hidden = true;
  } catch (error) {
    pendingScoreDelta += delta;
    scoreEl.textContent = formatPoints(confirmedScore + pendingScoreDelta);
    statusEl.textContent = error.message || 'Could not update score';
    statusEl.hidden = false;
  } finally {
    isScoreSyncInFlight = false;

    if (pendingScoreDelta !== 0) {
      clearTimeout(scoreFlushTimer);
      scoreFlushTimer = window.setTimeout(() => {
        void flushQueuedScoreDelta(scoreEl, statusEl);
      }, SCORE_FLUSH_DELAY_MS);
    }
  }
}

function toggleJoinPending(isPending) {
  const form = document.getElementById('playerJoinForm');
  form?.querySelectorAll('input, button').forEach((element) => {
    element.disabled = isPending;
  });
}

function setControllerPending(isPending) {
  root.querySelectorAll('.player-controller__input, .player-controller__scoreBtn').forEach((element) => {
    element.disabled = isPending;
  });
}

function getOrCreateControllerId(gameIdValue) {
  const binding = loadPlayerBinding(gameIdValue);
  if (binding?.controllerId) return binding.controllerId;

  const nextControllerId = `ctrl_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  savePlayerBinding(gameIdValue, { controllerId: nextControllerId });
  return nextControllerId;
}

function loadPlayerBinding(gameIdValue) {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}:${gameIdValue}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function savePlayerBinding(gameIdValue, binding) {
  const previous = loadPlayerBinding(gameIdValue) || {};
  localStorage.setItem(`${STORAGE_PREFIX}:${gameIdValue}`, JSON.stringify({ ...previous, ...binding }));
}

function clearPlayerBinding(gameIdValue) {
  localStorage.removeItem(`${STORAGE_PREFIX}:${gameIdValue}`);
}

function formatPoints(value) {
  const numeric = Number(value) || 0;
  if (numeric === 0) return '000';
  return String(numeric);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function disableZoomGestures() {
  document.addEventListener('gesturestart', (event) => {
    event.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });
}

disableZoomGestures();
startPlayerController().catch((error) => {
  console.error('[player] start failed:', error);
  renderError('Failed to load controller', error.message || String(error));
});

window.addEventListener('beforeunload', () => {
  stopPlayersSubscription?.();
  clearTimeout(scoreFlushTimer);
});
