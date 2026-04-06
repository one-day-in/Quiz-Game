import {
  MAX_PLAYERS,
  claimPlayerSlot,
  getPlayerByController,
  getPlayers,
  removePlayerByController,
  subscribeToPlayers,
  updatePlayerByController,
} from './api/gameApi.js';
import { initLanguageFromUrl, t } from './i18n.js';
import { createPressRuntimeService } from './services/PressRuntimeService.js';
import { normalizeBuzzerUrl } from './utils/localBuzzerUrl.js';
import {
  createPlayerPressAudio,
  getPlayerPressWinnerToneKey,
  shouldPlayPlayerPressWinnerTone,
} from './utils/playerPressAudio.js';

const root = document.getElementById('player-controller-app');
initLanguageFromUrl();
const params = new URLSearchParams(window.location.search);
const gameId = params.get('gameId');
const buzzerUrl = normalizeBuzzerUrl(params.get('buzzer') || '');
const STORAGE_PREFIX = 'quiz-game:player-controller';

let player = null;
let controllerId = null;
let stopPlayersSubscription = null;
let gameRefreshTimer = null;
let confirmedScore = 0;
let isPressEnabled = false;
let pressWinnerPlayerId = null;
let pressRuntime = null;
let hasSeenRuntimeState = false;
let lastPlayedWinnerToneKey = null;
const playerPressAudio = createPlayerPressAudio();

const CONTROLLER_DISABLED_SELECTOR = '.player-controller__input, .player-controller__leaveBtn';

async function startPlayerController() {
  if (!gameId) {
    renderError(t('no_game_selected'), t('scan_qr_from_game_screen'));
    return;
  }

  controllerId = getOrCreateControllerId(gameId);
  renderLoading(t('loading_player_controller'));

  try {
    player = await getPlayerByController(gameId, controllerId);
    pressRuntime = createPressRuntimeService({ gameId, role: 'player', controllerId, wsUrl: buzzerUrl });
    await pressRuntime.connect();
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
        <form class="player-controller__joinForm" id="playerJoinForm">
          <label class="player-controller__field">
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
          <p class="player-controller__copy">${t('players_can_connect', { count: MAX_PLAYERS })}</p>
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

  root.innerHTML = `
    <main class="player-controller">
      <section class="player-controller__card player-controller__card--controller">
        <div class="player-controller__topBar">
          <p class="player-controller__eyebrow">${t('player_controller')}</p>
          <button id="playerDeleteBtn" class="player-controller__leaveBtn" type="button" aria-label="${t('leave_game')}" title="${t('leave_game')}">
            <svg class="player-controller__leaveIcon" viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <path d="M12 3v8" />
              <path d="M7.05 5.05a9 9 0 1 0 9.9 0" />
            </svg>
          </button>
        </div>
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
          <strong id="playerScoreValue" class="player-controller__scoreValue">${formatPoints(currentPlayer.points)}</strong>
        </div>
        <button id="playerPressBtn" class="player-controller__pressBtn" type="button">PRESS</button>
        <p id="playerControllerStatus" class="player-controller__status" hidden></p>
      </section>
    </main>
  `;

  const scoreEl = document.getElementById('playerScoreValue');
  const statusEl = document.getElementById('playerControllerStatus');
  const nameInput = document.getElementById('playerControllerName');
  const pressBtn = document.getElementById('playerPressBtn');
  const deleteBtn = document.getElementById('playerDeleteBtn');

  pressBtn?.addEventListener('click', () => {
    // Always give tactile feedback so the button feels alive
    pressBtn.classList.remove('is-pressed');
    void pressBtn.offsetWidth;
    pressBtn.classList.add('is-pressed');
    window.setTimeout(() => pressBtn.classList.remove('is-pressed'), 160);

    // Only actually claim the press when the host has opened a question
    if (!isPressEnabled || pressWinnerPlayerId) return;
    void playerPressAudio.unlock();
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
  pressRuntime?.subscribe((runtime) => {
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
  const previousWinnerPlayerId = pressWinnerPlayerId;
  const nextWinnerPlayerId = runtime?.winnerPlayerId || null;
  isPressEnabled = !!runtime?.pressEnabled;
  pressWinnerPlayerId = nextWinnerPlayerId;

  const shouldPlayFromTransition = shouldPlayPlayerPressWinnerTone({
    hasInitializedRuntime: hasSeenRuntimeState,
    previousWinnerPlayerId,
    nextWinnerPlayerId,
    localPlayerId: player?.id || null,
  });
  const winnerToneKey = getPlayerPressWinnerToneKey(runtime, player?.id || null);

  if (shouldPlayFromTransition && winnerToneKey && winnerToneKey !== lastPlayedWinnerToneKey) {
    lastPlayedWinnerToneKey = winnerToneKey;
    void playerPressAudio.playWinnerTone().catch((error) => {
      console.warn('[player] winner tone playback failed:', error);
    });
  }

  if (!winnerToneKey) {
    lastPlayedWinnerToneKey = null;
  }

  hasSeenRuntimeState = true;
  const pressBtn = document.getElementById('playerPressBtn');
  if (!pressBtn) return;
  pressBtn.classList.toggle('is-enabled', !!isPressEnabled && !pressWinnerPlayerId);
}

async function claimPress(statusEl) {
  try {
    applyRuntimeState(await pressRuntime.claimPress());
    hideStatus(statusEl);
  } catch (error) {
    statusEl.textContent = error.message || t('could_not_claim_press');
    statusEl.hidden = false;
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
  if (scoreEl) scoreEl.textContent = formatPoints(confirmedScore);
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
  pressRuntime?.destroy?.();
  playerPressAudio?.destroy?.();
});
