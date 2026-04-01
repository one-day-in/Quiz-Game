import { supabase } from './supabaseClient.js';

export const MAX_PLAYERS = 8;
export const PUBLIC_PLAYER_COLUMNS = 'id, game_id, name, points, joined_at';
export const PRIVATE_PLAYER_COLUMNS = `${PUBLIC_PLAYER_COLUMNS}, controller_id`;
export const GAME_RUNTIME_COLUMNS = 'game_id, press_enabled, winner_player_id, pressed_at, updated_at';

export const DEFAULT_CELL = {
    isAnswered: false,
    question: { text: '', media: null, audioFiles: [] },
    answer:   { text: '', media: null, audioFiles: [] }
};

export function makeDefaultRow() {
    return {
        topic: '',
        cells: Array.from({ length: 5 }, () => JSON.parse(JSON.stringify(DEFAULT_CELL)))
    };
}

export function makeDefaultRound() {
    return { rows: Array.from({ length: 5 }, makeDefaultRow) };
}

export function makeDefaultGame() {
    return {
        schemaVersion: '1.0',
        meta: { updatedAt: new Date().toISOString() },
        rounds: Array.from({ length: 3 }, makeDefaultRound),
        players: [],
    };
}

function createPlayerId() {
    return `p_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export function normalizePlayer(player, idx = 0) {
    return {
        id: (player?.id || createPlayerId()).toString(),
        name: (player?.name || `Player ${idx + 1}`).toString().trim() || `Player ${idx + 1}`,
        points: Number.isFinite(player?.points) ? player.points : 0,
        controllerId: player?.controllerId ? String(player.controllerId) : null,
        joinedAt: player?.joinedAt || new Date().toISOString(),
    };
}

export function normalizePlayers(players = []) {
    return (Array.isArray(players) ? players : [])
        .slice(0, MAX_PLAYERS)
        .map((player, idx) => normalizePlayer(player, idx));
}

export function normalizeGame(game = {}) {
    const { live: _live, ...rest } = game || {};
    return {
        ...rest,
        meta: {
            updatedAt: game?.meta?.updatedAt || new Date().toISOString(),
        },
        rounds: Array.isArray(game?.rounds) ? game.rounds : Array.from({ length: 3 }, makeDefaultRound),
        players: normalizePlayers(game?.players),
    };
}

export function serializeGameForStorage(game = {}) {
    const normalized = normalizeGame(game);
    return {
        ...normalized,
        players: [],
    };
}

export function normalizePlayerRow(row, idx = 0, { includeControllerId = false } = {}) {
    return normalizePlayer({
        id: row?.id,
        name: row?.name,
        points: row?.points,
        controllerId: includeControllerId ? row?.controller_id : null,
        joinedAt: row?.joined_at,
    }, idx);
}

export function normalizePlayerRows(rows = [], options = {}) {
    return (Array.isArray(rows) ? rows : []).map((row, idx) => normalizePlayerRow(row, idx, options));
}

export async function fetchGameRecord(gameId) {
    const { data, error } = await supabase
        .from('games')
        .select('data')
        .eq('id', gameId)
        .single();

    if (error) throw new Error(`[Game] getGame failed: ${error.message}`);
    return normalizeGame(data.data);
}

export async function fetchPlayerRows(gameId, { includeControllerId = false } = {}) {
    const columns = includeControllerId ? PRIVATE_PLAYER_COLUMNS : PUBLIC_PLAYER_COLUMNS;
    const { data, error } = await supabase
        .from('game_players')
        .select(columns)
        .eq('game_id', gameId)
        .order('joined_at', { ascending: true });

    if (error) throw new Error(`[Game] getPlayers failed: ${error.message}`);
    return normalizePlayerRows(data, { includeControllerId });
}

export function mapPlayerRpcResult(data) {
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Player not found');
    return normalizePlayerRow(row, 0, { includeControllerId: false });
}
