import { describe, expect, it } from 'vitest';
import {
  CELL_MODIFIERS,
  getCellModifierBanner,
  getCellModifierOptions,
  isAutoCellModifier,
  isDirectedBetModifier,
  isFlipScoreModifier,
  isStealLeaderPointsModifier,
} from './cellModifiers.js';

describe('cell modifiers', () => {
  it('recognizes supported modifiers', () => {
    expect(isFlipScoreModifier(CELL_MODIFIERS.FLIP_SCORE)).toBe(true);
    expect(isStealLeaderPointsModifier(CELL_MODIFIERS.STEAL_LEADER_POINTS)).toBe(true);
    expect(isAutoCellModifier(CELL_MODIFIERS.FLIP_SCORE)).toBe(true);
    expect(isAutoCellModifier(CELL_MODIFIERS.STEAL_LEADER_POINTS)).toBe(true);
    expect(isDirectedBetModifier(CELL_MODIFIERS.DIRECTED_BET)).toBe(true);
    expect(isAutoCellModifier(CELL_MODIFIERS.DIRECTED_BET)).toBe(false);
    expect(isFlipScoreModifier('quiz-spinner')).toBe(false);
    expect(isFlipScoreModifier(null)).toBe(false);
    expect(isFlipScoreModifier(undefined)).toBe(false);
  });

  it('returns banner metadata for supported modifiers', () => {
    const translate = (key) => key;
    expect(getCellModifierBanner(CELL_MODIFIERS.FLIP_SCORE, translate)?.subtitle).toBe('flip_score_modifier');
    expect(getCellModifierBanner(CELL_MODIFIERS.STEAL_LEADER_POINTS, translate)?.subtitle).toBe('steal_leader_points_modifier');
  });

  it('returns reusable UI options including empty state', () => {
    const translate = (key) => key;
    expect(getCellModifierOptions(translate)).toEqual([
      { value: '', label: 'no_modifier' },
      { value: CELL_MODIFIERS.FLIP_SCORE, label: 'flip_score_modifier' },
      { value: CELL_MODIFIERS.STEAL_LEADER_POINTS, label: 'steal_leader_points_modifier' },
      { value: CELL_MODIFIERS.DIRECTED_BET, label: 'directed_bet_modifier' },
    ]);
  });

  it('keeps modifier constants immutable', () => {
    expect(Object.isFrozen(CELL_MODIFIERS)).toBe(true);
  });
});
