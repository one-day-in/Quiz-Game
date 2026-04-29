// public/src/services/GameService.js
import GameModel from '../models/GameModel.js';

// ─── Filename collectors ──────────────────────────────────────────────────────
// Used before reset operations to gather all storage paths that will become
// orphaned after the JSONB is overwritten with blank data.

function collectFilenamesFromCell(cell) {
    const names = [];
    for (const section of ['question', 'answer']) {
        if (cell[section]?.media?.filename) names.push(cell[section].media.filename);
        for (const audio of (cell[section]?.audioFiles ?? [])) {
            if (audio?.filename) names.push(audio.filename);
        }
    }
    return names;
}

function collectFilenamesFromRound(round) {
    const names = [];
    for (const row of (round.rows ?? [])) {
        for (const cell of (row.cells ?? [])) {
            names.push(...collectFilenamesFromCell(cell));
        }
    }
    return names;
}

class GameService {
    constructor(repo) {
        this.repo = repo;
        this.model = null;
        this.uiState = { activeRoundId: 0, isRoundTransitioning: false, pendingRoundId: null, gameMode: 'play' };
        this._subs = new Set();
        this._roundTransitionToken = 0;
    }

    subscribe(fn) {
        this._subs.add(fn);
        return () => this._subs.delete(fn);
    }

    _emit() {
        const state = this.getState();
        for (const fn of this._subs) fn(state);
    }

    // Targeted re-render after modal closes (cellHint = which cell changed)
    touch(cellHint = null) {
        const state = this.getState();
        if (cellHint) state._cellHint = cellHint;
        for (const fn of this._subs) fn(state);
    }

    getState() {
        return {
            model: this.model,
            uiState: {
                ...this.uiState,
            }
        };
    }

    getModel() { return this.model; }
    getGameId() { return this.repo.getGameId(); }
    getCurrentPlayerId() { return this.model?.getCurrentPlayerId?.() ?? null; }
    isInitialized() { return this.model !== null; }

    _showRoundTransition(label, sub = '') {
        const el = document.getElementById('mode-transition');
        if (!el) return;
        el.innerHTML = `
            <div class="mode-transition__panel">
                <div class="mode-transition__ring" aria-hidden="true"></div>
                <span class="mode-transition__label">${label}</span>
                ${sub ? `<span class="mode-transition__sub">${sub}</span>` : ''}
            </div>
        `;
        el.classList.add('mode-transition--visible');
    }

    _hideRoundTransition() {
        const el = document.getElementById('mode-transition');
        if (!el) return;
        el.classList.remove('mode-transition--visible');
    }

    async setActiveRound(roundId) {
        const id = Number(roundId);
        if (!Number.isFinite(id) || id < 0) return;
        if (this.uiState.activeRoundId === id) return;
        if (this.uiState.isRoundTransitioning) return;

        const roundName = this.model?.rounds?.[id]?.name;
        const token = ++this._roundTransitionToken;

        this.uiState.pendingRoundId = id;
        this.uiState.isRoundTransitioning = true;
        this._emit();
        this._showRoundTransition(`Loading Round ${id + 1}`, roundName || '');

        await new Promise((resolve) => window.setTimeout(resolve, 260));
        if (token !== this._roundTransitionToken) return;

        this.uiState.activeRoundId = id;
        this.uiState.pendingRoundId = null;
        this.uiState.isRoundTransitioning = false;
        localStorage.setItem('activeRoundId', String(id));
        this._emit();

        window.setTimeout(() => {
            if (token !== this._roundTransitionToken) return;
            this._hideRoundTransition();
        }, 140);
    }

    restoreUiState() {
        const roundId = Number(localStorage.getItem('activeRoundId'));
        if (Number.isFinite(roundId) && roundId >= 0) this.uiState.activeRoundId = roundId;
        const gameMode = String(localStorage.getItem('gameMode') || '').toLowerCase();
        if (gameMode === 'edit' || gameMode === 'play') this.uiState.gameMode = gameMode;
        this._emit();
    }

