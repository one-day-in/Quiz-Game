import { beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock('./supabaseClient.js', () => ({
  supabase: {
    rpc: rpcMock,
  },
}));

describe('playersApi.getPlayerByController', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses the capability-checking RPC and never reads controller credentials directly', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{
        id: 'player-1',
        game_id: 'game-1',
        name: 'Maria',
        points: 300,
        joined_at: '2026-05-03T00:00:00.000Z',
      }],
      error: null,
    });
    const { getPlayerByController } = await import('./playersApi.js');

    const result = await getPlayerByController('game-1', 'controller-secret');

    expect(rpcMock).toHaveBeenCalledWith('get_game_player_by_controller', {
      p_game_id: 'game-1',
      p_controller_id: 'controller-secret',
    });
    expect(result).toMatchObject({ id: 'player-1', name: 'Maria', points: 300 });
    expect(result.controllerId).toBeNull();
  });
});

describe('playersApi.adjustPlayerScore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses adjust_game_player_score_by_id when RPC is available', async () => {
    const { adjustPlayerScore } = await import('./playersApi.js');
    rpcMock.mockResolvedValueOnce({
      data: [{
        id: 'player-1',
        game_id: 'game-1',
        name: 'Maria',
        points: 300,
        joined_at: '2026-05-03T00:00:00.000Z',
      }],
      error: null,
    });

    const result = await adjustPlayerScore('game-1', 'player-1', 100);

    expect(rpcMock).toHaveBeenCalledWith('adjust_game_player_score_by_id', {
      p_game_id: 'game-1',
      p_player_id: 'player-1',
      p_delta: 100,
    });
    expect(result).toMatchObject({ id: 'player-1', points: 300 });
  });

});

describe('playersApi.adjustPlayerScoreWithLog', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses adjust_game_player_score_with_log when RPC is available', async () => {
    const { adjustPlayerScoreWithLog } = await import('./playersApi.js');
    rpcMock.mockResolvedValueOnce({
      data: [{
        player_id: 'player-1',
        player_game_id: 'game-1',
        player_name: 'Maria',
        player_points: 300,
        player_joined_at: '2026-05-03T00:00:00.000Z',
        log_id: 'log-1',
        log_game_id: 'game-1',
        log_player_id: 'player-1',
        log_player_name: 'Maria',
        log_cell_label: 'History / +100',
        log_outcome: 'correct',
        log_delta: 100,
        log_score_before: 200,
        log_score_after: 300,
        log_kind: 'cell_resolution',
        log_happened_at: '2026-05-03T00:00:01.000Z',
        log_created_at: '2026-05-03T00:00:01.000Z',
      }],
      error: null,
    });

    const result = await adjustPlayerScoreWithLog('game-1', 'player-1', 100, {
      cellLabel: 'History / +100',
      outcome: 'correct',
      kind: 'cell_resolution',
      happenedAt: '2026-05-03T00:00:01.000Z',
    });

    expect(rpcMock).toHaveBeenCalledWith('adjust_game_player_score_with_log', {
      p_game_id: 'game-1',
      p_player_id: 'player-1',
      p_delta: 100,
      p_log_id: null,
      p_cell_label: 'History / +100',
      p_outcome: 'correct',
      p_kind: 'cell_resolution',
      p_happened_at: '2026-05-03T00:00:01.000Z',
    });
    expect(result.player).toMatchObject({ id: 'player-1', points: 300 });
    expect(result.scoreLog).toMatchObject({
      id: 'log-1',
      playerId: 'player-1',
      scoreBefore: 200,
      scoreAfter: 300,
      delta: 100,
    });
  });

});

describe('playersApi.transferPlayerScoreWithLogs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('uses transfer_game_player_score_with_logs when RPC is available', async () => {
    const { transferPlayerScoreWithLogs } = await import('./playersApi.js');
    rpcMock.mockResolvedValueOnce({
      data: [{
        from_player_id: 'player-1',
        from_player_game_id: 'game-1',
        from_player_name: 'Maria',
        from_player_points: 200,
        from_player_joined_at: '2026-05-03T00:00:00.000Z',
        to_player_id: 'player-2',
        to_player_game_id: 'game-1',
        to_player_name: 'Ivan',
        to_player_points: 700,
        to_player_joined_at: '2026-05-03T00:00:00.000Z',
        from_log_id: 'log-a',
        from_log_game_id: 'game-1',
        from_log_player_id: 'player-1',
        from_log_player_name: 'Maria',
        from_log_cell_label: 'Math / -1000',
        from_log_outcome: 'modifier_steal_give',
        from_log_delta: -1000,
        from_log_score_before: 1200,
        from_log_score_after: 200,
        from_log_kind: 'cell_resolution',
        from_log_happened_at: '2026-05-03T00:00:03.000Z',
        from_log_created_at: '2026-05-03T00:00:03.000Z',
        to_log_id: 'log-b',
        to_log_game_id: 'game-1',
        to_log_player_id: 'player-2',
        to_log_player_name: 'Ivan',
        to_log_cell_label: 'Math / +1000',
        to_log_outcome: 'modifier_steal_receive',
        to_log_delta: 1000,
        to_log_score_before: -300,
        to_log_score_after: 700,
        to_log_kind: 'cell_resolution',
        to_log_happened_at: '2026-05-03T00:00:03.000Z',
        to_log_created_at: '2026-05-03T00:00:03.000Z',
      }],
      error: null,
    });

    const result = await transferPlayerScoreWithLogs('game-1', {
      fromPlayerId: 'player-1',
      toPlayerId: 'player-2',
      amount: 1000,
      fromLog: { cellLabel: 'Math / -1000', outcome: 'modifier_steal_give', kind: 'cell_resolution' },
      toLog: { cellLabel: 'Math / +1000', outcome: 'modifier_steal_receive', kind: 'cell_resolution' },
      happenedAt: '2026-05-03T00:00:03.000Z',
    });

    expect(rpcMock).toHaveBeenCalledWith('transfer_game_player_score_with_logs', expect.objectContaining({
      p_game_id: 'game-1',
      p_from_player_id: 'player-1',
      p_to_player_id: 'player-2',
      p_amount: 1000,
    }));
    expect(result.fromPlayer).toMatchObject({ id: 'player-1', points: 200 });
    expect(result.toPlayer).toMatchObject({ id: 'player-2', points: 700 });
    expect(result.fromScoreLog).toMatchObject({ id: 'log-a', delta: -1000 });
    expect(result.toScoreLog).toMatchObject({ id: 'log-b', delta: 1000 });
  });
});
