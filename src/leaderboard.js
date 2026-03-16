import { getPlayers, subscribeToPlayers, removePlayer } from './api/gameApi.js';
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
let addPlayerDrawer = null;

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

        leaderboardEl = LeaderboardGridView({
            players,
            maxPlayers: 8,
            onAddPlayer: openAddPlayerDrawer,
            onDeletePlayer: async (playerId) => {
                try {
                    const updatedPlayers = await removePlayer(gameId, playerId);
                    lastLeaderboardSnapshot = '';
                    await renderLeaderboard(updatedPlayers);
                } catch (e) {
                    console.error('[leaderboard] removePlayer failed:', e);
                }
            },
        });
        leaderboardShell.appendChild(leaderboardEl);
        root.appendChild(leaderboardShell);

        ensureAddPlayerDrawer();
        return;
    }

    leaderboardEl?.update?.(players);
}

function ensureAddPlayerDrawer() {
    if (addPlayerDrawer) return addPlayerDrawer;

    const drawer = document.createElement('div');
    drawer.className = 'leaderboard-drawer leaderboard-page__drawer';
    drawer.hidden = true;
    drawer.innerHTML = `
        <div class="leaderboard-drawer__overlay"></div>
        <aside class="leaderboard-drawer__panel" role="dialog" aria-modal="true" aria-label="Add player">
            <header class="leaderboard-drawer__header">
                <h3 class="leaderboard-drawer__title">Add player</h3>
                <button class="leaderboard-drawer__close" type="button" aria-label="Close">&times;</button>
            </header>
            <div class="leaderboard-drawer__body leaderboard-page__drawerBody">
                <div class="leaderboard-page__drawerCopy">
                    <p class="leaderboard-page__eyebrow">Players</p>
                    <p class="leaderboard-page__text">Scan this QR code on a phone to join the game, set a name, and manage your score.</p>
                </div>
                <div class="leaderboard-drawer__section leaderboard-drawer__section--qr">
                    <div class="leaderboard-drawer__qr-wrap">
                        <div class="leaderboard-drawer__qr-glow"></div>
                        <img class="leaderboard-drawer__qr-img leaderboard-page__qr" alt="Player controller QR code">
                    </div>
                </div>
            </div>
        </aside>
    `;

    const overlay = drawer.querySelector('.leaderboard-drawer__overlay');
    const closeBtn = drawer.querySelector('.leaderboard-drawer__close');
    overlay?.addEventListener('click', closeAddPlayerDrawer);
    closeBtn?.addEventListener('click', closeAddPlayerDrawer);

    document.body.appendChild(drawer);
    addPlayerDrawer = drawer;
    void renderPlayerJoinQr(drawer);
    return drawer;
}

function openAddPlayerDrawer() {
    const drawer = ensureAddPlayerDrawer();
    drawer.hidden = false;
    requestAnimationFrame(() => {
        drawer.classList.add('is-open');
    });
}

function closeAddPlayerDrawer() {
    if (!addPlayerDrawer) return;
    addPlayerDrawer.classList.remove('is-open');
    window.setTimeout(() => {
        if (addPlayerDrawer && !addPlayerDrawer.classList.contains('is-open')) {
            addPlayerDrawer.hidden = true;
        }
    }, 220);
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
    const url = `${window.location.origin}${import.meta.env.BASE_URL}player.html?gameId=${gameId}`;
    const qrImg = joinPanel.querySelector('.leaderboard-page__qr');
    if (!qrImg) return;

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
    addPlayerDrawer?.remove();
});
