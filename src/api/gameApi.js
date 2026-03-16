import { supabase } from './supabaseClient.js';

export const MAX_PLAYERS = 8;
const LIVE_DEFAULTS = Object.freeze({
    isArmed: false,
    activeQuestion: null,
    buzz: null,
});

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
        players: [],
        live: structuredClone(LIVE_DEFAULTS),
    };
}

function createPlayerId() {
    return `p_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

function normalizePlayer(player, idx = 0) {
    return {
        id: (player?.id || createPlayerId()).toString(),
        name: (player?.name || `Player ${idx + 1}`).toString().trim() || `Player ${idx + 1}`,
        points: Number.isFinite(player?.points) ? player.points : 0,
        controllerId: player?.controllerId ? String(player.controllerId) : null,
        joinedAt: player?.joinedAt || new Date().toISOString(),
    };
}

function normalizePlayers(players = []) {
    return (Array.isArray(players) ? players : [])
        .slice(0, MAX_PLAYERS)
        .map((player, idx) => normalizePlayer(player, idx));
}

function normalizeLive(live) {
    return {
        isArmed: !!live?.isArmed,
        activeQuestion: live?.activeQuestion ?? null,
        buzz: live?.buzz ?? null,
    };
}

function normalizeGame(game = {}) {
    return {
        ...game,
        meta: {
            updatedAt: game?.meta?.updatedAt || new Date().toISOString(),
        },
        rounds: Array.isArray(game?.rounds) ? game.rounds : Array.from({ length: 3 }, makeDefaultRound),
        players: normalizePlayers(game?.players),
        live: normalizeLive(game?.live),
    };
}

function extractGameFromRealtimePayload(payload) {
    const data = payload?.new?.data ?? payload?.record?.data ?? payload?.data ?? null;
    return data ? normalizeGame(data) : null;
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
    return normalizeGame(data.data);
}

async function getGameRow(gameId) {
    const { data, error } = await supabase
        .from('games')
        .select('data, updated_at')
        .eq('id', gameId)
        .single();

    if (error) throw new Error(`[Game] getGame failed: ${error.message}`);
    return {
        data: normalizeGame(data.data),
        updatedAt: data.updated_at,
    };
}

export async function saveGame(gameId, gameData) {
    const normalized = normalizeGame(gameData);
    const { error } = await supabase
        .from('games')
        .update({ data: normalized, updated_at: new Date().toISOString() })
        .eq('id', gameId);

    if (error) throw new Error(`[Game] saveGame failed: ${error.message}`);
    return { ok: true };
}

export function subscribeToGame(gameId, onGameChange) {
    const channel = supabase
        .channel(`game:${gameId}`)
        .on(
            'postgres_changes',
            {
                event: 'UPDATE',
                schema: 'public',
                table: 'games',
                filter: `id=eq.${gameId}`,
            },
            (payload) => {
                const game = extractGameFromRealtimePayload(payload);
                if (game) onGameChange(game);
            }
        )
        .subscribe();

    return () => {
        supabase.removeChannel(channel);
    };
}

export function subscribeToPlayers(gameId, onPlayersChange) {
    return subscribeToGame(gameId, (game) => onPlayersChange(game.players ?? []));
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
    return normalizePlayers(game.players);
}

export async function savePlayers(gameId, players) {
    const game = await getGame(gameId);
    game.players = normalizePlayers(players);
    game.meta.updatedAt = new Date().toISOString();
    return saveGame(gameId, game);
}

export async function getPlayerByController(gameId, controllerId) {
    if (!controllerId) return null;
    const players = await getPlayers(gameId);
    return players.find((player) => player.controllerId === controllerId) ?? null;
}

export async function claimPlayerSlot(gameId, { name, controllerId }) {
    const game = await getGame(gameId);
    const players = normalizePlayers(game.players);
    const nextName = (name || '').trim();
    if (!nextName) throw new Error('Player name is required');
    if (!controllerId) throw new Error('Controller ID is required');

    const existing = players.find((player) => player.controllerId === controllerId);
    if (existing) {
        existing.name = nextName;
        game.players = players;
        game.meta.updatedAt = new Date().toISOString();
        await saveGame(gameId, game);
        return existing;
    }

    if (players.length >= MAX_PLAYERS) {
        throw new Error('No free player slots');
    }

    const player = normalizePlayer({
        id: createPlayerId(),
        name: nextName,
        points: 0,
        controllerId,
        joinedAt: new Date().toISOString(),
    }, players.length);

    players.push(player);
    game.players = players;
    game.meta.updatedAt = new Date().toISOString();
    await saveGame(gameId, game);
    return player;
}

export async function updatePlayer(gameId, playerId, updates = {}) {
    const game = await getGame(gameId);
    const players = normalizePlayers(game.players);
    const player = players.find((entry) => entry.id === playerId);
    if (!player) throw new Error('Player not found');

    if (typeof updates.name === 'string') {
        const nextName = updates.name.trim();
        player.name = nextName || player.name;
    }

    if (Number.isFinite(updates.points)) {
        player.points = updates.points;
    }

    if (typeof updates.controllerId === 'string') {
        player.controllerId = updates.controllerId;
    }

    game.players = players;
    game.meta.updatedAt = new Date().toISOString();
    await saveGame(gameId, game);
    return player;
}

export async function adjustPlayerScore(gameId, playerId, delta) {
    const game = await getGame(gameId);
    const players = normalizePlayers(game.players);
    const player = players.find((entry) => entry.id === playerId);
    if (!player) throw new Error('Player not found');

    player.points = (Number(player.points) || 0) + (Number(delta) || 0);
    game.players = players;
    game.meta.updatedAt = new Date().toISOString();
    await saveGame(gameId, game);
    return player;
}

export async function removePlayer(gameId, playerId) {
    const game = await getGame(gameId);
    const players = normalizePlayers(game.players);
    const nextPlayers = players.filter((entry) => entry.id !== playerId);
    if (nextPlayers.length === players.length) throw new Error('Player not found');

    const buzz = normalizeLive(game.live).buzz;
    if (buzz?.winnerPlayerId === playerId) {
        game.live = {
            ...normalizeLive(game.live),
            buzz: {
                ...buzz,
                winnerPlayerId: null,
                winnerAt: null,
                status: 'open',
            },
        };
    }

    game.players = nextPlayers;
    game.meta.updatedAt = new Date().toISOString();
    await saveGame(gameId, game);
    return nextPlayers;
}

export async function setLiveState(gameId, patch = {}) {
    const game = await getGame(gameId);
    game.live = {
        ...normalizeLive(game.live),
        ...patch,
    };
    game.meta.updatedAt = new Date().toISOString();
    await saveGame(gameId, game);
    return game.live;
}

export async function claimBuzz(gameId, playerId) {
    const { data: game, updatedAt } = await getGameRow(gameId);
    const buzz = normalizeLive(game.live).buzz;
    if (!buzz) throw new Error('Buzz is not active');

    const now = new Date().toISOString();
    const enabledAt = buzz.enabledAt ? new Date(buzz.enabledAt).getTime() : 0;
    const nowMs = Date.now();

    if (buzz.winnerPlayerId) throw new Error('Too late');
    if (nowMs < enabledAt) throw new Error('Buzz is not open yet');

    game.live = {
        ...normalizeLive(game.live),
        buzz: {
            ...buzz,
            status: 'buzzed',
            winnerPlayerId: playerId,
            winnerAt: now,
        },
    };
    game.meta.updatedAt = now;

    const { data, error } = await supabase
        .from('games')
        .update({ data: game, updated_at: now })
        .eq('id', gameId)
        .eq('updated_at', updatedAt)
        .select('data')
        .maybeSingle();

    if (error) throw new Error(`[Game] claimBuzz failed: ${error.message}`);
    if (!data) throw new Error('Too late');

    return normalizeLive(data.data.live).buzz;
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
