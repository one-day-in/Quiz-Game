// src/bootstrap.js
import { getSession, signOut, onAuthStateChange } from './api/authApi.js';
import { createGame, subscribeToGame } from './api/gameApi.js';
import { insertScoreLog, listScoreLogs, subscribeToScoreLogs } from './api/scoreLogsApi.js';
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
const HOST_ACTIVITY_PING_MS = 3000;
const HOST_ACTIVITY_STALE_MS = 9000;
const SCORE_LOGS_LIMIT = 5000;
const SCORE_LOGS_KEY_PREFIX = 'quiz-game:score-logs:';
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

function canUseStorage() {
    try {
        return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch {
        return false;
    }
}

function getScoreLogsStorageKey(gameId) {
    return `${SCORE_LOGS_KEY_PREFIX}${gameId}`;
}

function loadScoreLogsFromStorage(gameId) {
    if (!canUseStorage() || !gameId) return [];
    try {
        const raw = window.localStorage.getItem(getScoreLogsStorageKey(gameId));
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveScoreLogsToStorage(gameId, logs = []) {
    if (!canUseStorage() || !gameId) return;
    try {
        window.localStorage.setItem(
            getScoreLogsStorageKey(gameId),
            JSON.stringify(Array.isArray(logs) ? logs.slice(0, SCORE_LOGS_LIMIT) : [])
        );
    } catch {
        // Ignore storage quota and private-mode failures.
    }
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
    root.classList.remove('app--mainHostInactive');
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
        let scoreLogs = loadScoreLogsFromStorage(gameId).slice(0, SCORE_LOGS_LIMIT);
        const makeLogId = () => `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let appRef = null;
        let leaderboardPanelExpanded = false;
        let scoreLogsOpen = false;
        let hostActivityPingTimer = null;
        let hostActivityStaleTimer = null;
        let roundSyncRetryTimer = null;
        let lastOpenCellPayload = null;
        let lastModalViewState = null;
        let stopScoreLogsSubscription = null;
        let stopGameSubscription = null;
        let hasRoundStateSynced = false;
        const ensureControllerInactiveBanner = () => {
            let banner = root.querySelector('.app-mainHostBanner');
            if (banner) return banner;
            banner = document.createElement('div');
            banner.className = 'app-mainHostBanner';
            banner.textContent = t('start_main_game_prompt');
            root.appendChild(banner);
            return banner;
        };
        const setControllerAvailability = (active) => {
            if (hostMode !== 'controller') return;
            root.classList.toggle('app--mainHostInactive', !active);
            const banner = ensureControllerInactiveBanner();
            banner.hidden = !!active;
        };
        const markMainHostActiveFromPing = (active) => {
            setControllerAvailability(!!active);
            window.clearTimeout(hostActivityStaleTimer);
            if (!active) return;
            hostActivityStaleTimer = window.setTimeout(() => {
                setControllerAvailability(false);
            }, HOST_ACTIVITY_STALE_MS);
        };
        const normalizeScoreLog = (entry = {}) => ({
            id: entry?.id || makeLogId(),
            playerId: entry?.playerId || null,
            playerName: entry?.playerName || t('player_fallback'),
            cellLabel: entry?.cellLabel || '',
            outcome: entry?.outcome || null,
            delta: Number(entry?.delta) || 0,
            happenedAt: entry?.happenedAt || new Date().toISOString(),
            kind: entry?.kind || 'manual',
        });
        const dedupeAndSortScoreLogs = (entries = []) => {
            const byId = new Map();
            for (const raw of entries) {
                const entry = normalizeScoreLog(raw);
                if (!entry.id) continue;
                if (!byId.has(entry.id)) {
                    byId.set(entry.id, entry);
                    continue;
                }
                const prev = byId.get(entry.id);
                const prevTs = Date.parse(prev?.happenedAt || '') || 0;
                const nextTs = Date.parse(entry?.happenedAt || '') || 0;
                if (nextTs >= prevTs) byId.set(entry.id, entry);
            }
            return Array.from(byId.values())
                .sort((a, b) => (Date.parse(b?.happenedAt || '') || 0) - (Date.parse(a?.happenedAt || '') || 0))
                .slice(0, SCORE_LOGS_LIMIT);
        };
        const mergeScoreLogs = (primary = [], secondary = []) =>
            dedupeAndSortScoreLogs([...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])]);
        const setScoreLogs = (nextLogs = []) => {
            scoreLogs = dedupeAndSortScoreLogs(nextLogs);
            if (hostMode === 'host') {
                saveScoreLogsToStorage(gameId, scoreLogs);
            }
            appRef?.updateScoreLogs?.(scoreLogs);
        };
        const appendScoreLog = (entry, { broadcast = true, persistRemote = false } = {}) => {
            const nextEntry = normalizeScoreLog(entry);
            setScoreLogs([nextEntry, ...scoreLogs]);
            if (broadcast) {
                void hostControlChannel.send('score_log_append', nextEntry);
            }
            if (persistRemote && hostMode === 'host') {
                void insertScoreLog(gameId, nextEntry).catch((error) => {
                    console.warn('[Bootstrap] score log remote insert skipped:', error?.message || error);
                });
            }
            return nextEntry;
        };
        const makeManualScoreLog = ({ playerId, delta }) => {
            const players = playersService.getPlayers?.() || [];
            const player = players.find((entry) => String(entry?.id || '') === String(playerId || ''));
            const amount = Math.abs(Number(delta) || 0);
            return {
                kind: 'manual',
                playerId: playerId || null,
                playerName: player?.name || t('player_fallback'),
                cellLabel: `${t('leaderboard')} / ${delta >= 0 ? '+' : '-'}${amount}`,
                outcome: null,
                delta: Number(delta) || 0,
                happenedAt: new Date().toISOString(),
            };
        };
        const sendRoundState = () => {
            const uiState = gameService.getState()?.uiState || {};
            void hostControlChannel.send('round_state', {
                activeRoundId: Number(uiState?.activeRoundId) || 0,
                isRoundTransitioning: !!uiState?.isRoundTransitioning,
                pendingRoundId: Number.isFinite(Number(uiState?.pendingRoundId))
                    ? Number(uiState.pendingRoundId)
                    : null,
            });
        };
        const requestControllerStateSync = () => {
            if (hostMode !== 'controller') return;
            void hostControlChannel.send('round_sync_request');
            void hostControlChannel.send('leaderboard_panel_sync_request');
            void hostControlChannel.send('score_logs_sync_request');
            void hostControlChannel.send('current_player_sync_request');
            void hostControlChannel.send('modal_sync_request');
        };
        const startRoundSyncRetry = () => {
            if (hostMode !== 'controller') return;
            if (roundSyncRetryTimer) return;
            requestControllerStateSync();
            roundSyncRetryTimer = window.setInterval(() => {
                if (hasRoundStateSynced) {
                    window.clearInterval(roundSyncRetryTimer);
                    roundSyncRetryTimer = null;
                    return;
                }
                requestControllerStateSync();
            }, 1500);
        };
        const stopRoundSyncRetry = () => {
            if (!roundSyncRetryTimer) return;
            window.clearInterval(roundSyncRetryTimer);
            roundSyncRetryTimer = null;
        };
        const modalService = createModalService(gameService, mediaService, pressRuntimeService, playersService, {
            presentationMode: hostMode === 'controller' ? 'controller' : 'host',
            onModalClose: hostMode === 'host'
                ? () => {
                    lastOpenCellPayload = null;
                    lastModalViewState = null;
                    void hostControlChannel.send('close_modal');
                }
                : null,
            onModalViewStateChange: hostMode === 'host'
                ? ({ mode, isAnswerShown }) => {
                    lastModalViewState = { mode, isAnswerShown };
                    void hostControlChannel.send('modal_view_state', { mode, isAnswerShown });
                }
                : null,
            onMediaPlaybackStateChange: hostMode === 'host'
                ? ({ target, isPlaying }) => { void hostControlChannel.send('modal_media_state', { target, isPlaying }); }
                : null,
            onScoreLog: hostMode === 'host'
                ? (entry) => { appendScoreLog(entry, { broadcast: true, persistRemote: true }); }
                : null,
            onControllerMediaControl: ({ target, action }) => {
                if (action === 'toggle_answer') {
                    void hostControlChannel.send('modal_toggle_answer');
                    return;
                }
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
        stopGameSubscription = subscribeToGame(gameId, (nextGame) => {
            gameService.applyRemoteSnapshot?.(nextGame);
        });
        gameService.restoreUiState();
        const resolvedGameName = String(
            gameService.getModel?.()?.meta?.name
            || gameName
            || t('new_game')
        );

        try {
            const remoteScoreLogs = await listScoreLogs(gameId, { limit: SCORE_LOGS_LIMIT });
            setScoreLogs(mergeScoreLogs(remoteScoreLogs, scoreLogs));
        } catch (error) {
            console.warn('[Bootstrap] score logs remote load skipped:', error?.message || error);
        }

        if (hostMode === 'controller') {
            stopScoreLogsSubscription = subscribeToScoreLogs(gameId, (entry) => {
                appendScoreLog(entry, { broadcast: false, persistRemote: false });
            });
        }

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
            gameName: resolvedGameName,
            showGameTitle: hostMode !== 'controller',
            onBackToLobby: hostMode === 'controller' ? null : () => renderLobby(user, { hostMode }),
            isReadOnly: hostMode === 'controller',
            allowCurrentPlayerControl: hostMode === 'controller',
            allowLeaderboardControls: hostMode === 'controller',
            showLeaderboardQr: hostMode !== 'controller',
            scoreLogs,
            onAdjustPlayerScore: async (playerId, delta) => {
                if (hostMode === 'controller') {
                    void hostControlChannel.send('leaderboard_adjust_score', { playerId, delta });
                    return;
                }
                await playersService.adjustPlayerScore(playerId, delta);
                appendScoreLog(makeManualScoreLog({ playerId, delta }), { broadcast: true, persistRemote: true });
            },
            onCurrentPlayerChange: async (playerId) => {
                if (hostMode === 'controller') {
                    void hostControlChannel.send('current_player_set', { playerId: playerId || null });
                    return;
                }
                await gameService.setCurrentPlayerId(playerId);
            },
            onCellOpen: (payload) => {
                lastOpenCellPayload = payload || null;
                lastModalViewState = { mode: 'view', isAnswerShown: false };
                void hostControlChannel.send('open_cell', payload);
            },
            onLeaderboardExpandedChange: (isExpanded) => {
                leaderboardPanelExpanded = !!isExpanded;
                void hostControlChannel.send('leaderboard_panel_state', { isExpanded: !!isExpanded });
            },
            onScoreLogsOpenChange: (isOpen) => {
                scoreLogsOpen = !!isOpen;
                void hostControlChannel.send('score_logs_state', { isOpen: !!isOpen });
            },
            onRoundChangeRequest: (roundId) => {
                if (hostMode === 'controller') {
                    void hostControlChannel.send('round_set', { roundId });
                    return;
                }
                void roundNavigationService.setActiveRound(roundId);
            },
        });
        appRef = app;

        let stopCurrentPlayerBroadcast = null;
        if (hostMode === 'host') {
            let lastCurrentPlayerId = gameService.getCurrentPlayerId();
            stopCurrentPlayerBroadcast = gameService.subscribe((state) => {
                const nextPlayerId = state?.model?.getCurrentPlayerId?.() ?? null;
                if (nextPlayerId === lastCurrentPlayerId) return;
                lastCurrentPlayerId = nextPlayerId;
                void hostControlChannel.send('current_player_state', { playerId: nextPlayerId });
            });
        }

        let stopRoundBroadcast = null;
        if (hostMode === 'host') {
            let prevRoundSync = '';
            stopRoundBroadcast = gameService.subscribe((state) => {
                const ui = state?.uiState || {};
                const nextSync = JSON.stringify({
                    activeRoundId: Number(ui?.activeRoundId) || 0,
                    isRoundTransitioning: !!ui?.isRoundTransitioning,
                    pendingRoundId: Number.isFinite(Number(ui?.pendingRoundId)) ? Number(ui?.pendingRoundId) : null,
                });
                if (nextSync === prevRoundSync) return;
                prevRoundSync = nextSync;
                sendRoundState();
            });
        }

        await hostControlChannel.connect();
        if (hostMode === 'host') {
            const sendHostActivity = () => {
                void hostControlChannel.send('host_runtime_state', {
                    active: true,
                    sentAt: new Date().toISOString(),
                });
            };
            sendHostActivity();
            hostActivityPingTimer = window.setInterval(sendHostActivity, HOST_ACTIVITY_PING_MS);
        } else {
            setControllerAvailability(false);
        }
        const stopHostControlSubscription = hostControlChannel.subscribe((message) => {
            const type = message?.type;
            const payload = message?.payload || {};
            if (!type) return;

            if (type === 'host_runtime_state' && hostMode === 'controller') {
                markMainHostActiveFromPing(payload?.active !== false);
                if (payload?.active === false) {
                    hasRoundStateSynced = false;
                    stopRoundSyncRetry();
                } else if (!hasRoundStateSynced) {
                    startRoundSyncRetry();
                }
                return;
            }

            if (type === 'host_runtime_state_request' && hostMode === 'host') {
                void hostControlChannel.send('host_runtime_state', {
                    active: true,
                    sentAt: new Date().toISOString(),
                });
                sendRoundState();
                void hostControlChannel.send('leaderboard_panel_state', { isExpanded: leaderboardPanelExpanded });
                void hostControlChannel.send('score_logs_state', { isOpen: !!scoreLogsOpen });
                void hostControlChannel.send('current_player_state', { playerId: gameService.getCurrentPlayerId?.() ?? null });
                if (lastOpenCellPayload) {
                    void hostControlChannel.send('open_cell', lastOpenCellPayload);
                    if (lastModalViewState) {
                        void hostControlChannel.send('modal_view_state', lastModalViewState);
                    }
                } else {
                    void hostControlChannel.send('close_modal');
                }
                return;
            }

            if (type === 'open_cell') {
                app.openCell(payload, { skipBroadcast: true });
                return;
            }

            if (type === 'modal_sync_request' && hostMode === 'host') {
                if (lastOpenCellPayload) {
                    void hostControlChannel.send('open_cell', lastOpenCellPayload);
                    if (lastModalViewState) {
                        void hostControlChannel.send('modal_view_state', lastModalViewState);
                    }
                } else {
                    void hostControlChannel.send('close_modal');
                }
                return;
            }

            if (type === 'leaderboard_panel_state') {
                leaderboardPanelExpanded = !!payload?.isExpanded;
                app.setLeaderboardExpanded?.(!!payload?.isExpanded, { silent: true });
                return;
            }

            if (type === 'leaderboard_panel_sync_request' && hostMode === 'host') {
                void hostControlChannel.send('leaderboard_panel_state', { isExpanded: leaderboardPanelExpanded });
                return;
            }

            if (type === 'score_log_append') {
                appendScoreLog(payload, { broadcast: false, persistRemote: false });
                return;
            }

            if (type === 'score_log_snapshot') {
                setScoreLogs(mergeScoreLogs(payload?.logs || [], scoreLogs));
                return;
            }

            if (type === 'score_log_sync_request' && hostMode === 'host') {
                void hostControlChannel.send('score_log_snapshot', { logs: scoreLogs });
                return;
            }

            if (type === 'score_logs_state') {
                scoreLogsOpen = !!payload?.isOpen;
                app.setScoreLogsOpen?.(scoreLogsOpen, { silent: true });
                return;
            }

            if (type === 'score_logs_sync_request' && hostMode === 'host') {
                void hostControlChannel.send('score_logs_state', { isOpen: !!scoreLogsOpen });
                return;
            }

            if (type === 'current_player_set' && hostMode === 'host') {
                void gameService.setCurrentPlayerId(payload?.playerId || null).then(() => {
                    void hostControlChannel.send('current_player_state', { playerId: payload?.playerId || null });
                });
                return;
            }

            if (type === 'current_player_sync_request' && hostMode === 'host') {
                void hostControlChannel.send('current_player_state', { playerId: gameService.getCurrentPlayerId?.() ?? null });
                return;
            }

            if (type === 'round_set' && hostMode === 'host') {
                void roundNavigationService.setActiveRound(payload?.roundId);
                return;
            }

            if (type === 'round_state') {
                gameService.setRoundStateLocal(payload || {});
                hasRoundStateSynced = true;
                stopRoundSyncRetry();
                return;
            }

            if (type === 'round_sync_request' && hostMode === 'host') {
                sendRoundState();
                return;
            }

            if (type === 'leaderboard_adjust_score' && hostMode === 'host') {
                void playersService.adjustPlayerScore(payload?.playerId, payload?.delta).then(() => {
                    appendScoreLog(makeManualScoreLog({ playerId: payload?.playerId, delta: payload?.delta }), { broadcast: true, persistRemote: true });
                });
                return;
            }

            if (type === 'current_player_state') {
                gameService.setCurrentPlayerIdLocal(payload?.playerId || null);
                return;
            }

            if (hostMode === 'controller' && (type === 'modal_view_state' || type === 'modal_media_state' || type === 'close_modal')) {
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
            window.clearInterval(hostActivityPingTimer);
            hostActivityPingTimer = null;
            window.clearTimeout(hostActivityStaleTimer);
            hostActivityStaleTimer = null;
            stopRoundSyncRetry();
            if (hostMode === 'host') {
                void hostControlChannel.send('host_runtime_state', {
                    active: false,
                    sentAt: new Date().toISOString(),
                });
            }
            stopCurrentPlayerBroadcast?.();
            stopRoundBroadcast?.();
            stopScoreLogsSubscription?.();
            stopGameSubscription?.();
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
        if (hostMode === 'controller') {
            hasRoundStateSynced = false;
            void hostControlChannel.send('host_runtime_state_request');
            void hostControlChannel.send('score_log_sync_request');
            requestControllerStateSync();
            startRoundSyncRetry();
        } else {
            sendRoundState();
        }

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
