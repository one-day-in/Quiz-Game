import { describe, expect, it } from 'vitest';
import { shouldPlayPlayerPressWinnerTone } from './playerPressAudio.js';

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
