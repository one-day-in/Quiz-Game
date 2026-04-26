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
import { createHostControlChannelService } from './services/HostControlChannelService.js';
import { getBuzzerWakeUrl } from './utils/localBuzzerUrl.js';

import { renderLogin } from './views/LoginView.js';
import { LobbyView } from './views/LobbyView.js';
import { initLanguageFromUrl, t } from './i18n.js';
import { initThemeFromStorage } from './theme.js';

const root = document.getElementById('app');
const IS_DEV = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const LAST_GAME_ID_KEY   = 'lastGameId';
const LAST_GAME_NAME_KEY = 'lastGameName';
const BUZZER_WARMUP_TIMEOUT_MS = 1200;
let _buzzerWarmupAttempted = false;
let _buzzerWarmupSuppressed = false;

initLanguageFromUrl();
initThemeFromStorage();

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

function isGameNotFoundError(error) {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('getgame failed: game not found');
}

async function warmBuzzerServer() {
    if (_buzzerWarmupAttempted) return;
    _buzzerWarmupAttempted = true;

    const wakeUrl = getBuzzerWakeUrl();
    if (!wakeUrl) return;

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), BUZZER_WARMUP_TIMEOUT_MS);

    try {
        await fetch(wakeUrl, {
            method: 'GET',
            cache: 'no-store',
            mode: 'no-cors',
            signal: controller.signal,
        });
    } catch (error) {
        if (_buzzerWarmupSuppressed) return;
        _buzzerWarmupSuppressed = true;
        const name = error?.name || '';
        if (name === 'AbortError') {
            console.info('[Bootstrap] buzzer warm-up timed out, continuing with runtime fallback');
            return;
        }
        console.warn('[Bootstrap] buzzer warm-up skipped, continuing with runtime fallback:', error);
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

function renderLobby(user, { hostMode = 'host' } = {}) {
    if (hostMode === 'controller') {
        root.innerHTML = `
            <div class="page-error">
                <h2 class="page-error__title">${escapeHtml(t('no_game_selected'))}</h2>
                <pre class="page-error__detail">${escapeHtml(t('open_host_controller_from_game'))}</pre>
            </div>
        `;
        return;
    }
    clearLastGame();
    clearRoot();

    const lobby = new LobbyView({
        currentUser: user,
        onOpen: (gameId, gameName) => renderGame(user, gameId, gameName, { hostMode }),
        onPlay: (gameId, gameName) => renderGame(user, gameId, gameName, { hostMode }),
        onCreate: async (name) => {
            try {
                const game = await createGame(name);
                renderGame(user, game.id, game.name, { hostMode });
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

async function renderGame(user, gameId, gameName, { hostMode = 'host' } = {}) {
    saveLastGame(gameId, gameName);
    clearRoot();
    renderLoading(t('loading_game'));

    try {
        const repo = createGameRepository(gameId);
        const gameService = createGameService(repo);
        const playersService = createPlayersService(gameId);
        const mediaService = createMediaService({ repo, gameService });
        const pressRuntimeService = createPressRuntimeService({ gameId, role: 'host' });
        const hostControlChannel = createHostControlChannelService({
            gameId,
            role: hostMode === 'controller' ? 'controller' : 'host',
        });
        const roundNavigationService = createRoundNavigationService(gameService);
        const modalService = createModalService(gameService, mediaService, pressRuntimeService, playersService, {
            presentationMode: hostMode === 'controller' ? 'controller' : 'host',
            onModalClose: hostMode === 'host'
                ? () => { void hostControlChannel.send('close_modal'); }
                : null,
            onModalViewStateChange: hostMode === 'host'
                ? ({ mode, isAnswerShown }) => { void hostControlChannel.send('modal_view_state', { mode, isAnswerShown }); }
                : null,
            onMediaPlaybackStateChange: hostMode === 'host'
                ? ({ target, isPlaying }) => { void hostControlChannel.send('modal_media_state', { target, isPlaying }); }
                : null,
            onControllerMediaControl: ({ target, action }) => {
                void hostControlChannel.send('modal_media_control', { target, action });
            },
            onControllerCommand: (type, payload = {}) => {
                void hostControlChannel.send(type, payload);
            },
        });

        await Promise.all([
            gameService.initialize(),
            playersService.initialize(),
        ]);
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
            onBackToLobby: hostMode === 'controller' ? null : () => renderLobby(user, { hostMode }),
            isReadOnly: hostMode === 'controller',
            onCellOpen: (payload) => {
                void hostControlChannel.send('open_cell', payload);
            },
        });

        await hostControlChannel.connect();
        const stopHostControlSubscription = hostControlChannel.subscribe((message) => {
            const type = message?.type;
            const payload = message?.payload || {};
            if (!type) return;

            if (type === 'open_cell') {
                app.openCell(payload, { skipBroadcast: true });
                return;
            }

            if (hostMode === 'controller' && (type === 'modal_view_state' || type === 'modal_media_state')) {
                modalService.runRemoteCommand(type, payload);
                return;
            }

            if (hostMode !== 'host') return;
            const result = modalService.runRemoteCommand(type, payload);
            if (type === 'modal_media_control') {
                void Promise.resolve(result).then((state) => {
                    if (!state) return;
                    void hostControlChannel.send('modal_media_state', state);
                });
            }
        });

        _currentCleanup = () => {
            stopHostControlSubscription?.();
            hostControlChannel?.destroy?.();
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

        // Keep game boot fast: connect press runtime in background.
        void warmBuzzerServer();
        void pressRuntimeService.connect().catch((error) => {
            if (IS_DEV) {
                console.info('[Bootstrap] press runtime connected via fallback:', error?.message || error);
            }
        });
    } catch (error) {
        console.error('[Bootstrap] Game load failed:', error);
        if (isGameNotFoundError(error)) {
            clearLastGame();
            renderLobby(user);
            return;
        }
        renderError(error, () => renderGame(user, gameId, gameName, { hostMode }));
    }
}

let _starting = false;

// True while an authenticated session is active (lobby or game is rendered).
// Prevents Supabase SIGNED_IN events fired on tab-refocus (token refresh) from
// destroying the current game/lobby state and re-initialising the whole app.
let _sessionActive = false;

async function startApp({ hostMode = 'host', forcedGameId = '' } = {}) {
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

        if (forcedGameId) {
            renderGame(user, forcedGameId, t('new_game'), { hostMode });
            return;
        }

        const lastGame = getLastGame();
        if (lastGame) {
            renderGame(user, lastGame.id, lastGame.name, { hostMode });
        } else {
            renderLobby(user, { hostMode });
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

export async function start(options = {}) {
    const hostMode = options?.hostMode === 'controller' ? 'controller' : 'host';
    const forcedGameId = String(options?.forcedGameId || '').trim();
    onAuthStateChange((event, _session) => {
        if (event === 'SIGNED_OUT') {
            // Session gone → always go to login
            _sessionActive = false;
            if (!_starting) startApp({ hostMode, forcedGameId });
            return;
        }

        if (event === 'SIGNED_IN' && !_sessionActive) {
            // Only react to SIGNED_IN if we don't already have a running session.
            // Supabase fires SIGNED_IN on every token refresh (visibilitychange, etc.)
            // — ignoring those events keeps the open modal / game state intact when
            // the user switches tabs and comes back.
            if (!_starting) startApp({ hostMode, forcedGameId });
        }
    });

    await startApp({ hostMode, forcedGameId });
}
