import { supabase } from './supabaseClient.js';
import {
    DEFAULT_CELL,
    fetchGameRecord,
    fetchPlayerRows,
    makeDefaultRound,
    serializeGameForStorage,
} from './gameApi.shared.js';

export async function getGame(gameId) {
    const [game, players] = await Promise.all([
        fetchGameRecord(gameId),
        fetchPlayerRows(gameId),
    ]);
    game.players = players;
    return game;
}

export async function saveGame(gameId, gameData) {
    const normalized = serializeGameForStorage(gameData);
    const { error } = await supabase
        .from('games')
        .update({ data: normalized, updated_at: new Date().toISOString() })
        .eq('id', gameId);

    if (error) throw new Error(`[Game] saveGame failed: ${error.message}`);
    return { ok: true };
}

export function subscribeToGame(gameId, onGameChange) {
    let disposed = false;

    async function emitSnapshot() {
        if (disposed) return;
        try {
            const game = await getGame(gameId);
            if (!disposed) onGameChange(game);
        } catch (error) {
            console.error('[Game] subscribeToGame refresh failed:', error);
        }
    }

    const gameChannel = supabase
        .channel(`game:${gameId}`)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'games',
                filter: `id=eq.${gameId}`,
            },
            () => { void emitSnapshot(); }
        )
        .subscribe();

    const playersChannel = supabase
        .channel(`game-players:${gameId}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'game_players',
                filter: `game_id=eq.${gameId}`,
            },
            () => { void emitSnapshot(); }
        )
        .subscribe();

    return () => {
        disposed = true;
        supabase.removeChannel(gameChannel);
        supabase.removeChannel(playersChannel);
    };
}

export async function updateCell(gameId, roundId, rowId, cellId, updates) {
    const game = await getGame(gameId);
    const cell = game.rounds?.[roundId]?.rows?.[rowId]?.cells?.[cellId];
    if (!cell) throw new Error('Cell not found');

    if (typeof updates.isAnswered === 'boolean') cell.isAnswered = updates.isAnswered;
    if (Object.prototype.hasOwnProperty.call(updates, 'modifier')) cell.modifier = updates.modifier || null;
    if (updates.question) Object.assign(cell.question, updates.question);
    if (updates.answer) Object.assign(cell.answer, updates.answer);

    game.meta.updatedAt = new Date().toISOString();
    return saveGame(gameId, game);
}

export async function updateTopic(gameId, roundId, rowId, topic) {
    const game = await getGame(gameId);
    const row = game.rounds?.[roundId]?.rows?.[rowId];
    if (!row) throw new Error('Row not found');

    row.topic = topic.trim();
    game.meta.updatedAt = new Date().toISOString();
    return saveGame(gameId, game);
}

export async function addAudioToCell(gameId, roundId, rowId, cellId, type, audioRecord) {
    const game = await getGame(gameId);
    const cell = game.rounds?.[roundId]?.rows?.[rowId]?.cells?.[cellId];
    if (!cell) throw new Error('Cell not found');

    const section = cell[type];
    if (!Array.isArray(section.audioFiles)) section.audioFiles = [];
    section.audioFiles.push(audioRecord);

    game.meta.updatedAt = new Date().toISOString();
    return saveGame(gameId, game);
}

export async function removeAudioFromCell(gameId, roundId, rowId, cellId, type, filename) {
    const game = await getGame(gameId);
    const cell = game.rounds?.[roundId]?.rows?.[rowId]?.cells?.[cellId];
    if (!cell) throw new Error('Cell not found');

    const files = cell[type]?.audioFiles;
    if (Array.isArray(files)) {
        const idx = files.findIndex((f) => f.filename === filename);
        if (idx !== -1) files.splice(idx, 1);
    }

    game.meta.updatedAt = new Date().toISOString();
    return saveGame(gameId, game);
}

export async function resetRound(gameId, roundId) {
    const game = await getGame(gameId);
    if (!game.rounds?.[roundId]) throw new Error('Round not found');

    game.rounds[roundId] = makeDefaultRound();
    game.meta.updatedAt = new Date().toISOString();
    await saveGame(gameId, game);
    return game;
}

export async function resetCell(gameId, roundId, rowId, cellId) {
    const game = await getGame(gameId);
    const row = game.rounds?.[roundId]?.rows?.[rowId];
    if (!row?.cells?.[cellId]) throw new Error('Cell not found');

    row.cells[cellId] = JSON.parse(JSON.stringify(DEFAULT_CELL));
    game.meta.updatedAt = new Date().toISOString();
    await saveGame(gameId, game);
    return game;
}
