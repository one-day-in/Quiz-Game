import { start } from './bootstrap.js';

document.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  const gameId = params.get('gameId') || '';

  start({
    hostMode: 'controller',
    forcedGameId: gameId,
  }).catch((error) => {
    console.error('Failed to start host controller:', error);
  });
});
