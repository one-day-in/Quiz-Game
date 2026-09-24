import { supabase } from './supabaseClient.js';
import {
    MAX_PLAYERS,
    PUBLIC_PLAYER_COLUMNS,
    fetchPlayerRows,
    mapPlayerRpcResult,
    normalizePlayers,
    normalizePlayerRow,
} from './gameApi.shared.js';
import { mapScoreLogRow } from './scoreLogsApi.js';

export { MAX_PLAYERS };

function mapPlayerFromMutationRow(row = {}, prefix = 'player_') {
    return normalizePlayerRow({
        id: row?.[`${prefix}id`],
        game_id: row?.[`${prefix}game_id`],
        name: row?.[`${prefix}name`],
        points: row?.[`${prefix}points`],
        joined_at: row?.[`${prefix}joined_at`],
    });
}

function mapScoreLogFromMutationRow(row = {}, prefix = 'log_') {
    return mapScoreLogRow({
        id: row?.[`${prefix}id`],
        game_id: row?.[`${prefix}game_id`],
        player_id: row?.[`${prefix}player_id`],
        player_name: row?.[`${prefix}player_name`],
        cell_label: row?.[`${prefix}cell_label`],
        outcome: row?.[`${prefix}outcome`],
        delta: row?.[`${prefix}delta`],
        score_before: row?.[`${prefix}score_before`],
        score_after: row?.[`${prefix}score_after`],
        kind: row?.[`${prefix}kind`],
        happened_at: row?.[`${prefix}happened_at`],
        created_at: row?.[`${prefix}created_at`],
    });
}

function mapAdjustWithLogResult(data) {
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Player not found');
    return {
        player: mapPlayerFromMutationRow(row, 'player_'),
        scoreLog: mapScoreLogFromMutationRow(row, 'log_'),
    };
}

function mapTransferWithLogsResult(data) {
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Player not found');
    return {
        fromPlayer: mapPlayerFromMutationRow(row, 'from_player_'),
        toPlayer: mapPlayerFromMutationRow(row, 'to_player_'),
        fromScoreLog: mapScoreLogFromMutationRow(row, 'from_log_'),
        toScoreLog: mapScoreLogFromMutationRow(row, 'to_log_'),
    };
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
    if (normalizedPlayers.length) {
        throw new Error('[Game] savePlayers only supports clearing players; joins must use claim_game_player');
    }

    const { error: deleteError } = await supabase
        .from('game_players')
        .delete()
        .eq('game_id', gameId);

    if (deleteError) throw new Error(`[Game] savePlayers failed: ${deleteError.message}`);

    return [];
}

export async function getPlayerByController(gameId, controllerId) {
    if (!controllerId) return null;
    const { data, error } = await supabase.rpc('get_game_player_by_controller', {
        p_game_id: gameId,
        p_controller_id: controllerId,
    });

    if (error) throw new Error(`[Game] getPlayerByController failed: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    return row ? normalizePlayerRow(row) : null;
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
    const { data, error } = await supabase.rpc('adjust_game_player_score_by_id', {
        p_game_id: gameId,
        p_player_id: playerId,
        p_delta: normalizedDelta,
    });

    if (error) throw new Error(`[Game] adjustPlayerScore failed: ${error.message}`);
    return mapPlayerRpcResult(data);
}

export async function adjustPlayerScoreWithLog(gameId, playerId, delta, scoreLog = {}) {
    const normalizedDelta = Number(delta) || 0;
    const happenedAt = scoreLog?.happenedAt || new Date().toISOString();
    const kind = scoreLog?.kind || 'manual';
    const cellLabel = scoreLog?.cellLabel || '';
    const outcome = scoreLog?.outcome || null;
    const logId = scoreLog?.id || null;

    const { data, error } = await supabase.rpc('adjust_game_player_score_with_log', {
        p_game_id: gameId,
        p_player_id: playerId,
        p_delta: normalizedDelta,
        p_log_id: logId,
        p_cell_label: cellLabel,
        p_outcome: outcome,
        p_kind: kind,
        p_happened_at: happenedAt,
    });

    if (error) throw new Error(`[Game] adjustPlayerScoreWithLog failed: ${error.message}`);
    return mapAdjustWithLogResult(data);
}

export async function transferPlayerScoreWithLogs(gameId, {
    fromPlayerId,
    toPlayerId,
    amount,
    fromLog = {},
    toLog = {},
} = {}) {
    const transfer = Math.abs(Number(amount) || 0);
    if (!transfer) {
        throw new Error('[Game] transferPlayerScoreWithLogs failed: amount must be greater than 0');
    }

    const happenedAt = fromLog?.happenedAt || toLog?.happenedAt || new Date().toISOString();

    const { data, error } = await supabase.rpc('transfer_game_player_score_with_logs', {
        p_game_id: gameId,
        p_from_player_id: fromPlayerId,
        p_to_player_id: toPlayerId,
        p_amount: transfer,
        p_from_log_id: fromLog?.id || null,
        p_from_cell_label: fromLog?.cellLabel || '',
        p_from_outcome: fromLog?.outcome || null,
        p_from_kind: fromLog?.kind || 'cell_resolution',
        p_to_log_id: toLog?.id || null,
        p_to_cell_label: toLog?.cellLabel || '',
        p_to_outcome: toLog?.outcome || null,
        p_to_kind: toLog?.kind || 'cell_resolution',
        p_happened_at: happenedAt,
    });

    if (error) throw new Error(`[Game] transferPlayerScoreWithLogs failed: ${error.message}`);
    return mapTransferWithLogsResult(data);
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

export async function removePlayerByController(gameId, controllerId) {
    const { error } = await supabase.rpc('leave_game_player', {
        p_game_id: gameId,
        p_controller_id: controllerId,
    });

    if (error) throw new Error(`[Game] removePlayerByController failed: ${error.message}`);
    return true;
}
