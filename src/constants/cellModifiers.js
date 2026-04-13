export const CELL_MODIFIERS = Object.freeze({
  FLIP_SCORE: 'flip-score',
  STEAL_LEADER_POINTS: 'steal-leader-points',
});

const MODIFIER_DEFINITIONS = Object.freeze({
  [CELL_MODIFIERS.FLIP_SCORE]: Object.freeze({
    badge: '+ на -',
    labelKey: 'flip_score_modifier',
    detailKey: 'flip_score_auto_subtitle',
  }),
  [CELL_MODIFIERS.STEAL_LEADER_POINTS]: Object.freeze({
    badge: '1000',
    labelKey: 'steal_leader_points_modifier',
    detailKey: 'steal_leader_points_auto_subtitle',
  }),
});

export function isKnownCellModifier(modifier) {
  return typeof modifier === 'string' && Object.prototype.hasOwnProperty.call(MODIFIER_DEFINITIONS, modifier);
}

export function isAutoCellModifier(modifier) {
  return isKnownCellModifier(modifier);
}

export function isFlipScoreModifier(modifier) {
  return modifier === CELL_MODIFIERS.FLIP_SCORE;
}

export function isStealLeaderPointsModifier(modifier) {
  return modifier === CELL_MODIFIERS.STEAL_LEADER_POINTS;
}

export function getCellModifierOptions(t) {
  return [
    { value: '', label: t('no_modifier') },
    {
      value: CELL_MODIFIERS.FLIP_SCORE,
      label: t('flip_score_modifier'),
    },
    {
      value: CELL_MODIFIERS.STEAL_LEADER_POINTS,
      label: t('steal_leader_points_modifier'),
    },
  ];
}

export function getCellModifierBanner(modifier, t) {
  const definition = MODIFIER_DEFINITIONS[modifier];
  if (!definition) return null;

  return {
    badge: definition.badge,
    title: t('cell_modifier_banner_title'),
    subtitle: t(definition.labelKey),
    detail: t(definition.detailKey),
  };
}
