// src/bootstrap.js
import { getSession, signOut, onAuthStateChange } from './api/authApi.js';
import { createGame } from './api/gameApi.js';
import { escapeHtml } from './utils/utils.js';
import { createAppController } from './AppController.js';
import { Disposer } from './utils/disposer.js';

import { createGameRepository } from './services/GameRepository.js';
import { createGameService } from './services/GameService.js';
import { createSettingsService } from './services/SettingsService.js';
import { createModalService } from './services/ModalService.js';
import { createMediaService } from './services/MediaService.js';

import { renderLogin } from './views/LoginView.js';
import { LobbyView } from './views/LobbyView.js';

const root = document.getElementById('app');
const IS_DEV = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const LAST_GAME_ID_KEY   = 'lastGameId';
const LAST_GAME_NAME_KEY = 'lastGameName';

function saveLastGame(gameId, gameName) {
    localStorage.setItem(LAST_GAME_ID_KEY, gameId);
    localStorage.setItem(LAST_GAME_NAME_KEY, gameName || '');
}

function clearLastGame() {
    localStorage.removeItem(LAST_GAME_ID_KEY);
    localStorage.removeItem(LAST_GAME_NAME_KEY);
}

function getLastGame() {
    const id = localStorage.getItem(LAST_GAME_ID_KEY);
    if (!id) return null;
    return { id, name: localStorage.getItem(LAST_GAME_NAME_KEY) || 'Game' };
}

// Track current view/app cleanup
let _currentCleanup = null;

function clearRoot() {
    if (_currentCleanup) {
        _currentCleanup();
        _currentCleanup = null;
    }
    root.innerHTML = '';
}

function renderLoading(msg = 'Loading...') {
    root.innerHTML = `
        <div class="page-loader">
            <div class="page-loader__ring"></div>
            <p class="page-loader__text">${escapeHtml(msg)}</p>
        </div>
    `;
}

function renderError(error, onRetry) {
    root.innerHTML = `
        <div class="page-error">
            <h2 class="page-error__title">Failed to load</h2>
            <pre class="page-error__detail">${escapeHtml(String(error?.message || error))}</pre>
            <button class="page-error__retry" id="retryBtn">Try again</button>
        </div>
    `;
    document.getElementById('retryBtn')?.addEventListener('click', onRetry);
}

function renderLobby(user) {
    clearLastGame();
    clearRoot();

    const lobby = new LobbyView({
        onOpen: (gameId, gameName) => renderGame(user, gameId, gameName),
        onCreate: async (name) => {
            try {
                const game = await createGame(name);
                renderGame(user, game.id, game.name);
            } catch (err) {
                console.error('[Bootstrap] createGame failed:', err);
                alert(`Error creating game: ${err.message}`);
            }
        },
        onLogout: async () => {
            await signOut();
            renderLogin(root);
        }
    });

    root.appendChild(lobby.el);
    _currentCleanup = () => lobby.destroy();
}

async function renderGame(user, gameId, gameName) {
    saveLastGame(gameId, gameName);
    clearRoot();
    renderLoading('Loading game...');

    try {
        const repo = createGameRepository(gameId);
        const gameService = createGameService(repo);
        const mediaService = createMediaService({ repo, gameService });
        const settingsService = createSettingsService(gameService, mediaService);
        const modalService = createModalService(gameService, mediaService);

        await gameService.initialize();
        gameService.restoreUiState();

        if (IS_DEV) {
            window.gameService = gameService;
            window.gameModel = gameService.getModel();
            window.cleanup = () => {
                modalService?.destroy();
                if (IS_DEV) {
                    delete window.gameService;
                    delete window.gameModel;
                    delete window.cleanup;
                }
            };
        }

        // Clear loading screen
        root.innerHTML = '';

        const app = createAppController({
            root,
            gameService,
            modalService,
            settingsService,
            gameId,
            gameName,
            onBackToLobby: () => renderLobby(user),
            onLogout: async () => {
                await signOut();
                renderLogin(root);
            }
        });

        _currentCleanup = () => {
            modalService?.destroy();
            app?.destroy();
            if (IS_DEV) {
                delete window.gameService;
                delete window.gameModel;
                delete window.cleanup;
            }
        };

        app.render();
    } catch (error) {
        console.error('[Bootstrap] Game load failed:', error);
        renderError(error, () => renderGame(user, gameId, gameName));
    }
}

let _starting = false;

// True while an authenticated session is active (lobby or game is rendered).
// Prevents Supabase SIGNED_IN events fired on tab-refocus (token refresh) from
// destroying the current game/lobby state and re-initialising the whole app.
let _sessionActive = false;

async function startApp() {
    if (_starting) return;
    _starting = true;

    try {
        renderLoading('Checking session...');

        const session = await getSession();

        if (!session) {
            _sessionActive = false;
            renderLogin(root);
            return;
        }

        _sessionActive = true;

        const user = session.user;

        const lastGame = getLastGame();
        if (lastGame) {
            renderGame(user, lastGame.id, lastGame.name);
        } else {
            renderLobby(user);
        }
    } catch (error) {
        console.error('[Bootstrap] Failed:', error);
        renderError(error, () => {
            renderLoading();
            setTimeout(() => startApp(), 1000);
        });
    } finally {
        _starting = false;
    }
}

export async function start() {
    onAuthStateChange((event, _session) => {
        if (event === 'SIGNED_OUT') {
            // Session gone → always go to login
            _sessionActive = false;
            if (!_starting) startApp();
            return;
        }

        if (event === 'SIGNED_IN' && !_sessionActive) {
            // Only react to SIGNED_IN if we don't already have a running session.
            // Supabase fires SIGNED_IN on every token refresh (visibilitychange, etc.)
            // — ignoring those events keeps the open modal / game state intact when
            // the user switches tabs and comes back.
            if (!_starting) startApp();
        }
    });

    await startApp();
}
