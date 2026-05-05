// src/bootstrap.js
import { getSession, signOut, onAuthStateChange } from './api/authApi.js';
import { createGame, getGame, resetAllCellsAnsweredState, saveGame, savePlayers, subscribeToGame } from './api/gameApi.js';
import { clearScoreLogs, listScoreLogs, subscribeToScoreLogs } from './api/scoreLogsApi.js';
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
import { createHostControlOutboxService } from './services/HostControlOutboxService.js';
import { createModalSyncStateService } from './services/ModalSyncStateService.js';
import { createControllerSyncCoordinator, createHostSyncCoordinator } from './services/HostControlSyncCoordinator.js';
import { getBuzzerWakeUrl } from './utils/localBuzzerUrl.js';
import { CONTROL_EVENTS } from './sync/controlEvents.js';

import { renderLogin } from './views/LoginView.js';
import { LobbyView } from './views/LobbyView.js';
import { initLanguageFromUrl, t } from './i18n.js';
import { initThemeFromStorage } from './theme.js';

const root = document.getElementById('app');
const IS_DEV = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';

const LAST_GAME_ID_KEY   = 'lastGameId';
const LAST_GAME_NAME_KEY = 'lastGameName';
const BUZZER_WARMUP_TIMEOUT_MS = 1200;
const HOST_ACTIVITY_PING_MS = 2000;
const HOST_ACTIVITY_STALE_MS = 4500;
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

