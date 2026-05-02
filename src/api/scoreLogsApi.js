import { supabase } from './supabaseClient.js';

const SCORE_LOG_COLUMNS = 'id, game_id, player_id, player_name, cell_label, outcome, delta, score_before, score_after, kind, happened_at, created_at';

function mapScoreLogRow(row) {
  return {
    id: row?.id || null,
    gameId: row?.game_id || null,
    playerId: row?.player_id || null,
    playerName: row?.player_name || '',
    cellLabel: row?.cell_label || '',
    outcome: row?.outcome || null,
    delta: Number(row?.delta) || 0,
    scoreBefore: Number.isFinite(Number(row?.score_before)) ? Number(row.score_before) : null,
    scoreAfter: Number.isFinite(Number(row?.score_after)) ? Number(row.score_after) : null,
    kind: row?.kind || 'manual',
    happenedAt: row?.happened_at || row?.created_at || new Date().toISOString(),
  };
}

export async function listScoreLogs(gameId, { limit = 5000 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 0, 1), 10000);
  const { data, error } = await supabase
    .from('score_logs')
    .select(SCORE_LOG_COLUMNS)
    .eq('game_id', gameId)
    .order('happened_at', { ascending: false })
    .limit(safeLimit);

  if (error) throw new Error(`[Game] listScoreLogs failed: ${error.message}`);
  return Array.isArray(data) ? data.map(mapScoreLogRow) : [];
}

export async function insertScoreLog(gameId, entry = {}) {
  const { data, error } = await supabase.rpc('append_score_log', {
    p_id: entry?.id || null,
    p_game_id: gameId,
    p_player_id: entry?.playerId || null,
    p_player_name: entry?.playerName || 'Player',
    p_cell_label: entry?.cellLabel || '',
    p_outcome: entry?.outcome || null,
    p_delta: Number(entry?.delta) || 0,
    p_score_before: Number.isFinite(Number(entry?.scoreBefore)) ? Number(entry.scoreBefore) : null,
    p_score_after: Number.isFinite(Number(entry?.scoreAfter)) ? Number(entry.scoreAfter) : null,
    p_kind: entry?.kind || 'manual',
    p_happened_at: entry?.happenedAt || new Date().toISOString(),
  });

  if (error) throw new Error(`[Game] insertScoreLog failed: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return mapScoreLogRow(row || {});
}

export async function clearScoreLogs(gameId) {
  const { error } = await supabase.rpc('clear_score_logs', {
    p_game_id: gameId,
  });
  if (!error) return;

  const message = String(error?.message || '');
  const rpcMissing =
    error?.code === 'PGRST202'
    || message.includes('Could not find the function')
    || message.includes('clear_score_logs');

  if (!rpcMissing) {
    throw new Error(`[Game] clearScoreLogs failed: ${message}`);
  }

  const { error: fallbackError } = await supabase
    .from('score_logs')
    .delete()
    .eq('game_id', gameId);

  if (fallbackError) {
    throw new Error(`[Game] clearScoreLogs fallback failed: ${fallbackError.message}`);
  }
}

export function subscribeToScoreLogs(gameId, onInsert) {
  const channel = supabase
    .channel(`score-logs:${gameId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'score_logs',
        filter: `game_id=eq.${gameId}`,
      },
      (payload) => {
        onInsert?.(mapScoreLogRow(payload?.new || {}));
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
