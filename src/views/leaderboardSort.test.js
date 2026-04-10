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

  it('does not mutate the original players array', () => {
    const players = [
      { name: 'Beta', points: 100 },
      { name: 'Alpha', points: 200 },
    ];

    sortPlayersByScore(players);

    expect(players.map((player) => player.name)).toEqual(['Beta', 'Alpha']);
  });

  it('treats invalid scores as zero and handles non-array input', () => {
    const players = [
      { name: 'Valid', points: 10 },
      { name: 'Missing' },
      { name: 'Invalid', points: Number.NaN },
      { name: 'Negative', points: -5 },
    ];

    expect(sortPlayersByScore(null)).toEqual([]);
    expect(sortPlayersByScore(players).map((player) => player.name)).toEqual([
      'Valid',
      'Invalid',
      'Missing',
      'Negative',
    ]);
  });
});
