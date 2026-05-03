import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  rpcMock,
  fromMock,
  selectMock,
  eqMock,
  maybeSingleMock,
} = vi.hoisted(() => {
  const rpc = vi.fn();
  const maybeSingle = vi.fn();
  const eq = vi.fn(() => ({ eq, maybeSingle }));
  const select = vi.fn(() => ({ eq, maybeSingle }));
  const from = vi.fn(() => ({ select }));
  return {
    rpcMock: rpc,
    fromMock: from,
    selectMock: select,
    eqMock: eq,
    maybeSingleMock: maybeSingle,
  };
});

vi.mock('./supabaseClient.js', () => ({
  supabase: {
    rpc: rpcMock,
    from: fromMock,
  },
}));

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

  it('falls back to adjust_game_player_score when by-id RPC is missing', async () => {
    const { adjustPlayerScore } = await import('./playersApi.js');
    rpcMock
      .mockResolvedValueOnce({
        data: null,
        error: {
          code: 'PGRST202',
          message: 'Could not find the function public.adjust_game_player_score_by_id(p_game_id, p_player_id, p_delta) in the schema cache',
        },
      })
      .mockResolvedValueOnce({
        data: [{
          id: 'player-1',
          game_id: 'game-1',
          name: 'Maria',
          points: 450,
          joined_at: '2026-05-03T00:00:00.000Z',
        }],
        error: null,
      });
    maybeSingleMock.mockResolvedValueOnce({
      data: { controller_id: 'ctrl-1' },
      error: null,
    });

    const result = await adjustPlayerScore('game-1', 'player-1', 150);

    expect(fromMock).toHaveBeenCalledWith('game_players');
    expect(selectMock).toHaveBeenCalledWith('controller_id');
    expect(eqMock).toHaveBeenNthCalledWith(1, 'game_id', 'game-1');
    expect(eqMock).toHaveBeenNthCalledWith(2, 'id', 'player-1');
    expect(rpcMock).toHaveBeenNthCalledWith(2, 'adjust_game_player_score', {
      p_game_id: 'game-1',
      p_controller_id: 'ctrl-1',
      p_delta: 150,
    });
    expect(result).toMatchObject({ id: 'player-1', points: 450 });
  });
});
