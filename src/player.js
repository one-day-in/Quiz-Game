import {
  MAX_PLAYERS,
  adjustPlayerScore,
  claimPlayerSlot,
  getPlayerByController,
  getGame,
  claimBuzz,
  removePlayer,
  subscribeToGame,
  updatePlayer,
} from './api/gameApi.js';

const root = document.getElementById('player-controller-app');
const params = new URLSearchParams(window.location.search);
const gameId = params.get('gameId');
const STORAGE_PREFIX = 'quiz-game:player-controller';

let player = null;
let controllerId = null;
let stopPlayersSubscription = null;
let buzzAttemptPending = false;
let gameRefreshTimer = null;

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
      const game = await getGame(gameId);
      renderController(player, game.live?.buzz || null);
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

function renderController(currentPlayer, buzz = null) {
  player = currentPlayer;
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
        <div class="player-controller__buzzCard">
          <span class="player-controller__scoreLabel">Buzz</span>
          <button id="playerBuzzBtn" class="player-controller__buzzBtn" type="button" disabled>Waiting for question</button>
          <p id="playerBuzzStatus" class="player-controller__hint">The button activates 1 second after the question opens.</p>
        </div>
        <button id="playerDeleteBtn" class="player-controller__secondary player-controller__secondary--danger" type="button">Leave game</button>
        <p id="playerControllerStatus" class="player-controller__status" hidden></p>
      </section>
    </main>
  `;

  const scoreEl = document.getElementById('playerScoreValue');
  const statusEl = document.getElementById('playerControllerStatus');
  const nameInput = document.getElementById('playerControllerName');
  const buzzBtn = document.getElementById('playerBuzzBtn');
  const deleteBtn = document.getElementById('playerDeleteBtn');

  updateBuzzUI(buzz, currentPlayer);

  buzzBtn?.addEventListener('click', async () => {
    if (!player || buzzAttemptPending || buzzBtn.disabled) return;
    buzzAttemptPending = true;
    buzzBtn.disabled = true;
    buzzBtn.textContent = 'Sending...';

    try {
      await claimBuzz(gameId, player.id);
    } catch (error) {
      statusEl.textContent = error.message || 'Could not claim buzz';
      statusEl.hidden = false;
    } finally {
      buzzAttemptPending = false;
    }
  });

  root.querySelectorAll('[data-delta]').forEach((button) => {
    button.addEventListener('click', async () => {
      const delta = Number(button.dataset.delta);
      setControllerPending(true);
      try {
        player = await adjustPlayerScore(gameId, currentPlayer.id, delta);
        scoreEl.textContent = formatPoints(player.points);
        statusEl.hidden = true;
      } catch (error) {
        statusEl.textContent = error.message || 'Could not update score';
        statusEl.hidden = false;
      } finally {
        setControllerPending(false);
      }
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
      player = await updatePlayer(gameId, player.id, { name: nextName });
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
      await removePlayer(gameId, player.id);
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
  stopPlayersSubscription = subscribeToGame(gameId, (game) => {
    syncControllerFromGame(game);
  });
}

function startGameRefreshLoop() {
  clearInterval(gameRefreshTimer);
  gameRefreshTimer = window.setInterval(async () => {
    try {
      const game = await getGame(gameId);
      syncControllerFromGame(game);
    } catch (_) {
      // Ignore transient refresh failures on mobile.
    }
  }, 1000);
}

function syncControllerFromGame(game) {
  const players = game.players || [];
  const nextPlayer = players.find((entry) => entry.controllerId === controllerId || entry.id === player?.id) ?? null;
  if (!nextPlayer) {
    player = null;
    clearPlayerBinding(gameId);
    renderJoin();
    return;
  }

  const scoreEl = document.getElementById('playerScoreValue');
  const nameInput = document.getElementById('playerControllerName');
  if (!scoreEl || !nameInput) {
    renderController(nextPlayer, game.live?.buzz || null);
    return;
  }

  player = nextPlayer;
  scoreEl.textContent = formatPoints(nextPlayer.points);
  if (document.activeElement !== nameInput) {
    nameInput.value = nextPlayer.name;
  }
  updateBuzzUI(game.live?.buzz || null, nextPlayer);
}

function updateBuzzUI(buzz, currentPlayer) {
  const buzzBtn = document.getElementById('playerBuzzBtn');
  const buzzStatus = document.getElementById('playerBuzzStatus');
  if (!buzzBtn || !buzzStatus) return;

  if (!buzz) {
    buzzBtn.disabled = true;
    buzzBtn.textContent = 'Waiting for question';
    buzzStatus.textContent = 'The button activates 1 second after the question opens.';
    return;
  }

  const isWinner = buzz.winnerPlayerId && currentPlayer?.id === buzz.winnerPlayerId;
  const isOpen = buzz.status === 'open' || (buzz.status === 'pending' && Date.now() >= new Date(buzz.enabledAt).getTime());

  if (buzz.status === 'buzzed') {
    buzzBtn.disabled = true;
    buzzBtn.textContent = isWinner ? 'You buzzed first' : 'Too late';
    buzzStatus.textContent = isWinner ? 'Wait for the host to score your answer.' : 'Another player already locked the question.';
    return;
  }

  if (isOpen) {
    buzzBtn.disabled = buzzAttemptPending;
    buzzBtn.textContent = buzzAttemptPending ? 'Sending...' : 'Buzz now';
    buzzStatus.textContent = 'Tap as fast as you can.';
    return;
  }

  buzzBtn.disabled = true;
  buzzBtn.textContent = 'Get ready';
  buzzStatus.textContent = 'Buzz opens 1 second after the question appears.';
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

startPlayerController().catch((error) => {
  console.error('[player] start failed:', error);
  renderError('Failed to load controller', error.message || String(error));
});

window.addEventListener('beforeunload', () => {
  stopPlayersSubscription?.();
});
