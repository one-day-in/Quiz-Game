import { start } from './bootstrap.js';

function installControllerZoomLock() {
  const hasTouch = window.matchMedia?.('(pointer: coarse)').matches;
  if (!hasTouch) return;

  const preventGestureZoom = (event) => event.preventDefault();
  document.addEventListener('gesturestart', preventGestureZoom, { passive: false });
  document.addEventListener('gesturechange', preventGestureZoom, { passive: false });
  document.addEventListener('gestureend', preventGestureZoom, { passive: false });

  let lastTouchEndAt = 0;
  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEndAt <= 320) event.preventDefault();
    lastTouchEndAt = now;
  }, { passive: false });
}

document.addEventListener('DOMContentLoaded', () => {
  installControllerZoomLock();

  const params = new URLSearchParams(window.location.search);
  const gameId = params.get('gameId') || '';

  start({
    hostMode: 'controller',
    forcedGameId: gameId,
  }).catch((error) => {
    console.error('Failed to start host controller:', error);
  });
});
