import { describe, expect, it } from 'vitest';
import { sortPlayersByScore } from './leaderboardSort.js';

describe('sortPlayersByScore', () => {
  it('sorts players by score descending', () => {
    const players = [
      { name: 'Beta', points: 200 },
      { name: 'Alpha', points: 500 },
      { name: 'Gamma', points: 100 },
    ];

    expect(sortPlayersByScore(players).map((player) => player.name)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
  });

  it('uses name as a tie breaker', () => {
    const players = [
      { name: 'Charlie', points: 300 },
      { name: 'Alpha', points: 300 },
      { name: 'Bravo', points: 300 },
    ];

    expect(sortPlayersByScore(players).map((player) => player.name)).toEqual([
      'Alpha',
      'Bravo',
      'Charlie',
    ]);
  });
});
