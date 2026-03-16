import { getPlayers, subscribeToPlayers } from './api/gameApi.js';
import { LeaderboardGridView } from './views/LeaderboardGridView.js';
import QRCode from 'qrcode';

const root = document.getElementById('leaderboard-app');

// gameId from URL: /leaderboard.html?gameId=xxx
const gameId = new URLSearchParams(location.search).get('gameId');
let leaderboardEl = null;
let stopGameSubscription = null;
let refreshTimer = null;
let lastLeaderboardSnapshot = '';
let leaderboardShell = null;
let leaderboardJoinPanel = null;
let isJoinPanelCollapsed = false;

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
        const players = await getPlayers(gameId);
        await renderLeaderboard(players);
        stopGameSubscription?.();
        stopGameSubscription = subscribeToPlayers(gameId, (nextPlayers) => {
            void renderLeaderboard(nextPlayers);
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

async function renderLeaderboard(players = []) {
    const snapshot = JSON.stringify(players);
    if (snapshot === lastLeaderboardSnapshot) return;
    lastLeaderboardSnapshot = snapshot;

    if (!leaderboardShell) {
        root.innerHTML = '';

        leaderboardShell = document.createElement('div');
        leaderboardShell.className = 'leaderboard-page';

        leaderboardJoinPanel = document.createElement('section');
        leaderboardJoinPanel.className = 'leaderboard-page__joinPanel';
        leaderboardJoinPanel.innerHTML = `
            <div class="leaderboard-page__joinHeader">
                <div class="leaderboard-page__joinCopy">
                    <p class="leaderboard-page__eyebrow">Players</p>
                    <h1 class="leaderboard-page__title">Connect a player controller</h1>
                    <p class="leaderboard-page__text">Scan this QR code on a phone to join the game, set a name, and manage your score.</p>
                </div>
                <button class="leaderboard-page__toggle" type="button"></button>
            </div>
            <div class="leaderboard-page__qrWrap">
                <img class="leaderboard-page__qr" alt="Player controller QR code">
            </div>
        `;

        const toggleBtn = leaderboardJoinPanel.querySelector('.leaderboard-page__toggle');
        toggleBtn?.addEventListener('click', () => {
            isJoinPanelCollapsed = !isJoinPanelCollapsed;
            syncJoinPanelState();
        });

        leaderboardShell.appendChild(leaderboardJoinPanel);
        leaderboardEl = LeaderboardGridView({
            players,
            maxPlayers: 8,
        });
        leaderboardShell.appendChild(leaderboardEl);
        root.appendChild(leaderboardShell);

        syncJoinPanelState();
        await renderPlayerJoinQr(leaderboardJoinPanel);
        return;
    }

    leaderboardEl?.update?.(players);
}

function syncJoinPanelState() {
    if (!leaderboardJoinPanel) return;
    leaderboardJoinPanel.classList.toggle('is-collapsed', isJoinPanelCollapsed);
    const toggleBtn = leaderboardJoinPanel.querySelector('.leaderboard-page__toggle');
    if (!toggleBtn) return;
    toggleBtn.textContent = isJoinPanelCollapsed ? 'Show join panel' : 'Hide join panel';
    toggleBtn.setAttribute('aria-expanded', String(!isJoinPanelCollapsed));
}

function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(async () => {
        try {
            const players = await getPlayers(gameId);
            await renderLeaderboard(players);
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
