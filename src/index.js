// public/src/index.js
import { start } from './bootstrap.js';
import { Disposer } from './utils/disposer.js';

const IS_DEV =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

function isPhoneViewport() {
    const isNarrow = window.matchMedia('(max-width: 767px)').matches;
    const isCoarse = window.matchMedia('(pointer: coarse)').matches;
    return isNarrow && isCoarse;
}

function shouldRedirectToPlayer() {
    const params = new URLSearchParams(window.location.search);
    return isPhoneViewport() && params.get('forceHost') !== '1';
}

function redirectPhoneToPlayer() {
    if (!shouldRedirectToPlayer()) return false;
    const target = new URL(`${import.meta.env.BASE_URL}player.html`, window.location.origin);
    const source = new URL(window.location.href);
    source.searchParams.forEach((value, key) => {
        if (key !== 'forceHost') target.searchParams.set(key, value);
    });
    window.location.replace(target.toString());
    return true;
}

// Global disposer for the entire app
const appDisposer = new Disposer();

document.addEventListener('DOMContentLoaded', () => {
    if (redirectPhoneToPlayer()) return;

    if (IS_DEV) {
        window.restartApp = () => {
            const app = document.getElementById('app');
            if (app) {
                app.innerHTML = '<div class="loading">Restarting...</div>';
                appDisposer.setTimeout(() => start(), 100);
            }
        };
    }

    start().catch((err) => {
        console.error('❌ Start failed:', err);
    });
});

// Global cleanup on page unload
window.addEventListener('beforeunload', () => {
    appDisposer.destroy();
});
