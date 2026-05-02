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
import { initThemeFromStorage } from './theme.js';
import { createPressRuntimeService } from './services/PressRuntimeService.js';
import { createHostControlChannelService } from './services/HostControlChannelService.js';
import { normalizeBuzzerUrl } from './utils/localBuzzerUrl.js';
import {
  createPlayerPressAudio,
} from './utils/playerPressAudio.js';

const root = document.getElementById('player-controller-app');
initLanguageFromUrl();
initThemeFromStorage();
const params = new URLSearchParams(window.location.search);
const gameId = params.get('gameId');
const buzzerUrl = normalizeBuzzerUrl(params.get('buzzer') || '');
const STORAGE_PREFIX = 'quiz-game:player-controller';
const STATUS_AUTO_HIDE_MS = 10000;
const HOST_ACTIVITY_STALE_MS = 9000;

let player = null;
let controllerId = null;
let stopPlayersSubscription = null;
let gameRefreshTimer = null;
let confirmedScore = 0;
let isPressEnabled = false;
let pressWinnerPlayerId = null;
let isClaimingPress = false;
let pressRuntime = null;
let lastPlayedWinnerToneKey = null;
let statusHideTimer = null;
let hostControlChannel = null;
let hostActivityStaleTimer = null;
let isMainGameActive = false;
const playerPressAudio = createPlayerPressAudio();

const CONTROLLER_DISABLED_SELECTOR = '.player-controller__input, .player-controller__leaveBtn';
const MAIN_GAME_LOCK_SELECTOR = '[data-main-game-lock]';

