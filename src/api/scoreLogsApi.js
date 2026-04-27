import { supabase } from './supabaseClient.js';

const SCORE_LOG_COLUMNS = 'id, game_id, player_id, player_name, cell_label, outcome, delta, kind, happened_at, created_at';

function mapScoreLogRow(row) {
  return {
    id: row?.id || null,
    gameId: row?.game_id || null,
    playerId: row?.player_id || null,
    playerName: row?.player_name || '',
    cellLabel: row?.cell_label || '',
    outcome: row?.outcome || null,
    delta: Number(row?.delta) || 0,
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
  const payload = {
    id: entry?.id || null,
    game_id: gameId,
    player_id: entry?.playerId || null,
    player_name: entry?.playerName || 'Player',
    cell_label: entry?.cellLabel || '',
    outcome: entry?.outcome || null,
    delta: Number(entry?.delta) || 0,
    kind: entry?.kind || 'manual',
    happened_at: entry?.happenedAt || new Date().toISOString(),
  };

  if (!payload.id) delete payload.id;

  const { data, error } = await supabase
    .from('score_logs')
    .insert(payload)
    .select(SCORE_LOG_COLUMNS)
    .single();

  if (error) throw new Error(`[Game] insertScoreLog failed: ${error.message}`);
  return mapScoreLogRow(data);
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
