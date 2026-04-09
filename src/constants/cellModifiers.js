export const CELL_MODIFIERS = Object.freeze({
  FLIP_SCORE: 'flip-score',
});

export function isFlipScoreModifier(modifier) {
  return modifier === CELL_MODIFIERS.FLIP_SCORE;
}
