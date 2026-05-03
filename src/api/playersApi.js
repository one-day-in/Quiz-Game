import { supabase } from './supabaseClient.js';
import {
    MAX_PLAYERS,
    PRIVATE_PLAYER_COLUMNS,
    PUBLIC_PLAYER_COLUMNS,
    fetchPlayerRows,
    mapPlayerRpcResult,
    normalizePlayers,
    normalizePlayerRow,
} from './gameApi.shared.js';

export { MAX_PLAYERS };

const MISSING_RPC_CODE = 'PGRST202';
let adjustByIdRpcMissing = false;

function isMissingRpcError(error, fnName) {
    const message = String(error?.message || '');
    const details = String(error?.details || '');
    const hint = String(error?.hint || '');
    const text = `${message} ${details} ${hint}`.toLowerCase();
    const normalizedFnName = String(fnName || '').toLowerCase();
    return error?.code === MISSING_RPC_CODE
        || (
            normalizedFnName
            && text.includes(normalizedFnName)
            && (
                text.includes('could not find the function')
                || text.includes('schema cache')
                || text.includes('not found')
            )
        );
}

async function getPlayerControllerId(gameId, playerId) {
    const { data, error } = await supabase
        .from('game_players')
        .select('controller_id')
        .eq('game_id', gameId)
        .eq('id', playerId)
        .maybeSingle();

    if (error) throw new Error(`[Game] adjustPlayerScore fallback lookup failed: ${error.message}`);
    const controllerId = String(data?.controller_id || '').trim();
    if (!controllerId) throw new Error('[Game] adjustPlayerScore fallback failed: player controller not found');
    return controllerId;
}

export async function getPlayers(gameId) {
    return fetchPlayerRows(gameId);
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
    const normalizedDelta = Number(delta) || 0;
    if (!adjustByIdRpcMissing) {
        const { data, error } = await supabase.rpc('adjust_game_player_score_by_id', {
            p_game_id: gameId,
            p_player_id: playerId,
            p_delta: normalizedDelta,
        });

        if (!error) return mapPlayerRpcResult(data);
        if (!isMissingRpcError(error, 'adjust_game_player_score_by_id')) {
            throw new Error(`[Game] adjustPlayerScore failed: ${error.message}`);
        }
        adjustByIdRpcMissing = true;
        console.warn('[Game] adjust_game_player_score_by_id RPC is unavailable, using adjust_game_player_score fallback.');
    }

    const controllerId = await getPlayerControllerId(gameId, playerId);
    const { data, error } = await supabase.rpc('adjust_game_player_score', {
        p_game_id: gameId,
        p_controller_id: controllerId,
        p_delta: normalizedDelta,
    });

    if (error) throw new Error(`[Game] adjustPlayerScore failed: ${error.message}`);
    return mapPlayerRpcResult(data);
}

export async function removePlayer(gameId, playerId) {
    const { error } = await supabase.rpc('delete_game_player', {
        p_game_id: gameId,
        p_player_id: playerId,
    });

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
