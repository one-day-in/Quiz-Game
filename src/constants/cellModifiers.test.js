import { describe, expect, it } from 'vitest';
import { CELL_MODIFIERS, isFlipScoreModifier } from './cellModifiers.js';

describe('cell modifiers', () => {
  it('recognizes only the flip-score modifier', () => {
    expect(isFlipScoreModifier(CELL_MODIFIERS.FLIP_SCORE)).toBe(true);
    expect(isFlipScoreModifier('quiz-spinner')).toBe(false);
    expect(isFlipScoreModifier(null)).toBe(false);
    expect(isFlipScoreModifier(undefined)).toBe(false);
  });

  it('keeps modifier constants immutable', () => {
    expect(Object.isFrozen(CELL_MODIFIERS)).toBe(true);
  });
});
