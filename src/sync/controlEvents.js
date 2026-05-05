export const CONTROL_EVENTS = Object.freeze({
  OPEN_CELL: 'open_cell',
  CLOSE_MODAL: 'close_modal',
  MODAL_VIEW_STATE: 'modal_view_state',
  MODAL_MEDIA_STATE: 'modal_media_state',
  MODAL_DIRECTED_BET_STATE: 'modal_directed_bet_state',
  MODAL_PRESS_STATE: 'modal_press_state',
  MODAL_SYNC_REQUEST: 'modal_sync_request',
  MODAL_TOGGLE_ANSWER: 'modal_toggle_answer',
  MODAL_MEDIA_CONTROL: 'modal_media_control',
  MODAL_DIRECTED_BET_ACTION: 'modal_directed_bet_action',
  MODAL_CORRECT: 'modal_correct',
  MODAL_INCORRECT: 'modal_incorrect',
  HOST_RUNTIME_STATE: 'host_runtime_state',
  HOST_RUNTIME_STATE_REQUEST: 'host_runtime_state_request',
  CONTROLLER_RUNTIME_STATE: 'controller_runtime_state',
  CONTROLLER_RUNTIME_STATE_REQUEST: 'controller_runtime_state_request',
  GAME_SNAPSHOT: 'game_snapshot',
  GAME_SNAPSHOT_REQUEST: 'game_snapshot_request',
  PLAYERS_SNAPSHOT: 'players_snapshot',
  PLAYERS_SNAPSHOT_REQUEST: 'players_snapshot_request',
  ROUND_STATE: 'round_state',
  ROUND_SET: 'round_set',
  ROUND_SYNC_REQUEST: 'round_sync_request',
  CURRENT_PLAYER_SET: 'current_player_set',
  CURRENT_PLAYER_STATE: 'current_player_state',
  CURRENT_PLAYER_SYNC_REQUEST: 'current_player_sync_request',
  GAME_MODE_SET: 'game_mode_set',
  GAME_MODE_STATE: 'game_mode_state',
  GAME_MODE_SYNC_REQUEST: 'game_mode_sync_request',
  LEADERBOARD_PANEL_STATE: 'leaderboard_panel_state',
  LEADERBOARD_PANEL_SYNC_REQUEST: 'leaderboard_panel_sync_request',
  LEADERBOARD_ADJUST_SCORE: 'leaderboard_adjust_score',
  SCORE_LOG_APPEND: 'score_log_append',
  SCORE_LOG_SNAPSHOT: 'score_log_snapshot',
  SCORE_LOG_SYNC_REQUEST: 'score_log_sync_request',
  SCORE_LOGS_STATE: 'score_logs_state',
  SCORE_LOGS_SYNC_REQUEST: 'score_logs_sync_request',
  SCORE_LOGS_CLEAR_REQUEST: 'score_logs_clear_request',
  PRESS_CONFIRMED: 'press_confirmed',
});

const CONTROL_EVENT_TYPE_SET = new Set(Object.values(CONTROL_EVENTS));

const CRITICAL_CONTROL_EVENTS = new Set([
  CONTROL_EVENTS.OPEN_CELL,
  CONTROL_EVENTS.CLOSE_MODAL,
  CONTROL_EVENTS.MODAL_VIEW_STATE,
  CONTROL_EVENTS.MODAL_DIRECTED_BET_STATE,
  CONTROL_EVENTS.MODAL_PRESS_STATE,
  CONTROL_EVENTS.PRESS_CONFIRMED,
]);

export function isControlEventType(type) {
  return CONTROL_EVENT_TYPE_SET.has(type);
}

export function isCriticalControlEventType(type) {
  return CRITICAL_CONTROL_EVENTS.has(type);
}

export function parseControlMessage(rawMessage) {
  const message = rawMessage && typeof rawMessage === 'object' ? rawMessage : null;
  const type = String(message?.type || '').trim();
  if (!isControlEventType(type)) return null;
  const payload = message?.payload && typeof message.payload === 'object' ? message.payload : {};
  return {
    type,
    payload,
    senderRole: String(message?.senderRole || '').trim(),
    senderId: String(message?.senderId || '').trim(),
    sentAt: String(message?.sentAt || '').trim(),
  };
}
