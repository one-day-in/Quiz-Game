import { supabase } from './api/supabaseClient.js';
import { getPlayers } from './api/gameApi.js';
import { LeaderboardGridView } from './views/LeaderboardGridView.js';

const root = document.getElementById('leaderboard-app');

// gameId from URL: /leaderboard.html?gameId=xxx
const gameId = new URLSearchParams(location.search).get('gameId');
let refreshTimer = null;
let leaderboardEl = null;

async function startLeaderboard() {
    // Auth check
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        root.innerHTML = `
            <div class="page-error">
                <h2 class="page-error__title">Not logged in</h2>
                <pre class="page-error__detail">Please open the game first.</pre>
            </div>`;
        return;
    }

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
        renderLeaderboard(players);
        scheduleRefresh();
    } catch (e) {
        root.innerHTML = `
            <div class="page-error">
                <h2 class="page-error__title">Error loading players</h2>
                <pre class="page-error__detail">${e.message}</pre>
            </div>`;
    }
}

function renderLeaderboard(players) {
    leaderboardEl?.destroy?.();
    root.innerHTML = '';
    leaderboardEl = LeaderboardGridView({ players, maxPlayers: 8 });
    root.appendChild(leaderboardEl);
}

function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(async () => {
        try {
            const players = await getPlayers(gameId);
            renderLeaderboard(players);
        } catch (error) {
            console.error('[leaderboard] refresh failed:', error);
        } finally {
            scheduleRefresh();
        }
    }, 2000);
}

startLeaderboard();
