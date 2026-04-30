import { describe, expect, it } from 'vitest';
import { MODIFIER_TYPES, normalizeCellModifier } from './modifierEngine.js';

describe('modifierEngine aliases', () => {
  it('normalizes legacy dashed modifier types', () => {
    expect(normalizeCellModifier({ type: 'flip-score' }).type).toBe(MODIFIER_TYPES.FLIP_SCORE);
    expect(normalizeCellModifier({ type: 'steal-leader-points' }).type).toBe(MODIFIER_TYPES.STEAL_LEADER_POINTS);
    expect(normalizeCellModifier({ type: 'directed-bet' }).type).toBe(MODIFIER_TYPES.DIRECTED_BET);
  });

  it('falls back to none for unknown types', () => {
    expect(normalizeCellModifier({ type: 'unknown-modifier' }).type).toBe(MODIFIER_TYPES.NONE);
  });
});
