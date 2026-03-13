import { getGame, removePlayer, subscribeToGame } from './api/gameApi.js';
import { LeaderboardGridView } from './views/LeaderboardGridView.js';
import QRCode from 'qrcode';

const root = document.getElementById('leaderboard-app');

// gameId from URL: /leaderboard.html?gameId=xxx
const gameId = new URLSearchParams(location.search).get('gameId');
let leaderboardEl = null;
let stopGameSubscription = null;
let refreshTimer = null;
let lastLeaderboardSnapshot = '';

async function startLeaderboard() {
    if (!gameId) {
        root.innerHTML = `
            <div class="page-error">
                <h2 class="page-error__title">No game selected</h2>
                <pre class="page-error__detail">Open leaderboard from the game header.</pre>
            </div>`;
        return;
    }

    root.innerHTML = `
        <div class="page-loader">
            <div class="page-loader__ring"></div>
            <p class="page-loader__text">Loading…</p>
        </div>`;

    try {
        const game = await getGame(gameId);
        await renderLeaderboard(game);
        stopGameSubscription?.();
        stopGameSubscription = subscribeToGame(gameId, (nextGame) => {
            void renderLeaderboard(nextGame);
        });
        scheduleRefresh();
    } catch (e) {
        root.innerHTML = `
            <div class="page-error">
                <h2 class="page-error__title">Error loading players</h2>
                <pre class="page-error__detail">${e.message}</pre>
            </div>`;
    }
}

async function renderLeaderboard(game) {
    const players = game?.players ?? [];
    const snapshot = JSON.stringify(players);
    if (snapshot === lastLeaderboardSnapshot) return;
    lastLeaderboardSnapshot = snapshot;

    leaderboardEl?.destroy?.();
    root.innerHTML = '';

    const shell = document.createElement('div');
    shell.className = 'leaderboard-page';

    const joinPanel = document.createElement('section');
    joinPanel.className = 'leaderboard-page__joinPanel';
    joinPanel.innerHTML = `
        <div class="leaderboard-page__joinCopy">
            <p class="leaderboard-page__eyebrow">Players</p>
            <h1 class="leaderboard-page__title">Connect a player controller</h1>
            <p class="leaderboard-page__text">Scan this QR code on a phone to join the game, set a name, and use the buzzer.</p>
        </div>
        <div class="leaderboard-page__qrWrap">
            <img class="leaderboard-page__qr" alt="Player controller QR code">
        </div>
    `;

    shell.appendChild(joinPanel);
    leaderboardEl = LeaderboardGridView({
        players,
        maxPlayers: 8,
        onRemovePlayer: async (player) => {
            if (!window.confirm(`Remove ${player.name}?`)) return;
            try {
                await removePlayer(gameId, player.id);
            } catch (error) {
                console.error('[leaderboard] remove player failed:', error);
                window.alert(error.message || 'Could not remove player');
            }
        },
    });
    shell.appendChild(leaderboardEl);
    root.appendChild(shell);

    await renderPlayerJoinQr(joinPanel);
}

function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(async () => {
        try {
            const game = await getGame(gameId);
            await renderLeaderboard(game);
        } catch (error) {
            console.error('[leaderboard] fallback refresh failed:', error);
        } finally {
            scheduleRefresh();
        }
    }, 1500);
}

async function renderPlayerJoinQr(joinPanel) {
    const qrImg = joinPanel.querySelector('.leaderboard-page__qr');
    if (!qrImg) return;

    const url = `${window.location.origin}${import.meta.env.BASE_URL}player.html?gameId=${gameId}`;

    try {
        qrImg.src = await QRCode.toDataURL(url, {
            width: 512,
            margin: 2,
            color: { dark: '#f8fafc', light: '#111827' }
        });
    } catch (error) {
        console.error('[leaderboard] QR generation failed:', error);
    }
}

startLeaderboard();

window.addEventListener('beforeunload', () => {
    stopGameSubscription?.();
    clearTimeout(refreshTimer);
});
