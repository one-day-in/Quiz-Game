import {
  MAX_PLAYERS,
  adjustPlayerScoreByController,
  claimPlayerSlot,
  claimGamePress,
  getGameRuntime,
  getPlayerByController,
  getPlayers,
  removePlayerByController,
  subscribeToGameRuntime,
  subscribeToPlayers,
  updatePlayerByController,
} from './api/gameApi.js';
import { initLanguageFromUrl, t } from './i18n.js';

const root = document.getElementById('player-controller-app');
initLanguageFromUrl();
const params = new URLSearchParams(window.location.search);
const gameId = params.get('gameId');
const STORAGE_PREFIX = 'quiz-game:player-controller';

let player = null;
let controllerId = null;
let stopPlayersSubscription = null;
let stopRuntimeSubscription = null;
let gameRefreshTimer = null;
let confirmedScore = 0;
let pendingScoreDelta = 0;
let isScoreSyncInFlight = false;
let scoreFlushTimer = null;
let isPressEnabled = false;
let pressWinnerPlayerId = null;

const SCORE_FLUSH_DELAY_MS = 220;
const CONTROLLER_DISABLED_SELECTOR = '.player-controller__input, .player-controller__scoreBtn';

async function startPlayerController() {
  if (!gameId) {
    renderError(t('no_game_selected'), t('scan_qr_from_game_screen'));
    return;
  }

  controllerId = getOrCreateControllerId(gameId);
  renderLoading(t('loading_player_controller'));

  try {
    player = await getPlayerByController(gameId, controllerId);
    await syncPressRuntime();
    bindRealtimePlayers();
    bindRuntimeState();
    startGameRefreshLoop();
    if (player) {
      renderController(player);
      return;
    }

    renderJoin();
  } catch (error) {
    renderError(t('failed_to_load_player'), error.message);
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
        <p class="player-controller__eyebrow">${t('join_game')}</p>
        <h1 class="player-controller__title">${t('choose_player_name')}</h1>
        <p class="player-controller__copy">${t('players_can_connect', { count: MAX_PLAYERS })}</p>
        <form class="player-controller__joinForm" id="playerJoinForm">
          <label class="player-controller__field">
            <span class="player-controller__label">${t('player_name')}</span>
            <input
              id="playerNameInput"
              class="player-controller__input"
              type="text"
              maxlength="24"
              autocomplete="nickname"
              placeholder="${t('your_name')}"
              required
            >
          </label>
          <button class="player-controller__primary" type="submit">${t('join_controller')}</button>
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
      errorEl.textContent = error.message || t('could_not_join_game');
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
        <p class="player-controller__eyebrow">${t('player_controller')}</p>
        <h1 class="player-controller__title">${t('manage_score')}</h1>
        <label class="player-controller__field">
          <span class="player-controller__label">${t('your_name')}</span>
          <input
            id="playerControllerName"
            class="player-controller__input"
            type="text"
            maxlength="24"
            value="${escapeHtml(currentPlayer.name)}"
          >
        </label>
        <div class="player-controller__scoreCard">
          <span class="player-controller__scoreLabel">${t('current_score')}</span>
          <strong id="playerScoreValue" class="player-controller__scoreValue">${formatPoints(currentPlayer.points)}</strong>
        </div>
        <div class="player-controller__actions">
          <button class="player-controller__scoreBtn player-controller__scoreBtn--minus" data-delta="-100" type="button">-100</button>
          <button class="player-controller__scoreBtn player-controller__scoreBtn--plus" data-delta="100" type="button">+100</button>
        </div>
        <button id="playerPressBtn" class="player-controller__pressBtn" type="button">PRESS</button>
        <button id="playerDeleteBtn" class="player-controller__secondary player-controller__secondary--danger" type="button">${t('leave_game')}</button>
        <p id="playerControllerStatus" class="player-controller__status" hidden></p>
      </section>
    </main>
  `;

  const scoreEl = document.getElementById('playerScoreValue');
  const statusEl = document.getElementById('playerControllerStatus');
  const nameInput = document.getElementById('playerControllerName');
  const pressBtn = document.getElementById('playerPressBtn');
  const deleteBtn = document.getElementById('playerDeleteBtn');

  root.querySelectorAll('[data-delta]').forEach((button) => {
    button.addEventListener('click', async () => {
      const delta = Number(button.dataset.delta);
      queueScoreDelta(delta, scoreEl, statusEl);
    });
  });

  pressBtn?.addEventListener('click', () => {
    // Always give tactile feedback so the button feels alive
    pressBtn.classList.remove('is-pressed');
    void pressBtn.offsetWidth;
    pressBtn.classList.add('is-pressed');
    window.setTimeout(() => pressBtn.classList.remove('is-pressed'), 160);

    // Only actually claim the press when the host has opened a question
    if (!isPressEnabled || pressWinnerPlayerId) return;
    void claimPress(statusEl);
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
      statusEl.textContent = error.message || t('could_not_update_name');
      statusEl.hidden = false;
      nameInput.value = player.name;
    } finally {
      setControllerPending(false);
    }
  });

  deleteBtn?.addEventListener('click', async () => {
    if (!player || !window.confirm(t('remove_player_confirm', { name: player.name }))) return;

    setControllerPending(true);
    try {
      await removePlayerByController(gameId, controllerId);
      clearPlayerBinding(gameId);
      player = null;
      renderJoin();
    } catch (error) {
      statusEl.textContent = error.message || t('could_not_leave_game');
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

function bindRuntimeState() {
  stopRuntimeSubscription?.();
  stopRuntimeSubscription = subscribeToGameRuntime(gameId, (runtime) => {
    applyRuntimeState(runtime);
  });
}

function startGameRefreshLoop() {
  clearInterval(gameRefreshTimer);
  gameRefreshTimer = window.setInterval(() => {
    void Promise.allSettled([
      getPlayers(gameId)
        .then((players) => syncControllerFromPlayers(players))
        .catch(() => {}),
      getGameRuntime(gameId)
        .then((runtime) => { applyRuntimeState(runtime); })
        .catch(() => {}),
    ]);
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
  updateScoreDisplay(scoreEl);
  if (document.activeElement !== nameInput) {
    nameInput.value = nextPlayer.name;
  }
}

function applyRuntimeState(runtime) {
  isPressEnabled = !!runtime?.pressEnabled;
  pressWinnerPlayerId = runtime?.winnerPlayerId || null;
  const pressBtn = document.getElementById('playerPressBtn');
  if (!pressBtn) return;
  pressBtn.classList.toggle('is-enabled', !!isPressEnabled && !pressWinnerPlayerId);
}

async function syncPressRuntime() {
  try {
    applyRuntimeState(await getGameRuntime(gameId));
  } catch (_) {
    isPressEnabled = false;
    pressWinnerPlayerId = null;
  }
}

async function claimPress(statusEl) {
  try {
    applyRuntimeState(await claimGamePress(gameId, controllerId));
    hideStatus(statusEl);
  } catch (error) {
    statusEl.textContent = error.message || t('could_not_claim_press');
    statusEl.hidden = false;
  }
}

function queueScoreDelta(delta, scoreEl, statusEl) {
  pendingScoreDelta += Number(delta) || 0;
  updateScoreDisplay(scoreEl);
  hideStatus(statusEl);

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
    updateScoreDisplay(scoreEl);
    hideStatus(statusEl);
  } catch (error) {
    pendingScoreDelta += delta;
    updateScoreDisplay(scoreEl);
    statusEl.textContent = error.message || t('could_not_update_score');
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
  root.querySelectorAll(CONTROLLER_DISABLED_SELECTOR).forEach((element) => {
    element.disabled = isPending;
  });
}

function hideStatus(statusEl) {
  if (statusEl) statusEl.hidden = true;
}

function updateScoreDisplay(scoreEl) {
  if (scoreEl) scoreEl.textContent = formatPoints(confirmedScore + pendingScoreDelta);
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
  renderError(t('failed_to_load_controller'), error.message || String(error));
});

window.addEventListener('beforeunload', () => {
  stopPlayersSubscription?.();
  stopRuntimeSubscription?.();
  clearTimeout(scoreFlushTimer);
});