async function startPlayerController() {
  if (!gameId) {
    renderError(t('no_game_selected'), t('scan_qr_from_game_screen'));
    return;
  }

  controllerId = getOrCreateControllerId(gameId);
  renderLoading(t('loading_player_controller'));

  try {
    player = await getPlayerByController(gameId, controllerId);
    hostControlChannel = createHostControlChannelService({ gameId, role: 'player' });
    await hostControlChannel.connect();
    bindMainGameActivity();
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
      <div id="mainGameInactiveBanner" class="player-controller__mainGameBanner" hidden>${t('start_main_game_prompt')}</div>
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
          <button class="player-controller__primary" data-main-game-lock type="submit">${t('join_controller')}</button>
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
  syncMainGameAvailability();

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = input?.value?.trim();
    if (!name) return;
    if (!isMainGameActive) {
      errorEl.textContent = t('start_main_game_prompt');
      errorEl.hidden = false;
      return;
    }

    toggleJoinPending(true);
    errorEl.hidden = true;

    try {
      player = await claimPlayerSlot(gameId, { name, controllerId });
      savePlayerBinding(gameId, { playerId: player.id, controllerId });
      renderController(player);
      bindRealtimePlayers();
    } catch (error) {
      errorEl.textContent = t('player_join_failed');
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
      <div id="mainGameInactiveBanner" class="player-controller__mainGameBanner" hidden>${t('start_main_game_prompt')}</div>
      <div class="player-controller__toastHost" aria-live="polite" aria-atomic="true">
        <p id="playerControllerStatus" class="player-controller__status" hidden></p>
      </div>
      <section class="player-controller__card player-controller__card--controller">
        <div class="player-controller__topBar">
          <p class="player-controller__eyebrow">${t('player_controller')}</p>
          <button id="playerDeleteBtn" class="player-controller__leaveBtn" data-main-game-lock type="button" aria-label="${t('leave_game')}" title="${t('leave_game')}">
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
            data-main-game-lock
            type="text"
            maxlength="24"
            value="${escapeHtml(currentPlayer.name)}"
          >
        </label>
        <div class="player-controller__scoreCard">
          <strong id="playerScoreValue" class="player-controller__scoreValue">${formatPoints(currentPlayer.points)}</strong>
        </div>
        <button id="playerPressBtn" class="player-controller__pressBtn" type="button">PRESS</button>
      </section>
    </main>
  `;

  const scoreEl = document.getElementById('playerScoreValue');
  const statusEl = document.getElementById('playerControllerStatus');
  const nameInput = document.getElementById('playerControllerName');
  const pressBtn = document.getElementById('playerPressBtn');
  const deleteBtn = document.getElementById('playerDeleteBtn');
  syncMainGameAvailability();

  pressBtn?.addEventListener('click', () => {
    if (isClaimingPress) return;
    if (!isMainGameActive) {
      showStatus(statusEl, t('start_main_game_prompt'), 'info');
      return;
    }

    // Always give tactile feedback so the button feels alive
    pressBtn.classList.remove('is-pressed');
    void pressBtn.offsetWidth;
    pressBtn.classList.add('is-pressed');
    window.setTimeout(() => pressBtn.classList.remove('is-pressed'), 160);

    if (!isPressEnabled) {
      showStatus(statusEl, t('player_press_not_ready'), 'info');
      return;
    }

    if (pressWinnerPlayerId) {
      if (isLocalPressWinner(pressWinnerPlayerId)) {
        hideStatus(statusEl);
      } else {
        showStatus(statusEl, t('player_press_taken'), 'info');
      }
      return;
    }

    void claimPress(statusEl);
  });

  nameInput?.addEventListener('change', async () => {
    if (!isMainGameActive) return;
    const nextName = nameInput.value.trim();
    if (!nextName || nextName === player.name) {
      nameInput.value = player.name;
      return;
    }

    setControllerPending(true);
    try {
      player = await updatePlayerByController(gameId, controllerId, { name: nextName });
      nameInput.value = player.name;
      showStatus(statusEl, t('player_name_updated'), 'success');
    } catch (error) {
      showStatus(statusEl, t('player_name_update_failed'));
      nameInput.value = player.name;
    } finally {
      setControllerPending(false);
    }
  });

  deleteBtn?.addEventListener('click', async () => {
    if (!isMainGameActive) return;
    if (!player || !window.confirm(t('remove_player_confirm', { name: player.name }))) return;

    setControllerPending(true);
    try {
      await removePlayerByController(gameId, controllerId);
      clearPlayerBinding(gameId);
      player = null;
      renderJoin();
    } catch (error) {
      showStatus(statusEl, t('player_leave_failed'));
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
  const nextWinnerPlayerId = runtime?.winnerPlayerId || null;
  isPressEnabled = !!runtime?.pressEnabled;
  pressWinnerPlayerId = nextWinnerPlayerId;
  if (!isPressEnabled || !!pressWinnerPlayerId) {
    isClaimingPress = false;
  }

  if (!pressWinnerPlayerId) {
    lastPlayedWinnerToneKey = null;
  }

  const statusEl = document.getElementById('playerControllerStatus');
  if (!pressWinnerPlayerId || isLocalPressWinner(pressWinnerPlayerId)) {
    hideStatus(statusEl);
  }

  syncPressButtonState();
}

function handleHostPressConfirmed(payload = {}) {
  const winnerPlayerId = String(payload?.winnerPlayerId || '').trim();
  const localPlayerId = String(player?.id || '').trim();
  if (!winnerPlayerId || !localPlayerId) return;
  if (winnerPlayerId !== localPlayerId) return;

  const confirmationKey = String(
    payload?.confirmationKey
    || `${winnerPlayerId}:${payload?.pressedAt || payload?.updatedAt || 'no-timestamp'}`
  );
  if (!confirmationKey || confirmationKey === lastPlayedWinnerToneKey) return;

  lastPlayedWinnerToneKey = confirmationKey;
  void playerPressAudio.playWinnerTone().catch((error) => {
    console.warn('[player] winner tone playback failed:', error);
  });
}

async function claimPress(statusEl) {
  if (isClaimingPress) return;
  isClaimingPress = true;
  syncPressButtonState();

  try {
    applyRuntimeState(await pressRuntime.claimPress());
    hideStatus(statusEl);
  } catch (error) {
    if (isLocalPressWinner(pressWinnerPlayerId)) {
      hideStatus(statusEl);
      return;
    }

    if (pressWinnerPlayerId) {
      showStatus(statusEl, t('player_press_taken'), 'info');
      return;
    }

    showStatus(statusEl, t('player_press_failed'));
  } finally {
    if (!pressWinnerPlayerId) {
      isClaimingPress = false;
    }
    syncPressButtonState();
  }
}

function syncPressButtonState() {
  const pressBtn = document.getElementById('playerPressBtn');
  if (!pressBtn) return;
  const isAvailable = isMainGameActive && !!isPressEnabled && !pressWinnerPlayerId && !isClaimingPress;
  pressBtn.classList.toggle('is-enabled', isAvailable);
  pressBtn.setAttribute('aria-disabled', isAvailable ? 'false' : 'true');
}

function bindMainGameActivity() {
  hostControlChannel?.subscribe((message) => {
    const type = message?.type;
    const payload = message?.payload || {};
    if (!type) return;

    if (type === 'host_runtime_state') {
      markMainGameActive(payload?.active !== false);
      return;
    }

    if (type === 'press_confirmed') {
      handleHostPressConfirmed(payload);
      return;
    }
  });
  void hostControlChannel?.send('host_runtime_state_request');
}

function markMainGameActive(active) {
  isMainGameActive = !!active;
  syncMainGameAvailability();
  window.clearTimeout(hostActivityStaleTimer);
  if (!active) return;
  hostActivityStaleTimer = window.setTimeout(() => {
    isMainGameActive = false;
    syncMainGameAvailability();
  }, HOST_ACTIVITY_STALE_MS);
}

function syncMainGameAvailability() {
  const banner = document.getElementById('mainGameInactiveBanner');
  if (banner) banner.hidden = isMainGameActive;
  root.classList.toggle('player-controller--mainGameInactive', !isMainGameActive);

  root.querySelectorAll(MAIN_GAME_LOCK_SELECTOR).forEach((element) => {
    element.disabled = !isMainGameActive;
  });
  syncPressButtonState();
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
  if (!statusEl) return;
  window.clearTimeout(statusHideTimer);
  statusHideTimer = null;
  statusEl.hidden = true;
  statusEl.textContent = '';
  statusEl.dataset.variant = 'error';
}

function showStatus(statusEl, message, variant = 'error') {
  if (!statusEl) return;
  window.clearTimeout(statusHideTimer);
  statusEl.textContent = message;
  statusEl.dataset.variant = variant;
  statusEl.hidden = false;
  statusHideTimer = window.setTimeout(() => {
    if (document.body.contains(statusEl)) hideStatus(statusEl);
  }, STATUS_AUTO_HIDE_MS);
}

function updateScoreDisplay(scoreEl) {
  if (scoreEl) scoreEl.textContent = formatPoints(confirmedScore);
}

function isLocalPressWinner(winnerPlayerId) {
  return !!winnerPlayerId && !!player?.id && winnerPlayerId === player.id;
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
  hostControlChannel?.destroy?.();
  pressRuntime?.destroy?.();
  window.clearTimeout(hostActivityStaleTimer);
  window.clearTimeout(statusHideTimer);
  playerPressAudio?.destroy?.();
});
