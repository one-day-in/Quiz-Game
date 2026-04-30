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

function normalizeType(type) {
  const value = String(type || MODIFIER_TYPES.NONE).trim().toLowerCase();
  return ACTIVE_MODIFIER_TYPES.has(value) ? value : MODIFIER_TYPES.NONE;
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

export { MODIFIER_TYPES };
