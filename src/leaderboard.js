import { supabase } from './api/supabaseClient.js';
import { getPlayers, savePlayers } from './api/gameApi.js';
import { FooterView } from './views/FooterView.js';

const root = document.getElementById('leaderboard-app');

// gameId from URL: /leaderboard.html?gameId=xxx
const gameId = new URLSearchParams(location.search).get('gameId');

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

    let initialPlayers;
    try {
        initialPlayers = await getPlayers(gameId);
    } catch (e) {
        root.innerHTML = `
            <div class="page-error">
                <h2 class="page-error__title">Error loading players</h2>
                <pre class="page-error__detail">${e.message}</pre>
            </div>`;
        return;
    }

    root.innerHTML = '';

    // Debounced save — 600ms after last change
    let saveTimer = null;

    const leaderboard = FooterView({
        initialPlayers,
        onPlayersChange: (players) => {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => {
                savePlayers(gameId, players).catch(console.error);
            }, 600);
        }
    });

    root.appendChild(leaderboard);
}

startLeaderboard();
