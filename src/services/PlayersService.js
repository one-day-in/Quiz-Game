import { getPlayers, subscribeToPlayers } from '../api/gameApi.js';

export function createPlayersService(gameId) {
  let players = [];
  let refreshTimer = null;
  let stopSubscription = null;
  const subs = new Set();

  function emit() {
    const snapshot = players.slice();
    for (const fn of subs) fn(snapshot);
  }

  async function syncPlayers() {
    players = await getPlayers(gameId);
    emit();
    return players;
  }

  async function refreshLoop() {
    try {
      await syncPlayers();
    } catch (error) {
      console.error('[PlayersService] refresh failed:', error);
    } finally {
      refreshTimer = window.setTimeout(refreshLoop, 1500);
    }
  }

  return {
    getPlayers() {
      return players.slice();
    },

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    async initialize() {
      await syncPlayers();
      stopSubscription?.();
      stopSubscription = subscribeToPlayers(gameId, (nextPlayers) => {
        players = Array.isArray(nextPlayers) ? nextPlayers : [];
        emit();
      });
      refreshTimer = window.setTimeout(refreshLoop, 1500);
      return this.getPlayers();
    },

    destroy() {
      stopSubscription?.();
      stopSubscription = null;
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
      subs.clear();
    },
  };
}
