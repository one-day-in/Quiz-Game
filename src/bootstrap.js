// src/bootstrap.js
import { getSession, signOut, onAuthStateChange } from './api/authApi.js';
import { createGame } from './api/gameApi.js';
import { syncCurrentUserProfile } from './api/profileApi.js';
import { escapeHtml } from './utils/utils.js';
import { createAppController } from './AppController.js';
import { Disposer } from './utils/disposer.js';

import { createGameRepository } from './services/GameRepository.js';
import { createGameService } from './services/GameService.js';
import { createRoundNavigationService } from './services/RoundNavigationService.js';
import { createModalService } from './services/ModalService.js';
import { createMediaService } from './services/MediaService.js';
import { createPlayersService } from './services/PlayersService.js';
import { createPressRuntimeService } from './services/PressRuntimeService.js';
import { getBuzzerWakeUrl } from './utils/localBuzzerUrl.js';

import { renderLogin } from './views/LoginView.js';
import { LobbyView } from './views/LobbyView.js';
import { initLanguageFromUrl, t } from './i18n.js';

const root = document.getElementById('app');
const IS_DEV = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const LAST_GAME_ID_KEY   = 'lastGameId';
const LAST_GAME_NAME_KEY = 'lastGameName';

initLanguageFromUrl();

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
    return { id, name: localStorage.getItem(LAST_GAME_NAME_KEY) || t('new_game') };
}

async function warmBuzzerServer() {
    const wakeUrl = getBuzzerWakeUrl();
    if (!wakeUrl) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4500);

    try {
        const response = await fetch(wakeUrl, {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Wake request failed with ${response.status}`);
        }
    } catch (error) {
        console.warn('[Bootstrap] buzzer warm-up failed, continuing with runtime fallback:', error);
    } finally {
        window.clearTimeout(timeoutId);
    }
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

function renderLoading(msg = t('loading')) {
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
            <h2 class="page-error__title">${escapeHtml(t('failed_to_load'))}</h2>
            <pre class="page-error__detail">${escapeHtml(String(error?.message || error))}</pre>
            <button class="page-error__retry" id="retryBtn">${escapeHtml(t('try_again'))}</button>
        </div>
    `;
    document.getElementById('retryBtn')?.addEventListener('click', onRetry);
}

function renderLobby(user) {
    clearLastGame();
    clearRoot();

    const lobby = new LobbyView({
        currentUser: user,
        onOpen: (gameId, gameName) => renderGame(user, gameId, gameName),
        onCreate: async (name) => {
            try {
                const game = await createGame(name);
                renderGame(user, game.id, game.name);
            } catch (err) {
                console.error('[Bootstrap] createGame failed:', err);
                alert(`${t('error_prefix')}: ${err.message}`);
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
    renderLoading(t('loading_game'));

    try {
        const repo = createGameRepository(gameId);
        const gameService = createGameService(repo);
        const playersService = createPlayersService(gameId);
        const mediaService = createMediaService({ repo, gameService });
        const pressRuntimeService = createPressRuntimeService({ gameId, role: 'host' });
        const roundNavigationService = createRoundNavigationService(gameService);
        const modalService = createModalService(gameService, mediaService, pressRuntimeService);

        await gameService.initialize();
        await playersService.initialize();
        await warmBuzzerServer();
        await pressRuntimeService.connect();
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
            playersService,
            modalService,
            roundNavigationService,
            gameId,
            gameName,
            onBackToLobby: () => renderLobby(user),
        });

        _currentCleanup = () => {
            playersService?.destroy?.();
            pressRuntimeService?.destroy?.();
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
        renderLoading(t('checking_session'));

        const session = await getSession();

        if (!session) {
            _sessionActive = false;
            renderLogin(root);
            return;
        }

        _sessionActive = true;

        const user = session.user;
        try {
            await syncCurrentUserProfile(user);
        } catch (error) {
            console.error('[Bootstrap] profile sync failed:', error);
        }

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
