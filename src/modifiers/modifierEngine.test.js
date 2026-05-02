import { describe, expect, it } from 'vitest';
import {
  DIRECTED_BET_STAKE_CONFIG,
  MODIFIER_TYPES,
  normalizeCellModifier,
  getDirectedBetStakeValues,
  isAutoApplyModifierType,
  isInteractiveModifierType,
  getModifierLabelKey,
} from './modifierEngine.js';

describe('modifierEngine aliases', () => {
  it('normalizes legacy dashed modifier types', () => {
    expect(normalizeCellModifier({ type: 'flip-score' }).type).toBe(MODIFIER_TYPES.FLIP_SCORE);
    expect(normalizeCellModifier({ type: 'steal-leader-points' }).type).toBe(MODIFIER_TYPES.STEAL_LEADER_POINTS);
    expect(normalizeCellModifier({ type: 'directed-bet' }).type).toBe(MODIFIER_TYPES.DIRECTED_BET);
  });

  it('falls back to none for unknown types', () => {
    expect(normalizeCellModifier({ type: 'unknown-modifier' }).type).toBe(MODIFIER_TYPES.NONE);
  });

  it('exposes modifier behavior groups', () => {
    expect(isAutoApplyModifierType(MODIFIER_TYPES.FLIP_SCORE)).toBe(true);
    expect(isAutoApplyModifierType(MODIFIER_TYPES.STEAL_LEADER_POINTS)).toBe(true);
    expect(isAutoApplyModifierType(MODIFIER_TYPES.DIRECTED_BET)).toBe(false);

    expect(isInteractiveModifierType(MODIFIER_TYPES.DIRECTED_BET)).toBe(true);
    expect(isInteractiveModifierType(MODIFIER_TYPES.FLIP_SCORE)).toBe(false);
  });

  it('returns translation keys for known modifier labels', () => {
    expect(getModifierLabelKey(MODIFIER_TYPES.FLIP_SCORE)).toBe('flip_score_modifier');
    expect(getModifierLabelKey(MODIFIER_TYPES.STEAL_LEADER_POINTS)).toBe('steal_leader_points_modifier');
    expect(getModifierLabelKey(MODIFIER_TYPES.DIRECTED_BET)).toBe('directed_bet_modifier');
    expect(getModifierLabelKey('unknown')).toBe(null);
  });

  it('builds directed bet stakes from shared config', () => {
    expect(getDirectedBetStakeValues()).toEqual([100, 200, 300, 400, 500]);
    expect(DIRECTED_BET_STAKE_CONFIG.min).toBe(100);
    expect(DIRECTED_BET_STAKE_CONFIG.max).toBe(500);
    expect(DIRECTED_BET_STAKE_CONFIG.step).toBe(100);
  });
});