    setGameMode(mode = 'play') {
        const nextMode = String(mode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play';
        if (this.uiState.gameMode === nextMode) return;
        this.uiState.gameMode = nextMode;
        localStorage.setItem('gameMode', nextMode);
        this._emit();
    }

    setGameModeLocal(mode = 'play') {
        const nextMode = String(mode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play';
        if (this.uiState.gameMode === nextMode) return;
        this.uiState.gameMode = nextMode;
        this._emit();
    }

    async initialize() {
        const gameData = await this.repo.loadGame();
        this.model = new GameModel(gameData);
        this._emit();
        return this.model;
    }

    applyRemoteSnapshot(gameData) {
        if (!gameData) return false;
        const nextUpdatedAt = Date.parse(gameData?.meta?.updatedAt || '') || 0;
        const currentUpdatedAt = Date.parse(this.model?.meta?.updatedAt || '') || 0;

        // Ignore stale snapshots that can occasionally arrive out of order.
        if (currentUpdatedAt && nextUpdatedAt && nextUpdatedAt < currentUpdatedAt) {
            return false;
        }

        this.model = new GameModel(gameData);
        this._emit();
        return true;
    }

    async save() {
        if (!this.model) return false;
        await this.repo.saveGame(this.model.toJSON());
        return true;
    }

    async setCurrentPlayerId(playerId) {
        if (!this.model) throw new Error('GameService not initialized');

        const prevPlayerId = this.model.getCurrentPlayerId?.() ?? null;
        const nextPlayerId = playerId ? String(playerId) : null;

        if (prevPlayerId === nextPlayerId) return true;

        this.model.setCurrentPlayerId?.(nextPlayerId);
        this._emit();

        try {
            await this.repo.saveGame(this.model.toJSON());
            return true;
        } catch (err) {
            this.model.setCurrentPlayerId?.(prevPlayerId);
            this._emit();
            throw err;
        }
    }

    setCurrentPlayerIdLocal(playerId) {
        if (!this.model) return;
        const nextPlayerId = playerId ? String(playerId) : null;
        this.model.setCurrentPlayerId?.(nextPlayerId);
        this._emit();
    }

    setRoundStateLocal(nextState = {}) {
        const activeRoundId = Number(nextState?.activeRoundId);
        const pendingRoundRaw = nextState?.pendingRoundId;
        const pendingRoundId = pendingRoundRaw === null || typeof pendingRoundRaw === 'undefined'
            ? null
            : Number(pendingRoundRaw);

        if (Number.isFinite(activeRoundId) && activeRoundId >= 0) {
            this.uiState.activeRoundId = activeRoundId;
        }
        this.uiState.isRoundTransitioning = !!nextState?.isRoundTransitioning;
        this.uiState.pendingRoundId = Number.isFinite(pendingRoundId) && pendingRoundId >= 0
            ? pendingRoundId
            : null;
        this.uiState.gameMode = String(nextState?.gameMode || this.uiState.gameMode || 'play').toLowerCase() === 'edit'
            ? 'edit'
            : 'play';
        this._emit();
    }

    getCell(roundId, rowId, cellId) {
        return this.model?.getCell(roundId, rowId, cellId) ?? null;
    }

    setCellAnsweredLocal(roundId, rowId, cellId, isAnswered = true) {
        if (!this.model) return false;
        const cell = this.model.getCell(roundId, rowId, cellId);
        if (!cell) return false;
        const nextAnswered = !!isAnswered;
        if (cell.isAnswered === nextAnswered) return true;
        cell.isAnswered = nextAnswered;
        this.model.meta.updatedAt = new Date().toISOString();
        this._emit();
        return true;
    }

    async updateTopic(roundId, rowId, topic) {
        if (!this.model) throw new Error('GameService not initialized');

        const prev = this.model.getTopic?.(roundId, rowId); // snapshot for rollback
        try {
            // optimistic local update
            this.model.updateTopic(roundId, rowId, topic);
            this.model.meta.updatedAt = new Date().toISOString();
            this._emit();

            // persist
            await this.repo.updateTopic(roundId, rowId, topic);
            return true;
        } catch (err) {
            // rollback best-effort
            if (typeof prev !== 'undefined' && this.model.getTopic) {
                try {
                    this.model.updateTopic(roundId, rowId, prev);
                    this.model.meta.updatedAt = new Date().toISOString();
                    this._emit();
                } catch (_) { }
            }
            throw err;
        }
    }

    async updateCell(roundId, rowId, cellId, patch) {
        if (!this.model) throw new Error('GameService not initialized');

        const cell = this.model.getCell(roundId, rowId, cellId);
        if (!cell) return false;

        // snapshot for rollback
        const prev = {
            isAnswered: cell.isAnswered,
            question: cell.question ? { ...cell.question } : null,
            answer: cell.answer ? { ...cell.answer } : null
        };

        // optimistic local update
        if (typeof patch?.isAnswered === 'boolean') cell.isAnswered = patch.isAnswered;
        if (patch?.question) cell.question = { ...(cell.question || {}), ...patch.question };
        if (patch?.answer) cell.answer = { ...(cell.answer || {}), ...patch.answer };

        this.model.meta.updatedAt = new Date().toISOString();
        this._emit();

        try {
            // persist to backend
            await this.repo.updateCell(roundId, rowId, cellId, patch);
            return true;
        } catch (err) {
            // rollback
            cell.isAnswered = prev.isAnswered;
            cell.question = prev.question;
            cell.answer = prev.answer;
            this.model.meta.updatedAt = new Date().toISOString();
            this._emit();
            throw err;
        }
    }

    async addAudioToCell(roundId, rowId, cellId, type, audioRecord) {
        if (!this.model) throw new Error('GameService not initialized');

        const cell = this.model.getCell(roundId, rowId, cellId);
        const section = cell?.[type];
        if (!section) throw new Error('Cell section not found');

        const prevAudioFiles = Array.isArray(section.audioFiles) ? [...section.audioFiles] : [];

        section.audioFiles = [...prevAudioFiles, audioRecord];
        this.model.meta.updatedAt = new Date().toISOString();
        this._emit();

        try {
            await this.repo.addAudioToCell(roundId, rowId, cellId, type, audioRecord);
            return true;
        } catch (err) {
            section.audioFiles = prevAudioFiles;
            this.model.meta.updatedAt = new Date().toISOString();
            this._emit();
            throw err;
        }
    }

    async removeAudioFromCell(roundId, rowId, cellId, type, filename) {
        if (!this.model) throw new Error('GameService not initialized');

        const cell = this.model.getCell(roundId, rowId, cellId);
        const section = cell?.[type];
        if (!section) throw new Error('Cell section not found');

        const prevAudioFiles = Array.isArray(section.audioFiles) ? [...section.audioFiles] : [];
        section.audioFiles = prevAudioFiles.filter(file => file?.filename !== filename);

        this.model.meta.updatedAt = new Date().toISOString();
        this._emit();

        try {
            await this.repo.removeAudioFromCell(roundId, rowId, cellId, type, filename);
            return true;
        } catch (err) {
            section.audioFiles = prevAudioFiles;
            this.model.meta.updatedAt = new Date().toISOString();
            this._emit();
            throw err;
        }
    }

    async resetRound(roundId) {
        // Delete all storage files belonging to this round before wiping its JSONB data
        const currentRound = this.model?.rounds?.[roundId];
        if (currentRound) {
            const filenames = collectFilenamesFromRound(currentRound);
            if (filenames.length) {
                try {
                    await this.repo.deleteStorageFiles(filenames);
                } catch (e) {
                    console.warn('[GameService] resetRound: could not delete media files:', e);
                    // Non-fatal — proceed with data reset regardless
                }
            }
        }

        const fresh = await this.repo.resetRound(roundId);
        this.model = new GameModel(fresh);
        this._emit();
        return true;
    }

    async resetCell(roundId, rowId, cellId) {
        // Delete all storage files belonging to this cell before wiping its JSONB data
        const currentCell = this.model?.getCell(roundId, rowId, cellId);
        if (currentCell) {
            const filenames = collectFilenamesFromCell(currentCell);
            if (filenames.length) {
                try {
                    await this.repo.deleteStorageFiles(filenames);
                } catch (e) {
                    console.warn('[GameService] resetCell: could not delete media files:', e);
                    // Non-fatal — proceed with data reset regardless
                }
            }
        }

        const fresh = await this.repo.resetCell(roundId, rowId, cellId);
        this.model = new GameModel(fresh);
        this._emit();
        return true;
    }

}

export function createGameService(repo) {
    return new GameService(repo);
}
