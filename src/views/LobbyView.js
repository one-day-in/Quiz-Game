// src/views/LobbyView.js
import { listGames, renameGame } from '../api/gameApi.js';
import { GameRepository } from '../services/GameRepository.js';
import { escapeHtml } from '../utils/utils.js';
import { showConfirm, showPrompt } from '../utils/confirm.js';
import { isGameDeleteAdminUser } from '../utils/adminAccess.js';
import { formatLocaleDate, getLanguage, getSupportedLanguages, setLanguage, subscribeLanguage, t } from '../i18n.js';

export class LobbyView {
    constructor({ currentUser, onOpen, onCreate, onLogout }) {
        this._cb = { onOpen, onCreate, onLogout };
        this._currentUser = currentUser || null;
        this._root = document.createElement('div');
        this._root.className = 'lobby';
        this._games = [];
        this._loading = true;
        this._error = null;
        this._stopLanguageSubscription = subscribeLanguage(() => this._render());

        this._render();
        this._loadGames();
    }

    get el() { return this._root; }

    destroy() {
        this._stopLanguageSubscription?.();
        this._root.remove();
    }

    async _loadGames() {
        this._loading = true;
        this._error = null;
        this._render();
        try {
            this._games = await listGames();
        } catch (err) {
            console.error('[LobbyView] loadGames failed:', err);
            this._error = err.message || t('failed_to_load_games');
        }
        this._loading = false;
        this._render();
    }

    async _handleDelete(gameId, gameName) {
        if (!isGameDeleteAdminUser(this._currentUser)) {
            alert(`${t('error_prefix')}: ${t('delete_game_admin_only')}`);
            return;
        }
        if (!await showConfirm({ message: t('delete_game_confirm', { name: gameName }), confirmText: t('delete') })) return;
        try {
            // GameRepository.deleteGame wipes the game's storage folder first,
            // then removes the DB row — no orphaned media files left behind.
            await GameRepository.deleteGame(gameId);
            this._games = this._games.filter(g => g.id !== gameId);
            this._render();
        } catch (err) {
            console.error('[LobbyView] delete failed:', err);
            alert(`${t('error_prefix')}: ${err.message}`);
        }
    }

