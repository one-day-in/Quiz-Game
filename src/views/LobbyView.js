// src/views/LobbyView.js
import { listGames } from '../api/gameApi.js';
import { GameRepository } from '../services/GameRepository.js';
import { escapeHtml } from '../utils/utils.js';
import { showConfirm, showPrompt } from '../utils/confirm.js';

function formatDate(isoStr) {
    if (!isoStr) return '';
    try {
        return new Date(isoStr).toLocaleString('uk-UA', {
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    } catch { return ''; }
}

export class LobbyView {
    constructor({ onOpen, onCreate, onLogout }) {
        this._cb = { onOpen, onCreate, onLogout };
        this._root = document.createElement('div');
        this._root.className = 'lobby';
        this._games = [];
        this._loading = true;
        this._error = null;

        this._render();
        this._loadGames();
    }

    get el() { return this._root; }

    destroy() { this._root.remove(); }

    async _loadGames() {
        this._loading = true;
        this._error = null;
        this._render();
        try {
            this._games = await listGames();
        } catch (err) {
            console.error('[LobbyView] loadGames failed:', err);
            this._error = err.message || 'Failed to load games';
        }
        this._loading = false;
        this._render();
    }

    async _handleDelete(gameId, gameName) {
        if (!await showConfirm({ message: `Delete game "${gameName}"?`, confirmText: 'Delete' })) return;
        try {
            // GameRepository.deleteGame wipes the game's storage folder first,
            // then removes the DB row — no orphaned media files left behind.
            await GameRepository.deleteGame(gameId);
            this._games = this._games.filter(g => g.id !== gameId);
            this._render();
        } catch (err) {
            console.error('[LobbyView] delete failed:', err);
            alert(`Error deleting game: ${err.message}`);
        }
    }

    _render() {
        const { onOpen, onCreate, onLogout } = this._cb;

        this._root.innerHTML = `
            <div class="lobby__header">
                <h1 class="lobby__title">🎮 Quiz Games</h1>
                <button class="lobby__logout-btn" type="button">↪ Logout</button>
            </div>

            <div class="lobby__body">
                <button class="lobby__create-btn" type="button">＋ New Game</button>

                ${this._loading ? `
                    <div class="inline-loader">
                        <div class="inline-loader__ring"></div>
                        <span>Loading...</span>
                    </div>
                ` : ''}
                ${this._error ? `<div class="lobby__error">${escapeHtml(this._error)}</div>` : ''}

                ${!this._loading && !this._error && this._games.length === 0 ? `
                    <div class="lobby__empty">No saved games yet. Create your first one!</div>
                ` : ''}

                <div class="lobby__grid">
                    ${this._games.map(game => `
                        <div class="lobby__card" data-id="${escapeHtml(game.id)}">
                            <div class="lobby__card-name">${escapeHtml(game.name)}</div>
                            <div class="lobby__card-date">
                                Updated: ${formatDate(game.updated_at)}
                            </div>
                            <button
                                class="lobby__card-delete"
                                data-id="${escapeHtml(game.id)}"
                                data-name="${escapeHtml(game.name)}"
                                type="button"
                                title="Delete game"
                            >🗑️</button>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Logout
        this._root.querySelector('.lobby__logout-btn')
            ?.addEventListener('click', () => onLogout?.());

        // Create new game
        this._root.querySelector('.lobby__create-btn')
            ?.addEventListener('click', async () => {
                const name = await showPrompt({
                    message:     'New game name:',
                    placeholder: 'e.g. Round 1...',
                    confirmText: 'Create',
                });
                if (name) await onCreate?.(name);
            });

        // Open game (click on card body, not delete btn)
        this._root.querySelectorAll('.lobby__card').forEach(card => {
            const id = card.dataset.id;
            const game = this._games.find(g => g.id === id);
            card.addEventListener('click', (e) => {
                if (e.target.closest('.lobby__card-delete')) return;
                onOpen?.(id, game?.name || 'Game');
            });
        });

        // Delete game
        this._root.querySelectorAll('.lobby__card-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const { id, name } = btn.dataset;
                this._handleDelete(id, name);
            });
        });
    }
}
