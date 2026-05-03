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
import { mapScoreLogRow } from './scoreLogsApi.js';

export { MAX_PLAYERS };

const MISSING_RPC_CODE = 'PGRST202';
let adjustByIdRpcMissing = false;
let adjustWithLogRpcMissing = false;
let transferWithLogsRpcMissing = false;

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

export async function adjustPlayerScoreWithLog(gameId, playerId, delta, scoreLog = {}) {
    const normalizedDelta = Number(delta) || 0;
    const happenedAt = scoreLog?.happenedAt || new Date().toISOString();
    const kind = scoreLog?.kind || 'manual';
    const cellLabel = scoreLog?.cellLabel || '';
    const outcome = scoreLog?.outcome || null;
    const logId = scoreLog?.id || null;

    if (!adjustWithLogRpcMissing) {
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

        if (!error) return mapAdjustWithLogResult(data);
        if (!isMissingRpcError(error, 'adjust_game_player_score_with_log')) {
            throw new Error(`[Game] adjustPlayerScoreWithLog failed: ${error.message}`);
        }
        adjustWithLogRpcMissing = true;
        console.warn('[Game] adjust_game_player_score_with_log RPC is unavailable, using legacy fallback.');
    }

    const updatedPlayer = await adjustPlayerScore(gameId, playerId, normalizedDelta);
    const scoreAfter = Number(updatedPlayer?.points);
    const safeScoreAfter = Number.isFinite(scoreAfter) ? scoreAfter : null;
    const scoreBefore = safeScoreAfter === null ? null : safeScoreAfter - normalizedDelta;
    const fallbackPlayerName = String(scoreLog?.playerName || updatedPlayer?.name || 'Player');

    const { data: logData, error: logError } = await supabase.rpc('append_score_log', {
        p_id: logId,
        p_game_id: gameId,
        p_player_id: playerId,
        p_player_name: fallbackPlayerName,
        p_cell_label: cellLabel,
        p_outcome: outcome,
        p_delta: normalizedDelta,
        p_score_before: scoreBefore,
        p_score_after: safeScoreAfter,
        p_kind: kind,
        p_happened_at: happenedAt,
    });

    if (logError) {
        throw new Error(`[Game] adjustPlayerScoreWithLog failed: ${logError.message}`);
    }

    const logRow = Array.isArray(logData) ? logData[0] : logData;
    const normalizedLog = mapScoreLogRow(logRow || {
        id: logId,
        game_id: gameId,
        player_id: playerId,
        player_name: fallbackPlayerName,
        cell_label: cellLabel,
        outcome,
        delta: normalizedDelta,
        score_before: scoreBefore,
        score_after: safeScoreAfter,
        kind,
        happened_at: happenedAt,
    });

    return {
        player: updatedPlayer,
        scoreLog: normalizedLog,
    };
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

    if (!transferWithLogsRpcMissing) {
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

        if (!error) return mapTransferWithLogsResult(data);
        if (!isMissingRpcError(error, 'transfer_game_player_score_with_logs')) {
            throw new Error(`[Game] transferPlayerScoreWithLogs failed: ${error.message}`);
        }
        transferWithLogsRpcMissing = true;
        console.warn('[Game] transfer_game_player_score_with_logs RPC is unavailable, using legacy fallback.');
    }

    const fromDelta = -transfer;
    const toDelta = transfer;
    const updatedFrom = await adjustPlayerScore(gameId, fromPlayerId, fromDelta);
    let updatedTo = null;

    try {
        updatedTo = await adjustPlayerScore(gameId, toPlayerId, toDelta);
    } catch (error) {
        try {
            await adjustPlayerScore(gameId, fromPlayerId, transfer);
        } catch (rollbackError) {
            console.error('[Game] transfer fallback rollback failed:', rollbackError);
        }
        throw error;
    }

    const fromScoreAfter = Number(updatedFrom?.points);
    const toScoreAfter = Number(updatedTo?.points);
    const safeFromScoreAfter = Number.isFinite(fromScoreAfter) ? fromScoreAfter : null;
    const safeToScoreAfter = Number.isFinite(toScoreAfter) ? toScoreAfter : null;
    const fromScoreBefore = safeFromScoreAfter === null ? null : safeFromScoreAfter - fromDelta;
    const toScoreBefore = safeToScoreAfter === null ? null : safeToScoreAfter - toDelta;

    const { data: fromLogData, error: fromLogError } = await supabase.rpc('append_score_log', {
        p_id: fromLog?.id || null,
        p_game_id: gameId,
        p_player_id: fromPlayerId,
        p_player_name: String(fromLog?.playerName || updatedFrom?.name || 'Player'),
        p_cell_label: fromLog?.cellLabel || '',
        p_outcome: fromLog?.outcome || null,
        p_delta: fromDelta,
        p_score_before: fromScoreBefore,
        p_score_after: safeFromScoreAfter,
        p_kind: fromLog?.kind || 'cell_resolution',
        p_happened_at: happenedAt,
    });
    if (fromLogError) throw new Error(`[Game] transferPlayerScoreWithLogs failed: ${fromLogError.message}`);

    const { data: toLogData, error: toLogError } = await supabase.rpc('append_score_log', {
        p_id: toLog?.id || null,
        p_game_id: gameId,
        p_player_id: toPlayerId,
        p_player_name: String(toLog?.playerName || updatedTo?.name || 'Player'),
        p_cell_label: toLog?.cellLabel || '',
        p_outcome: toLog?.outcome || null,
        p_delta: toDelta,
        p_score_before: toScoreBefore,
        p_score_after: safeToScoreAfter,
        p_kind: toLog?.kind || 'cell_resolution',
        p_happened_at: happenedAt,
    });
    if (toLogError) throw new Error(`[Game] transferPlayerScoreWithLogs failed: ${toLogError.message}`);

    return {
        fromPlayer: updatedFrom,
        toPlayer: updatedTo,
        fromScoreLog: mapScoreLogRow(Array.isArray(fromLogData) ? fromLogData[0] : fromLogData),
        toScoreLog: mapScoreLogRow(Array.isArray(toLogData) ? toLogData[0] : toLogData),
    };
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