    // Inline rename: replaces the name <div> with an <input>, saves on Enter/blur
    _openRenameEditor(nameEl, game) {
        if (nameEl.querySelector('input')) return; // already editing

        const current = game.name;

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'lobby__card-name-input';
        input.value = current;

        nameEl.textContent = '';
        nameEl.appendChild(input);
        input.focus();
        input.select();

        let committed = false;

        const restore = (text) => {
            if (!nameEl.isConnected) return;
            nameEl.textContent = text;
        };

        const commit = async () => {
            if (committed) return;
            committed = true;

            const next = input.value.trim();

            if (!next || next === current) {
                restore(current);
                return;
            }

            // Optimistic update — feels instant
            restore(next);

            try {
                await renameGame(game.id, next);
                game.name = next; // keep local cache in sync
            } catch (err) {
                console.error('[LobbyView] rename failed:', err);
                restore(current);
                game.name = current;
                alert(`${t('error_prefix')}: ${err.message}`);
            }
        };

        input.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter')  { ev.preventDefault(); commit(); }
            if (ev.key === 'Escape') { ev.preventDefault(); committed = true; restore(current); }
        });

        input.addEventListener('blur', commit);
    }

    _render() {
        const { onOpen, onCreate, onLogout } = this._cb;
        const gameGroups = this._groupGamesByCreator();
        const canDeleteGames = isGameDeleteAdminUser(this._currentUser);

        this._root.innerHTML = `
            <div class="lobby__header">
                <h1 class="lobby__title">🎮 ${t('quiz_games')}</h1>
                <div class="lobby__langSwitch" role="group" aria-label="${t('language')}">
                    ${getSupportedLanguages().map((language) => `
                        <button
                            class="lobby__langBtn${language === getLanguage() ? ' is-active' : ''}"
                            type="button"
                            data-language="${language}"
                        >${escapeHtml(t(`language_${language}`))}</button>
                    `).join('')}
                </div>
                <button class="lobby__logout-btn" type="button" aria-label="${t('logout')}" title="${t('logout')}">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M14 3h-4a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h4" />
                        <path d="M10 12h10" />
                        <path d="m17 7 5 5-5 5" />
                    </svg>
                </button>
            </div>

            <div class="lobby__body">
                <button class="lobby__create-btn" type="button">＋ ${t('new_game')}</button>

                ${this._loading ? `
                    <div class="inline-loader">
                        <div class="inline-loader__ring"></div>
                        <span>${t('loading_games')}</span>
                    </div>
                ` : ''}
                ${this._error ? `<div class="lobby__error">${escapeHtml(this._error)}</div>` : ''}

                ${!this._loading && !this._error && this._games.length === 0 ? `
                    <div class="lobby__empty">${t('no_saved_games')}</div>
                ` : ''}

                <div class="lobby__groups">
                    ${gameGroups.map(({ ownerId, ownerLabel, avatarLabel, avatarUrl, games }) => `
                        <section class="lobby__group" data-owner-id="${escapeHtml(ownerId)}">
                            <div class="lobby__groupHead">
                                ${avatarUrl ? `
                                    <img
                                        class="lobby__groupAvatar lobby__groupAvatar--image"
                                        src="${escapeHtml(avatarUrl)}"
                                        alt="${escapeHtml(ownerLabel)}"
                                        referrerpolicy="no-referrer"
                                    />
                                ` : `
                                    <div class="lobby__groupAvatar" style="${escapeHtml(this._buildAvatarStyle(ownerId))}">
                                        ${escapeHtml(avatarLabel)}
                                    </div>
                                `}
                                <div class="lobby__groupMeta">
                                    <p class="lobby__groupEyebrow">${t('created_by')}</p>
                                    <h2 class="lobby__groupTitle">${escapeHtml(ownerLabel)}</h2>
                                </div>
                            </div>
                            <div class="lobby__list">
                                ${games.map(game => `
                                    <div class="lobby__row" data-id="${escapeHtml(game.id)}">
                                        <div class="lobby__rowMain">
                                            <div class="lobby__rowName">${escapeHtml(game.name)}</div>
                                            <div class="lobby__rowDate">${t('updated_at')}: ${formatLocaleDate(game.updated_at)}</div>
                                        </div>
                                        <div class="lobby__rowActions">
                                            <button
                                                class="lobby__rowRename"
                                                data-id="${escapeHtml(game.id)}"
                                                type="button"
                                                title="${t('rename_game')}"
                                            >✏</button>
                                            ${canDeleteGames ? `
                                                <button
                                                    class="lobby__rowDelete"
                                                    data-id="${escapeHtml(game.id)}"
                                                    data-name="${escapeHtml(game.name)}"
                                                    type="button"
                                                    title="${t('delete_game')}"
                                                >🗑️</button>
                                            ` : ''}
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </section>
                    `).join('')}
                </div>
            </div>
        `;

        // Logout
        this._root.querySelector('.lobby__logout-btn')
            ?.addEventListener('click', () => onLogout?.());

        this._root.querySelectorAll('.lobby__langBtn').forEach((btn) => {
            btn.addEventListener('click', () => {
                setLanguage(btn.dataset.language);
            });
        });

        // Create new game
        this._root.querySelector('.lobby__create-btn')
            ?.addEventListener('click', async () => {
                const name = await showPrompt({
                    message:     t('new_game_name'),
                    placeholder: t('game_name_placeholder'),
                    confirmText: t('create'),
                });
                if (name) await onCreate?.(name);
            });

        // Open game (click on card body, not action buttons)
        this._root.querySelectorAll('.lobby__row').forEach(row => {
            const id = row.dataset.id;
            const game = this._games.find(g => g.id === id);
            row.addEventListener('click', (e) => {
                if (e.target.closest('.lobby__rowDelete')) return;
                if (e.target.closest('.lobby__rowRename')) return;
                if (e.target.closest('.lobby__card-name-input')) return;
                onOpen?.(id, game?.name || t('new_game'));
            });
        });

        // Rename game
        this._root.querySelectorAll('.lobby__rowRename').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = btn.closest('.lobby__row');
                const nameEl = row?.querySelector('.lobby__rowName');
                const game = this._games.find(g => g.id === btn.dataset.id);
                if (game && nameEl) this._openRenameEditor(nameEl, game);
            });
        });

        // Delete game
        this._root.querySelectorAll('.lobby__rowDelete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const { id, name } = btn.dataset;
                this._handleDelete(id, name);
            });
        });
    }

    _groupGamesByCreator() {
        const groups = new Map();
        const currentUserId = this._currentUser?.id || null;

        for (const game of this._games) {
            const ownerId = game.created_by || 'unknown';
            if (!groups.has(ownerId)) groups.set(ownerId, []);
            groups.get(ownerId).push(game);
        }

        return Array.from(groups.entries()).map(([ownerId, games], index) => {
            const profile = games[0]?.creatorProfile || null;
            const isCurrentUser = currentUserId && ownerId === currentUserId;
            const ownerLabel = isCurrentUser
                ? (this._currentUser?.user_metadata?.full_name || this._currentUser?.email || t('you'))
                : (profile?.full_name || profile?.email || t('creator_fallback', { index: index + 1, id: ownerId.slice(0, 4) }));
            const avatarLabel = isCurrentUser
                ? this._getInitials(this._currentUser?.user_metadata?.full_name || this._currentUser?.email || t('you'))
                : this._getInitials(profile?.full_name || profile?.email || t('creator_short', { index: index + 1 }));
            const avatarUrl = isCurrentUser
                ? (this._currentUser?.user_metadata?.avatar_url || this._currentUser?.user_metadata?.picture || '')
                : (profile?.avatar_url || '');

            return { ownerId, ownerLabel, avatarLabel, avatarUrl, games };
        });
    }

    _getInitials(label) {
        return String(label || '')
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0] || '')
            .join('')
            .toUpperCase() || 'U';
    }

    _buildAvatarStyle(seed) {
        const value = Array.from(String(seed || 'seed'))
            .reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        const hue = value % 360;
        return `--avatar-hue:${hue};`;
    }
}
