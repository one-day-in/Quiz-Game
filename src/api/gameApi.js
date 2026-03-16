import { supabase } from './supabaseClient.js';

export const MAX_PLAYERS = 8;
const PUBLIC_PLAYER_COLUMNS = 'id, game_id, name, points, joined_at';
const PRIVATE_PLAYER_COLUMNS = `${PUBLIC_PLAYER_COLUMNS}, controller_id`;
const GAME_RUNTIME_COLUMNS = 'game_id, press_enabled, winner_player_id, pressed_at, updated_at';

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

function normalizeGame(game = {}) {
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

function serializeGameForStorage(game = {}) {
    const normalized = normalizeGame(game);
    return {
        ...normalized,
        players: [],
    };
}

function normalizePlayerRow(row, idx = 0, { includeControllerId = false } = {}) {
    return normalizePlayer({
        id: row?.id,
        name: row?.name,
        points: row?.points,
        controllerId: includeControllerId ? row?.controller_id : null,
        joinedAt: row?.joined_at,
    }, idx);
}

function normalizePlayerRows(rows = [], options = {}) {
    return (Array.isArray(rows) ? rows : []).map((row, idx) => normalizePlayerRow(row, idx, options));
}

async function fetchGameRecord(gameId) {
    const { data, error } = await supabase
        .from('games')
        .select('data')
        .eq('id', gameId)
        .single();

    if (error) throw new Error(`[Game] getGame failed: ${error.message}`);
    return normalizeGame(data.data);
}

async function fetchPlayerRows(gameId, { includeControllerId = false } = {}) {
    const columns = includeControllerId ? PRIVATE_PLAYER_COLUMNS : PUBLIC_PLAYER_COLUMNS;
    const { data, error } = await supabase
        .from('game_players')
        .select(columns)
        .eq('game_id', gameId)
        .order('joined_at', { ascending: true });

    if (error) throw new Error(`[Game] getPlayers failed: ${error.message}`);
    return normalizePlayerRows(data, { includeControllerId });
}

async function fetchGameRuntime(gameId) {
    const { data, error } = await supabase
        .from('game_runtime')
        .select(GAME_RUNTIME_COLUMNS)
        .eq('game_id', gameId)
        .maybeSingle();

    if (error) throw new Error(`[Game] getGameRuntime failed: ${error.message}`);
    let winnerName = null;
    if (data?.winner_player_id) {
        const { data: winnerRow, error: winnerError } = await supabase
            .from('game_players')
            .select('name')
            .eq('id', data.winner_player_id)
            .maybeSingle();

        if (winnerError) throw new Error(`[Game] getGameRuntime winner failed: ${winnerError.message}`);
        winnerName = winnerRow?.name || null;
    }

    return {
        gameId,
        pressEnabled: !!data?.press_enabled,
        winnerPlayerId: data?.winner_player_id || null,
        winnerName,
        pressedAt: data?.pressed_at || null,
        updatedAt: data?.updated_at || null,
    };
}

function mapPlayerRpcResult(data) {
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Player not found');
    return normalizePlayerRow(row, 0, { includeControllerId: false });
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
        .select('id, name, created_at, updated_at, created_by')
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

export function subscribeToPlayers(gameId, onPlayersChange) {
    let disposed = false;

    async function emitPlayers() {
        if (disposed) return;
        try {
            const players = await getPlayers(gameId);
            if (!disposed) onPlayersChange(players);
        } catch (error) {
            console.error('[Game] subscribeToPlayers refresh failed:', error);
        }
    }

    const channel = supabase
        .channel(`game-players:list:${gameId}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'game_players',
                filter: `game_id=eq.${gameId}`,
            },
            () => { void emitPlayers(); }
        )
        .subscribe();

    return () => {
        disposed = true;
        supabase.removeChannel(channel);
    };
}

export async function getGameRuntime(gameId) {
    return fetchGameRuntime(gameId);
}

export async function setPressEnabled(gameId, enabled) {
    const { data, error } = await supabase
        .from('game_runtime')
        .upsert({
            game_id: gameId,
            press_enabled: !!enabled,
            winner_player_id: null,
            pressed_at: null,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'game_id' })
        .select(GAME_RUNTIME_COLUMNS)
        .single();

    if (error) throw new Error(`[Game] setPressEnabled failed: ${error.message}`);
    return {
        gameId: data.game_id,
        pressEnabled: !!data.press_enabled,
        winnerPlayerId: data.winner_player_id || null,
        winnerName: null,
        pressedAt: data.pressed_at || null,
        updatedAt: data.updated_at,
    };
}

export async function claimGamePress(gameId, controllerId) {
    const { data, error } = await supabase.rpc('claim_game_press', {
        p_game_id: gameId,
        p_controller_id: controllerId,
    });

    if (error) throw new Error(`[Game] claimGamePress failed: ${error.message}`);

    const row = Array.isArray(data) ? data[0] : data;
    return {
        gameId: row?.game_id || gameId,
        winnerPlayerId: row?.winner_player_id || null,
        winnerName: row?.winner_name || null,
        pressedAt: row?.pressed_at || null,
        pressEnabled: !!row?.press_enabled,
    };
}

export function subscribeToGameRuntime(gameId, onRuntimeChange) {
    let disposed = false;

    async function emitRuntime() {
        if (disposed) return;
        try {
            const runtime = await getGameRuntime(gameId);
            if (!disposed) onRuntimeChange(runtime);
        } catch (error) {
            console.error('[Game] subscribeToGameRuntime refresh failed:', error);
        }
    }

    const channel = supabase
        .channel(`game-runtime:${gameId}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'game_runtime',
                filter: `game_id=eq.${gameId}`,
            },
            () => { void emitRuntime(); }
        )
        .subscribe();

    return () => {
        disposed = true;
        supabase.removeChannel(channel);
    };
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
    return fetchPlayerRows(gameId);
}

export async function savePlayers(gameId, players) {
    const normalizedPlayers = normalizePlayers(players);
    const { error: deleteError } = await supabase
        .from('game_players')
        .delete()
        .eq('game_id', gameId);

    if (deleteError) throw new Error(`[Game] savePlayers failed: ${deleteError.message}`);

    if (!normalizedPlayers.length) return [];

    const rows = normalizedPlayers.map((player, idx) => ({
        id: player.id,
        game_id: gameId,
        name: player.name,
        points: player.points,
        controller_id: player.controllerId || `ctrl_seed_${idx}_${Math.random().toString(16).slice(2, 10)}`,
        joined_at: player.joinedAt || new Date().toISOString(),
    }));

    const { error: insertError } = await supabase
        .from('game_players')
        .insert(rows);

    if (insertError) throw new Error(`[Game] savePlayers failed: ${insertError.message}`);
    return normalizedPlayers;
}

export async function getPlayerByController(gameId, controllerId) {
    if (!controllerId) return null;
    const { data, error } = await supabase
        .from('game_players')
        .select(PRIVATE_PLAYER_COLUMNS)
        .eq('game_id', gameId)
        .eq('controller_id', controllerId)
        .maybeSingle();

    if (error) throw new Error(`[Game] getPlayerByController failed: ${error.message}`);
    return data ? normalizePlayerRow(data, 0, { includeControllerId: true }) : null;
}

export async function claimPlayerSlot(gameId, { name, controllerId }) {
    const nextName = (name || '').trim();
    if (!nextName) throw new Error('Player name is required');
    if (!controllerId) throw new Error('Controller ID is required');

    const { data, error } = await supabase.rpc('claim_game_player', {
        p_game_id: gameId,
        p_name: nextName,
        p_controller_id: controllerId,
    });

    if (error) throw new Error(`[Game] claimPlayerSlot failed: ${error.message}`);
    return mapPlayerRpcResult(data);
}

export async function updatePlayer(gameId, playerId, updates = {}) {
    const patch = {};
    if (typeof updates.name === 'string' && updates.name.trim()) patch.name = updates.name.trim();
    if (Number.isFinite(updates.points)) patch.points = updates.points;
    if (typeof updates.controllerId === 'string' && updates.controllerId.trim()) patch.controller_id = updates.controllerId.trim();
    patch.updated_at = new Date().toISOString();

    const { data, error } = await supabase
        .from('game_players')
        .update(patch)
        .eq('game_id', gameId)
        .eq('id', playerId)
        .select(PUBLIC_PLAYER_COLUMNS)
        .single();

    if (error) throw new Error(`[Game] updatePlayer failed: ${error.message}`);
    return normalizePlayerRow(data);
}

export async function adjustPlayerScore(gameId, playerId, delta) {
    const { data: current, error: loadError } = await supabase
        .from('game_players')
        .select(PUBLIC_PLAYER_COLUMNS)
        .eq('game_id', gameId)
        .eq('id', playerId)
        .single();

    if (loadError) throw new Error(`[Game] adjustPlayerScore failed: ${loadError.message}`);

    const nextPoints = (Number(current.points) || 0) + (Number(delta) || 0);
    return updatePlayer(gameId, playerId, { points: nextPoints });
}

export async function removePlayer(gameId, playerId) {
    const { error } = await supabase
        .from('game_players')
        .delete()
        .eq('game_id', gameId)
        .eq('id', playerId);

    if (error) throw new Error(`[Game] removePlayer failed: ${error.message}`);
    return getPlayers(gameId);
}

export async function updatePlayerByController(gameId, controllerId, updates = {}) {
    const nextName = typeof updates.name === 'string' ? updates.name.trim() : null;
    if (!nextName) throw new Error('Player name is required');

    const { data, error } = await supabase.rpc('rename_game_player', {
        p_game_id: gameId,
        p_controller_id: controllerId,
        p_name: nextName,
    });

    if (error) throw new Error(`[Game] updatePlayerByController failed: ${error.message}`);
    return mapPlayerRpcResult(data);
}

export async function adjustPlayerScoreByController(gameId, controllerId, delta) {
    const { data, error } = await supabase.rpc('adjust_game_player_score', {
        p_game_id: gameId,
        p_controller_id: controllerId,
        p_delta: Number(delta) || 0,
    });

    if (error) throw new Error(`[Game] adjustPlayerScoreByController failed: ${error.message}`);
    return mapPlayerRpcResult(data);
}

export async function removePlayerByController(gameId, controllerId) {
    const { error } = await supabase.rpc('leave_game_player', {
        p_game_id: gameId,
        p_controller_id: controllerId,
    });

    if (error) throw new Error(`[Game] removePlayerByController failed: ${error.message}`);
    return true;
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
