const MODIFIER_TYPES = Object.freeze({
  NONE: 'none',
  FLIP_SCORE: 'flip_score',
  STEAL_LEADER_POINTS: 'steal_leader_points',
  DIRECTED_BET: 'directed_bet',
});

const ACTIVE_MODIFIER_TYPES = new Set([
  MODIFIER_TYPES.FLIP_SCORE,
  MODIFIER_TYPES.STEAL_LEADER_POINTS,
  MODIFIER_TYPES.DIRECTED_BET,
]);

const SUPPORTED_MODIFIER_TYPES = Object.freeze([
  MODIFIER_TYPES.FLIP_SCORE,
  MODIFIER_TYPES.STEAL_LEADER_POINTS,
  MODIFIER_TYPES.DIRECTED_BET,
]);

const MODIFIER_ALIASES = Object.freeze({
  'flip-score': MODIFIER_TYPES.FLIP_SCORE,
  'steal-leader-points': MODIFIER_TYPES.STEAL_LEADER_POINTS,
  'directed-bet': MODIFIER_TYPES.DIRECTED_BET,
});

const DIRECTED_BET_STAKE_CONFIG = Object.freeze({
  min: 100,
  max: 500,
  step: 100,
  responseSeconds: 40,
});

const AUTO_APPLY_MODIFIER_TYPES = new Set([
  MODIFIER_TYPES.FLIP_SCORE,
  MODIFIER_TYPES.STEAL_LEADER_POINTS,
]);

const INTERACTIVE_MODIFIER_TYPES = new Set([
  MODIFIER_TYPES.DIRECTED_BET,
]);

const MODIFIER_LABEL_KEYS = Object.freeze({
  [MODIFIER_TYPES.FLIP_SCORE]: 'flip_score_modifier',
  [MODIFIER_TYPES.STEAL_LEADER_POINTS]: 'steal_leader_points_modifier',
  [MODIFIER_TYPES.DIRECTED_BET]: 'directed_bet_modifier',
});

function normalizeType(type) {
  const value = String(type || MODIFIER_TYPES.NONE).trim().toLowerCase();
  const alias = MODIFIER_ALIASES[value] || value;
  return ACTIVE_MODIFIER_TYPES.has(alias) ? alias : MODIFIER_TYPES.NONE;
}

function normalizeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return {};
  return { ...config };
}

export function createCellModifier(type = MODIFIER_TYPES.NONE, config = {}, state = {}) {
  return {
    type: normalizeType(type),
    config: normalizeConfig(config),
    state: state && typeof state === 'object' && !Array.isArray(state) ? { ...state } : {},
  };
}

export function normalizeCellModifier(rawModifier) {
  if (!rawModifier || typeof rawModifier !== 'object') {
    return createCellModifier();
  }
  return createCellModifier(rawModifier.type, rawModifier.config, rawModifier.state);
}

export function hasActiveModifier(rawModifier) {
  return normalizeCellModifier(rawModifier).type !== MODIFIER_TYPES.NONE;
}

export function isAutoApplyModifierType(rawType) {
  return AUTO_APPLY_MODIFIER_TYPES.has(normalizeType(rawType));
}

export function isInteractiveModifierType(rawType) {
  return INTERACTIVE_MODIFIER_TYPES.has(normalizeType(rawType));
}

export function getModifierLabelKey(rawType) {
  const normalized = normalizeType(rawType);
  return MODIFIER_LABEL_KEYS[normalized] || null;
}

export function getDirectedBetStakeValues() {
  const values = [];
  for (let stake = DIRECTED_BET_STAKE_CONFIG.min; stake <= DIRECTED_BET_STAKE_CONFIG.max; stake += DIRECTED_BET_STAKE_CONFIG.step) {
    values.push(stake);
  }
  return values;
}

export function getModifierPresentation(rawModifier, context = {}) {
  const modifier = normalizeCellModifier(rawModifier);
  const players = Array.isArray(context?.players) ? context.players : [];
  const activePlayers = players.filter((player) => player && String(player.id || '').trim() !== '');

  const common = {
    modifier,
    type: modifier.type,
    hasPlayers: activePlayers.length > 0,
    isConfigured: modifier.type !== MODIFIER_TYPES.NONE,
  };

  if (modifier.type === MODIFIER_TYPES.DIRECTED_BET) {
    return {
      ...common,
      previewState: activePlayers.length > 0 ? 'ready' : 'empty_players',
      emptyReason: activePlayers.length > 0 ? null : 'no_active_players',
    };
  }

  if (modifier.type === MODIFIER_TYPES.FLIP_SCORE || modifier.type === MODIFIER_TYPES.STEAL_LEADER_POINTS) {
    return {
      ...common,
      previewState: 'ready',
      emptyReason: null,
    };
  }

  return {
    ...common,
    previewState: 'none',
    emptyReason: null,
  };
}

export { MODIFIER_TYPES, SUPPORTED_MODIFIER_TYPES, DIRECTED_BET_STAKE_CONFIG };
