// public/src/index.js
import { start } from './bootstrap.js';
import { Disposer } from './utils/disposer.js';

const IS_DEV =
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

// Global disposer for the entire app
const appDisposer = new Disposer();

document.addEventListener('DOMContentLoaded', () => {
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
