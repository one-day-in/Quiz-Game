import { describe, expect, it } from 'vitest';
import { getPlayerPressWinnerToneKey, shouldPlayPlayerPressWinnerTone } from './playerPressAudio.js';

describe('shouldPlayPlayerPressWinnerTone', () => {
  it('plays only when runtime moves from another state to the local winner', () => {
    expect(shouldPlayPlayerPressWinnerTone({
      hasInitializedRuntime: true,
      previousWinnerPlayerId: null,
      nextWinnerPlayerId: 'player-1',
      localPlayerId: 'player-1',
    })).toBe(true);
  });

  it('does not play on the initial runtime snapshot', () => {
    expect(shouldPlayPlayerPressWinnerTone({
      hasInitializedRuntime: false,
      previousWinnerPlayerId: null,
      nextWinnerPlayerId: 'player-1',
      localPlayerId: 'player-1',
    })).toBe(false);
  });

  it('does not play for other players', () => {
    expect(shouldPlayPlayerPressWinnerTone({
      hasInitializedRuntime: true,
      previousWinnerPlayerId: null,
      nextWinnerPlayerId: 'player-2',
      localPlayerId: 'player-1',
    })).toBe(false);
  });

  it('does not replay repeatedly for duplicate winner snapshots', () => {
    expect(shouldPlayPlayerPressWinnerTone({
      hasInitializedRuntime: true,
      previousWinnerPlayerId: 'player-1',
      nextWinnerPlayerId: 'player-1',
      localPlayerId: 'player-1',
    })).toBe(false);
  });
});

describe('getPlayerPressWinnerToneKey', () => {
  it('uses the local winner and pressed timestamp as a dedupe key', () => {
    expect(getPlayerPressWinnerToneKey({
      winnerPlayerId: 'player-1',
      pressedAt: '2026-04-06T13:45:00.000Z',
    }, 'player-1')).toBe('player-1:2026-04-06T13:45:00.000Z');
  });

  it('returns null for non-winning local players', () => {
    expect(getPlayerPressWinnerToneKey({
      winnerPlayerId: 'player-2',
      pressedAt: '2026-04-06T13:45:00.000Z',
    }, 'player-1')).toBe(null);
  });
});
