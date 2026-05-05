import { describe, expect, it } from 'vitest';

import {
  CONTROL_EVENTS,
  isControlEventType,
  isCriticalControlEventType,
  parseControlMessage,
} from './controlEvents.js';

describe('controlEvents', () => {
  it('validates known control event types', () => {
    expect(isControlEventType(CONTROL_EVENTS.OPEN_CELL)).toBe(true);
    expect(isControlEventType('unknown_event')).toBe(false);
  });

  it('marks only selected events as critical', () => {
    expect(isCriticalControlEventType(CONTROL_EVENTS.OPEN_CELL)).toBe(true);
    expect(isCriticalControlEventType(CONTROL_EVENTS.SCORE_LOG_APPEND)).toBe(false);
  });

  it('parses valid control message and drops unknown type', () => {
    const parsed = parseControlMessage({
      type: CONTROL_EVENTS.MODAL_VIEW_STATE,
      payload: { sessionId: 'modal-1' },
      senderRole: 'host',
      senderId: 'id-1',
      sentAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parsed).toEqual({
      type: CONTROL_EVENTS.MODAL_VIEW_STATE,
      payload: { sessionId: 'modal-1' },
      senderRole: 'host',
      senderId: 'id-1',
      sentAt: '2026-01-01T00:00:00.000Z',
    });

    expect(parseControlMessage({ type: 'random', payload: {} })).toBe(null);
  });
});