async function prepareGameForPlayStart(gameId) {
    saveScoreLogsToStorage(gameId, []);

    await Promise.all([
        resetAllCellsAnsweredState(gameId),
        savePlayers(gameId, []),
        clearScoreLogs(gameId),
    ]);

    const game = await getGame(gameId);
    game.meta = { ...(game.meta || {}), currentPlayerId: null, updatedAt: new Date().toISOString() };
    await saveGame(gameId, game);
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
        onOpen: (gameId, gameName) => renderGame(user, gameId, gameName, { hostMode, entryMode: 'edit' }),
        onPlay: async (gameId, gameName) => {
            try {
                await prepareGameForPlayStart(gameId);
                renderGame(user, gameId, gameName, { hostMode, entryMode: 'play' });
            } catch (err) {
                console.error('[Bootstrap] play start reset failed:', err);
                alert(`${t('error_prefix')}: ${err.message}`);
            }
        },
        onCreate: async (name) => {
            try {
                const game = await createGame(name);
                renderGame(user, game.id, game.name, { hostMode, entryMode: 'edit' });
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

async function renderGame(user, gameId, gameName, { hostMode = 'host', entryMode = null } = {}) {
    saveLastGame(gameId, gameName);
    clearRoot();
    renderLoading(t('loading_game'));

    try {
        const repo = createGameRepository(gameId);
        const gameService = createGameService(repo);
        const playersService = createPlayersService(gameId);
        const mediaService = createMediaService({ repo, gameService });
        const pressRuntimeService = createPressRuntimeService({
            gameId,
            role: hostMode === 'controller' ? 'player' : 'host',
            controllerId: hostMode === 'controller' ? `host-controller-${gameId}` : null,
            disableSocket: hostMode === 'controller',
        });
        const hostControlChannel = createHostControlChannelService({
            gameId,
            role: hostMode === 'controller' ? 'controller' : 'host',
        });
        const hostControlOutbox = createHostControlOutboxService({
            send: (type, payload) => hostControlChannel.send(type, payload),
        });
        const sendControl = (type, payload = {}, options = {}) => hostControlOutbox.send(type, payload, options);
        const roundNavigationService = createRoundNavigationService(gameService);
        let scoreLogs = loadScoreLogsFromStorage(gameId).slice(0, SCORE_LOGS_LIMIT);
        const makeLogId = () => `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        let appRef = null;
        let leaderboardPanelExpanded = false;
        let scoreLogsOpen = false;
        let hostActivityPingTimer = null;
        let hostActivityStaleTimer = null;
        let controllerActivityPingTimer = null;
        let controllerActivityStaleTimer = null;
        let controllerStateSyncTimer = null;
        let roundSyncRetryTimer = null;
        const modalSyncState = createModalSyncStateService();
        let isHostControllerConnected = false;
        let stopScoreLogsSubscription = null;
        let stopGameSubscription = null;
        let stopGameSnapshotBroadcast = null;
        let stopPlayersSnapshotBroadcast = null;
        let stopPressConfirmBroadcast = null;
        let hasRoundStateSynced = false;
        let gameSnapshotBroadcastTimer = null;
        let playersSnapshotBroadcastTimer = null;
        let lastGameSnapshotSignature = '';
        let lastPlayersSnapshotSignature = '';
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
        const setHostControllerConnected = (connected) => {
            if (hostMode !== 'host') return;
            const nextConnected = !!connected;
            if (isHostControllerConnected === nextConnected) return;
            isHostControllerConnected = nextConnected;
            appRef?.setHostControllerConnected?.(nextConnected);
        };
        const markHostControllerActiveFromPing = (active) => {
            setHostControllerConnected(!!active);
            window.clearTimeout(controllerActivityStaleTimer);
            if (!active) return;
            controllerActivityStaleTimer = window.setTimeout(() => {
                setHostControllerConnected(false);
            }, HOST_ACTIVITY_STALE_MS);
        };
        const normalizeScoreLog = (entry = {}) => ({
            id: entry?.id || makeLogId(),
            playerId: entry?.playerId || null,
            playerName: entry?.playerName || t('player_fallback'),
            cellLabel: entry?.cellLabel || '',
            outcome: entry?.outcome || null,
            delta: Number(entry?.delta) || 0,
            scoreBefore: Number.isFinite(Number(entry?.scoreBefore)) ? Number(entry.scoreBefore) : null,
            scoreAfter: Number.isFinite(Number(entry?.scoreAfter)) ? Number(entry.scoreAfter) : null,
            happenedAt: entry?.happenedAt || new Date().toISOString(),
            kind: entry?.kind || 'manual',
        });
        const enrichScoreLogWithPoints = (entry = {}) => {
            const normalized = normalizeScoreLog(entry);
            if (Number.isFinite(Number(normalized.scoreBefore)) && Number.isFinite(Number(normalized.scoreAfter))) {
                return normalized;
            }
            const playerId = String(normalized?.playerId || '');
            if (!playerId) return normalized;
            const players = playersService.getPlayers?.() || [];
            const player = players.find((row) => String(row?.id || '') === playerId);
            if (!player) return normalized;
            const currentScore = Number(player?.points ?? player?.score);
            if (!Number.isFinite(currentScore)) return normalized;
            const delta = Number(normalized?.delta) || 0;
            return {
                ...normalized,
                scoreAfter: currentScore,
                scoreBefore: currentScore - delta,
            };
        };
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
        const appendScoreLog = (entry, { broadcast = true } = {}) => {
            const nextEntry = enrichScoreLogWithPoints(entry);
            setScoreLogs([nextEntry, ...scoreLogs]);
            if (broadcast) {
                void sendControl(CONTROL_EVENTS.SCORE_LOG_APPEND, nextEntry);
            }
            return nextEntry;
        };
        const clearAllScoreLogs = async () => {
            if (hostMode !== 'host') return;
            await clearScoreLogs(gameId);
            setScoreLogs([]);
            void sendControl(CONTROL_EVENTS.SCORE_LOG_SNAPSHOT, { logs: [] });
        };
        const makeManualScoreLog = ({ playerId, delta }) => {
            const players = playersService.getPlayers?.() || [];
            const player = players.find((entry) => String(entry?.id || '') === String(playerId || ''));
            const amount = Math.abs(Number(delta) || 0);
            const scoreAfter = Number(player?.points ?? player?.score);
            const safeScoreAfter = Number.isFinite(scoreAfter) ? scoreAfter : null;
            const safeDelta = Number(delta) || 0;
            return {
                kind: 'manual',
                playerId: playerId || null,
                playerName: player?.name || t('player_fallback'),
                cellLabel: `${t('leaderboard')} / ${safeDelta >= 0 ? '+' : '-'}${amount}`,
                outcome: null,
                delta: safeDelta,
                scoreBefore: safeScoreAfter === null ? null : safeScoreAfter - safeDelta,
                scoreAfter: safeScoreAfter,
                happenedAt: new Date().toISOString(),
            };
        };
        const sendRoundState = () => {
            const uiState = gameService.getState()?.uiState || {};
            void sendControl(CONTROL_EVENTS.ROUND_STATE, {
                activeRoundId: Number(uiState?.activeRoundId) || 0,
                isRoundTransitioning: !!uiState?.isRoundTransitioning,
                pendingRoundId: Number.isFinite(Number(uiState?.pendingRoundId))
                    ? Number(uiState.pendingRoundId)
                    : null,
                gameMode: String(uiState?.gameMode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play',
            });
        };
        const buildGameSnapshotPayload = () => {
            const state = gameService.getState?.() || {};
            const model = state?.model || gameService.getModel?.() || null;
            if (!model) return null;

            const uiState = state?.uiState || {};
            const payload = {
                game: model.toJSON?.() || null,
                uiState: {
                    activeRoundId: Number(uiState?.activeRoundId) || 0,
                    isRoundTransitioning: !!uiState?.isRoundTransitioning,
                    pendingRoundId: Number.isFinite(Number(uiState?.pendingRoundId))
                        ? Number(uiState.pendingRoundId)
                        : null,
                    gameMode: String(uiState?.gameMode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play',
                },
            };
            return payload?.game ? payload : null;
        };
        const getGameSnapshotSignature = (payload) => JSON.stringify({
            updatedAt: payload?.game?.meta?.updatedAt || '',
            activeRoundId: Number(payload?.uiState?.activeRoundId) || 0,
            isRoundTransitioning: !!payload?.uiState?.isRoundTransitioning,
            pendingRoundId: Number.isFinite(Number(payload?.uiState?.pendingRoundId))
                ? Number(payload.uiState.pendingRoundId)
                : null,
            gameMode: String(payload?.uiState?.gameMode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play',
        });
        const sendGameSnapshot = ({ force = false } = {}) => {
            if (hostMode !== 'host') return;
            const snapshotPayload = buildGameSnapshotPayload();
            if (!snapshotPayload) return;

            const nextSignature = getGameSnapshotSignature(snapshotPayload);
            if (!force && nextSignature === lastGameSnapshotSignature) return;
            lastGameSnapshotSignature = nextSignature;
            void sendControl(CONTROL_EVENTS.GAME_SNAPSHOT, snapshotPayload);
        };
        const scheduleGameSnapshotBroadcast = ({ immediate = false, force = false } = {}) => {
            if (hostMode !== 'host') return;
            window.clearTimeout(gameSnapshotBroadcastTimer);
            gameSnapshotBroadcastTimer = null;
            if (immediate) {
                sendGameSnapshot({ force });
                return;
            }
            gameSnapshotBroadcastTimer = window.setTimeout(() => {
                gameSnapshotBroadcastTimer = null;
                sendGameSnapshot({ force });
            }, 120);
        };
        const buildPlayersSnapshotPayload = () => ({
            players: playersService.getPlayers?.() || [],
        });
        const getPlayersSnapshotSignature = (payload) => JSON.stringify(
            (payload?.players || []).map((player) => ({
                id: String(player?.id || ''),
                name: String(player?.name || ''),
                score: Number(player?.score) || 0,
            }))
        );
        const sendPlayersSnapshot = ({ force = false } = {}) => {
            if (hostMode !== 'host') return;
            const snapshotPayload = buildPlayersSnapshotPayload();
            const nextSignature = getPlayersSnapshotSignature(snapshotPayload);
            if (!force && nextSignature === lastPlayersSnapshotSignature) return;
            lastPlayersSnapshotSignature = nextSignature;
            void sendControl(CONTROL_EVENTS.PLAYERS_SNAPSHOT, snapshotPayload);
        };
        const schedulePlayersSnapshotBroadcast = ({ immediate = false, force = false } = {}) => {
            if (hostMode !== 'host') return;
            window.clearTimeout(playersSnapshotBroadcastTimer);
            playersSnapshotBroadcastTimer = null;
            if (immediate) {
                sendPlayersSnapshot({ force });
                return;
            }
            playersSnapshotBroadcastTimer = window.setTimeout(() => {
                playersSnapshotBroadcastTimer = null;
                sendPlayersSnapshot({ force });
            }, 120);
        };
        const requestControllerStateSync = () => {
            if (hostMode !== 'controller') return;
            void sendControl(CONTROL_EVENTS.GAME_SNAPSHOT_REQUEST);
            void sendControl(CONTROL_EVENTS.PLAYERS_SNAPSHOT_REQUEST);
            void sendControl(CONTROL_EVENTS.ROUND_SYNC_REQUEST);
            void sendControl(CONTROL_EVENTS.LEADERBOARD_PANEL_SYNC_REQUEST);
            void sendControl(CONTROL_EVENTS.SCORE_LOGS_SYNC_REQUEST);
            void sendControl(CONTROL_EVENTS.CURRENT_PLAYER_SYNC_REQUEST);
            void sendControl(CONTROL_EVENTS.MODAL_SYNC_REQUEST);
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
        const withModalSession = (payload = {}) => modalSyncState.withSession(payload);
        const modalService = createModalService(gameService, mediaService, pressRuntimeService, playersService, {
            presentationMode: hostMode === 'controller' ? 'controller' : 'host',
            onModalClose: hostMode === 'host'
                ? () => {
                    const closingSessionId = modalSyncState.closeSession();
                    void sendControl(CONTROL_EVENTS.CLOSE_MODAL, { sessionId: closingSessionId });
                }
                : null,
            onModalViewStateChange: hostMode === 'host'
                ? ({ mode, isAnswerShown }) => {
                    // Modal preview/edit toggle is local to the modal and must not
                    // switch the global game mode for the whole board.
                    const nextViewState = modalSyncState.setViewState({ mode, isAnswerShown });
                    if (nextViewState) {
                        void sendControl(CONTROL_EVENTS.MODAL_VIEW_STATE, nextViewState);
                    }
                }
                : null,
            onMediaPlaybackStateChange: hostMode === 'host'
                ? ({ target, isPlaying }) => { void sendControl(CONTROL_EVENTS.MODAL_MEDIA_STATE, withModalSession({ target, isPlaying })); }
                : null,
            onDirectedBetStateChange: hostMode === 'host'
                ? (state) => {
                    const nextDirectedBetState = modalSyncState.setDirectedBetState(state);
                    if (nextDirectedBetState) {
                        void sendControl(CONTROL_EVENTS.MODAL_DIRECTED_BET_STATE, nextDirectedBetState);
                    }
                }
                : null,
            onScoreLog: hostMode === 'host'
                ? (entry) => { appendScoreLog(entry, { broadcast: true }); }
                : null,
            onControllerMediaControl: ({ target, action }) => {
                if (action === 'toggle_answer') {
                    void sendControl(CONTROL_EVENTS.MODAL_TOGGLE_ANSWER, withModalSession({}));
                    return;
                }
                void sendControl(CONTROL_EVENTS.MODAL_MEDIA_CONTROL, withModalSession({ target, action }));
            },
            onControllerCommand: (type, payload = {}) => {
                void sendControl(type, withModalSession(payload));
            },
        });
        const leaveGameToLobby = async () => {
            if (hostMode === 'host') {
                try {
                    await sendControl(CONTROL_EVENTS.HOST_RUNTIME_STATE, {
                        active: false,
                        sentAt: new Date().toISOString(),
                    });
                    await new Promise((resolve) => window.setTimeout(resolve, 80));
                } catch {
                    // Ignore transport failures and continue navigation.
                }
            }
            renderLobby(user, { hostMode });
        };

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
                appendScoreLog(entry, { broadcast: false });
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
            onBackToLobby: hostMode === 'controller' ? null : () => { void leaveGameToLobby(); },
            isReadOnly: hostMode === 'controller',
            allowCurrentPlayerControl: hostMode === 'controller',
            allowLeaderboardControls: hostMode === 'controller',
            showLeaderboardQr: hostMode !== 'controller',
            scoreLogs,
            onAdjustPlayerScore: async (playerId, delta) => {
                if (hostMode === 'controller') {
                    void sendControl(CONTROL_EVENTS.LEADERBOARD_ADJUST_SCORE, { playerId, delta });
                    return;
                }
                const amount = Number(delta) || 0;
                const player = (playersService.getPlayers?.() || []).find((entry) => String(entry?.id || '') === String(playerId || ''));
                const playerName = player?.name || t('player_fallback');
                const scoreMutation = await playersService.adjustPlayerScoreWithLog(playerId, amount, {
                    kind: 'manual',
                    playerName,
                    cellLabel: `${t('leaderboard')} / ${amount >= 0 ? '+' : '-'}${Math.abs(amount)}`,
                    outcome: null,
                    happenedAt: new Date().toISOString(),
                });
                appendScoreLog(scoreMutation?.scoreLog || makeManualScoreLog({ playerId, delta: amount }), { broadcast: true });
            },
            onCurrentPlayerChange: async (playerId) => {
                if (hostMode === 'controller') {
                    void sendControl(CONTROL_EVENTS.CURRENT_PLAYER_SET, { playerId: playerId || null });
                    return;
                }
                await gameService.setCurrentPlayerId(playerId);
            },
            onCellOpen: (payload) => {
                const gameMode = String(gameService.getState()?.uiState?.gameMode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play';
                const modalMode = gameMode === 'edit' ? 'edit' : 'view';
                const sessionId = modalSyncState.beginSession({ payload, modalMode });
                const openCellPayload = modalSyncState.getOpenCellPayload();
                void sendControl(CONTROL_EVENTS.OPEN_CELL, { ...(openCellPayload || {}), modalMode, sessionId });
            },
            onLeaderboardExpandedChange: (isExpanded) => {
                leaderboardPanelExpanded = !!isExpanded;
                void sendControl(CONTROL_EVENTS.LEADERBOARD_PANEL_STATE, { isExpanded: !!isExpanded });
            },
            onScoreLogsOpenChange: (isOpen) => {
                scoreLogsOpen = !!isOpen;
                void sendControl(CONTROL_EVENTS.SCORE_LOGS_STATE, { isOpen: !!isOpen });
            },
            onRoundChangeRequest: (roundId) => {
                if (hostMode === 'controller') {
                    void sendControl(CONTROL_EVENTS.ROUND_SET, { roundId });
                    return;
                }
                void roundNavigationService.setActiveRound(roundId);
            },
            onGameModeChange: (mode) => {
                const nextMode = mode === 'edit' ? 'edit' : 'play';
                if (hostMode === 'controller') {
                    void sendControl(CONTROL_EVENTS.GAME_MODE_SET, { gameMode: nextMode });
                    return;
                }
                gameService.setGameMode(nextMode);
                modalService.setGameMode(nextMode);
                void sendControl(CONTROL_EVENTS.GAME_MODE_STATE, { gameMode: nextMode });
            },
            onClearScoreLogs: async () => {
                if (hostMode === 'controller') {
                    void sendControl(CONTROL_EVENTS.SCORE_LOGS_CLEAR_REQUEST);
                    return;
                }
                await clearAllScoreLogs();
            },
            hostControllerConnected: isHostControllerConnected,
        });
        appRef = app;
        appRef?.setHostControllerConnected?.(isHostControllerConnected);
        modalService.setGameMode(gameService.getState()?.uiState?.gameMode || 'play');

        if (entryMode === 'edit') {
            gameService.setGameMode('edit');
            modalService.setGameMode('edit');
        } else if (entryMode === 'play') {
            gameService.setGameMode('play');
            modalService.setGameMode('play');
        }

        let stopCurrentPlayerBroadcast = null;
        if (hostMode === 'host') {
            let lastPressConfirmationKey = '';
            let lastModalPressStateKey = '';
            stopPressConfirmBroadcast = pressRuntimeService.subscribe((runtime) => {
                const sessionId = modalSyncState.getSessionId();
                if (!sessionId) {
                    lastPressConfirmationKey = '';
                    lastModalPressStateKey = '';
                    modalSyncState.setPressState(null);
                    return;
                }
                const winnerPlayerId = String(runtime?.winnerPlayerId || '').trim();
                const winnerName = String(runtime?.winnerName || '').trim();
                const pressedAt = String(runtime?.pressedAt || '').trim();
                const pressExpiresAt = String(runtime?.pressExpiresAt || '').trim();
                const pressEnabled = !!runtime?.pressEnabled;
                const modalPressStateKey = `${sessionId || 'no-session'}|${winnerPlayerId}|${winnerName}|${pressedAt}|${pressExpiresAt}|${pressEnabled ? 1 : 0}`;
                if (modalPressStateKey !== lastModalPressStateKey) {
                    lastModalPressStateKey = modalPressStateKey;
                    const nextPressState = modalSyncState.setPressState({
                        winnerPlayerId: winnerPlayerId || null,
                        winnerName: winnerName || '',
                        pressedAt: pressedAt || null,
                        pressExpiresAt: pressExpiresAt || null,
                        pressEnabled,
                    });
                    if (nextPressState) {
                        void sendControl(CONTROL_EVENTS.MODAL_PRESS_STATE, nextPressState);
                    }
                }

                if (!winnerPlayerId) {
                    lastPressConfirmationKey = '';
                    return;
                }

                const timestamp = String(runtime?.pressedAt || runtime?.updatedAt || '').trim();
                const confirmationKey = `${winnerPlayerId}:${timestamp || 'no-timestamp'}`;
                if (confirmationKey === lastPressConfirmationKey) return;
                lastPressConfirmationKey = confirmationKey;

                void sendControl(CONTROL_EVENTS.PRESS_CONFIRMED, {
                    winnerPlayerId,
                    confirmationKey,
                    pressedAt: runtime?.pressedAt || null,
                    updatedAt: runtime?.updatedAt || null,
                });
            });

            let lastCurrentPlayerId = gameService.getCurrentPlayerId();
            stopCurrentPlayerBroadcast = gameService.subscribe((state) => {
                const nextPlayerId = state?.model?.getCurrentPlayerId?.() ?? null;
                if (nextPlayerId === lastCurrentPlayerId) return;
                lastCurrentPlayerId = nextPlayerId;
                void sendControl(CONTROL_EVENTS.CURRENT_PLAYER_STATE, { playerId: nextPlayerId });
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
            stopGameSnapshotBroadcast = gameService.subscribe(() => {
                scheduleGameSnapshotBroadcast();
            });
            stopPlayersSnapshotBroadcast = playersService.subscribe(() => {
                schedulePlayersSnapshotBroadcast();
            });
        }

        await hostControlChannel.connect();
        if (hostMode === 'host') {
            const sendHostActivity = () => {
                void sendControl(CONTROL_EVENTS.HOST_RUNTIME_STATE, {
                    active: true,
                    sentAt: new Date().toISOString(),
                });
            };
            sendHostActivity();
            hostActivityPingTimer = window.setInterval(sendHostActivity, HOST_ACTIVITY_PING_MS);
            void sendControl(CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE_REQUEST);
        } else {
            setControllerAvailability(false);
            const sendControllerActivity = (active = true) => {
                void sendControl(CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE, {
                    active: !!active,
                    sentAt: new Date().toISOString(),
                });
            };
            sendControllerActivity(true);
            controllerActivityPingTimer = window.setInterval(() => sendControllerActivity(true), HOST_ACTIVITY_PING_MS);
            requestControllerStateSync();
            controllerStateSyncTimer = window.setInterval(() => {
                requestControllerStateSync();
            }, 4000);
        }
        const onLeaderboardAdjustScore = (payload = {}, { makeManualScoreLog: makeFallbackLog } = {}) => {
            const amount = Number(payload?.delta) || 0;
            const player = (playersService.getPlayers?.() || []).find((entry) => String(entry?.id || '') === String(payload?.playerId || ''));
            const playerName = player?.name || t('player_fallback');
            void playersService.adjustPlayerScoreWithLog(payload?.playerId, amount, {
                kind: 'manual',
                playerName,
                cellLabel: `${t('leaderboard')} / ${amount >= 0 ? '+' : '-'}${Math.abs(amount)}`,
                outcome: null,
                happenedAt: new Date().toISOString(),
            }).then((scoreMutation) => {
                appendScoreLog(scoreMutation?.scoreLog || makeFallbackLog({ playerId: payload?.playerId, delta: amount }), { broadcast: true });
            });
        };

        const hostSyncCoordinator = createHostSyncCoordinator({
            sendControl,
            app,
            gameService,
            modalService,
            modalSyncState,
            playersService,
            roundNavigationService,
            withModalSession,
            appendScoreLog,
            mergeScoreLogs,
            getScoreLogs: () => scoreLogs,
            setScoreLogs,
            clearAllScoreLogs,
            makeManualScoreLog,
            sendRoundState,
            sendGameSnapshot,
            sendPlayersSnapshot,
            markHostControllerActiveFromPing,
            getLeaderboardPanelExpanded: () => leaderboardPanelExpanded,
            setLeaderboardPanelExpanded: (value) => { leaderboardPanelExpanded = !!value; },
            getScoreLogsOpen: () => scoreLogsOpen,
            setScoreLogsOpen: (value) => { scoreLogsOpen = !!value; },
            setHasRoundStateSynced: (value) => { hasRoundStateSynced = !!value; },
            stopRoundSyncRetry,
            onLeaderboardAdjustScore,
        });

        const controllerSyncCoordinator = createControllerSyncCoordinator({
            sendControl,
            app,
            gameService,
            modalService,
            modalSyncState,
            playersService,
            markMainHostActiveFromPing,
            getHasRoundStateSynced: () => hasRoundStateSynced,
            setHasRoundStateSynced: (value) => { hasRoundStateSynced = !!value; },
            startRoundSyncRetry,
            stopRoundSyncRetry,
            setLeaderboardPanelExpanded: (value) => { leaderboardPanelExpanded = !!value; },
            setScoreLogsOpen: (value) => { scoreLogsOpen = !!value; },
            appendScoreLog,
            mergeScoreLogs,
            getScoreLogs: () => scoreLogs,
            setScoreLogs,
        });

        const stopHostControlSubscription = hostControlChannel.subscribe((message) => {
            if (hostMode === 'host') {
                hostSyncCoordinator.handleMessage(message);
                return;
            }
            controllerSyncCoordinator.handleMessage(message);
        });

        _currentCleanup = () => {
            window.clearInterval(hostActivityPingTimer);
            hostActivityPingTimer = null;
            window.clearTimeout(hostActivityStaleTimer);
            hostActivityStaleTimer = null;
            window.clearInterval(controllerActivityPingTimer);
            controllerActivityPingTimer = null;
            window.clearTimeout(controllerActivityStaleTimer);
            controllerActivityStaleTimer = null;
            window.clearInterval(controllerStateSyncTimer);
            controllerStateSyncTimer = null;
            window.clearTimeout(gameSnapshotBroadcastTimer);
            gameSnapshotBroadcastTimer = null;
            window.clearTimeout(playersSnapshotBroadcastTimer);
            playersSnapshotBroadcastTimer = null;
            stopRoundSyncRetry();
            if (hostMode === 'host') {
                void sendControl(CONTROL_EVENTS.HOST_RUNTIME_STATE, {
                    active: false,
                    sentAt: new Date().toISOString(),
                });
                setHostControllerConnected(false);
            } else {
                void sendControl(CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE, {
                    active: false,
                    sentAt: new Date().toISOString(),
                });
            }
            stopCurrentPlayerBroadcast?.();
            stopPressConfirmBroadcast?.();
            stopRoundBroadcast?.();
            stopGameSnapshotBroadcast?.();
            stopPlayersSnapshotBroadcast?.();
            stopScoreLogsSubscription?.();
            stopGameSubscription?.();
            stopHostControlSubscription?.();
            hostControlOutbox?.destroy?.();
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
            void sendControl(CONTROL_EVENTS.HOST_RUNTIME_STATE_REQUEST);
            void sendControl(CONTROL_EVENTS.SCORE_LOG_SYNC_REQUEST);
            void sendControl(CONTROL_EVENTS.GAME_MODE_SYNC_REQUEST);
            requestControllerStateSync();
            startRoundSyncRetry();
        } else {
            sendRoundState();
            sendGameSnapshot({ force: true });
            sendPlayersSnapshot({ force: true });
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
