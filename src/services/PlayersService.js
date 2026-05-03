import { adjustPlayerScore, adjustPlayerScoreWithLog, getPlayers, removePlayer, subscribeToPlayers, transferPlayerScoreWithLogs } from '../api/gameApi.js';

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

    setPlayersLocal(nextPlayers = []) {
      const normalized = Array.isArray(nextPlayers)
        ? nextPlayers.map((player) => ({ ...(player || {}) }))
        : [];
      players = normalized;
      emit();
      return this.getPlayers();
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

    async adjustPlayerScore(playerId, delta) {
      const updatedPlayer = await adjustPlayerScore(gameId, playerId, delta);
      players = players.map((player) => (
        String(player?.id) === String(updatedPlayer?.id) ? { ...player, ...updatedPlayer } : player
      ));
      emit();
      return updatedPlayer;
    },

    async adjustPlayerScoreWithLog(playerId, delta, scoreLog = {}) {
      const result = await adjustPlayerScoreWithLog(gameId, playerId, delta, scoreLog);
      const updatedPlayer = result?.player || null;
      if (updatedPlayer?.id) {
        players = players.map((player) => (
          String(player?.id) === String(updatedPlayer?.id) ? { ...player, ...updatedPlayer } : player
        ));
        emit();
      }
      return result;
    },

    async transferPlayerScoreWithLogs(params = {}) {
      const result = await transferPlayerScoreWithLogs(gameId, params);
      const fromPlayer = result?.fromPlayer || null;
      const toPlayer = result?.toPlayer || null;
      if (fromPlayer?.id || toPlayer?.id) {
        players = players.map((player) => {
          const playerId = String(player?.id || '');
          if (fromPlayer?.id && playerId === String(fromPlayer.id)) return { ...player, ...fromPlayer };
          if (toPlayer?.id && playerId === String(toPlayer.id)) return { ...player, ...toPlayer };
          return player;
        });
        emit();
      }
      return result;
    },

    async removePlayer(playerId) {
      players = await removePlayer(gameId, playerId);
      emit();
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
