import { supabase } from './supabaseClient.js';

// ================================================
// DEFAULT GAME STATE
// ================================================
const DEFAULT_CELL = {
    isAnswered: false,
    question: { text: '', media: null, audioFiles: [] },
    answer:   { text: '', media: null, audioFiles: [] }
};

function makeDefaultRow() {
    return {
        topic: '',
        cells: Array.from({ length: 5 }, () => JSON.parse(JSON.stringify(DEFAULT_CELL)))
    };
}

function makeDefaultRound() {
    return { rows: Array.from({ length: 5 }, makeDefaultRow) };
}

function makeDefaultGame() {
    return {
        schemaVersion: '1.0',
        meta: { updatedAt: new Date().toISOString() },
        rounds: Array.from({ length: 3 }, makeDefaultRound),
        players: []
    };
}

// ================================================
// LOBBY — game list
// ================================================
export async function listGames() {
    const { data, error } = await supabase
        .from('games')
        .select('id, name, created_at, updated_at')
        .order('updated_at', { ascending: false });

    if (error) throw new Error(`[Game] listGames failed: ${error.message}`);
    return data ?? [];
}

export async function createGame(name) {
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
        .from('games')
        .insert({
            name: (name || 'Untitled').trim(),
            data: makeDefaultGame(),
            created_by: user?.id ?? null
        })
        .select('id, name')
        .single();

    if (error) throw new Error(`[Game] createGame failed: ${error.message}`);
    return data;
}

export async function renameGame(gameId, name) {
    const { error } = await supabase
        .from('games')
        .update({ name: name.trim() })
        .eq('id', gameId);

    if (error) throw new Error(`[Game] renameGame failed: ${error.message}`);
    return { ok: true };
}

export async function deleteGame(gameId) {
    const { error } = await supabase
        .from('games')
        .delete()
        .eq('id', gameId);

    if (error) throw new Error(`[Game] deleteGame failed: ${error.message}`);
    return { ok: true };
}

// ================================================
// READ / WRITE
// ================================================
export async function getGame(gameId) {
    const { data, error } = await supabase
        .from('games')
        .select('data')
        .eq('id', gameId)
        .single();

    if (error) throw new Error(`[Game] getGame failed: ${error.message}`);
    return data.data;
}

export async function saveGame(gameId, gameData) {
    const { error } = await supabase
        .from('games')
        .update({ data: gameData, updated_at: new Date().toISOString() })
        .eq('id', gameId);

    if (error) throw new Error(`[Game] saveGame failed: ${error.message}`);
    return { ok: true };
}

// ================================================
// GRANULAR UPDATES
// (fetch + patch + upsert — single user, race condition not critical)
// ================================================
export async function updateCell(gameId, roundId, rowId, cellId, updates) {
    const game = await getGame(gameId);
    const cell = game.rounds?.[roundId]?.rows?.[rowId]?.cells?.[cellId];
    if (!cell) throw new Error('Cell not found');

    if (typeof updates.isAnswered === 'boolean') cell.isAnswered = updates.isAnswered;
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

// ================================================
// PLAYERS (leaderboard)
// ================================================
export async function getPlayers(gameId) {
    const game = await getGame(gameId);
    return Array.isArray(game.players) ? game.players : [];
}

export async function savePlayers(gameId, players) {
    const game = await getGame(gameId);
    game.players = players;
    game.meta.updatedAt = new Date().toISOString();
    return saveGame(gameId, game);
}

// ================================================
// AUDIO (multiple per cell section)
// ================================================
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
        const idx = files.findIndex(f => f.filename === filename);
        if (idx !== -1) files.splice(idx, 1);
    }

    game.meta.updatedAt = new Date().toISOString();
    return saveGame(gameId, game);
}

// ================================================
// RESET
// ================================================
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
