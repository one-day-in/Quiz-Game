export const CELL_MODIFIERS = Object.freeze({
  FLIP_SCORE: 'flip-score',
});

export function isFlipScoreModifier(modifier) {
  return modifier === CELL_MODIFIERS.FLIP_SCORE;
}

export function getCellModifierBanner(modifier, t) {
  if (isFlipScoreModifier(modifier)) {
    return {
      badge: '+ на -',
      title: t('cell_modifier_banner_title'),
      subtitle: t('flip_score_modifier'),
      detail: t('flip_score_auto_subtitle'),
    };
  }

  return null;
}
