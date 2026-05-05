import { describe, expect, it } from 'vitest';

import { createModalSyncStateService } from './ModalSyncStateService.js';

describe('ModalSyncStateService', () => {
  it('creates a full modal session snapshot on beginSession', () => {
    const service = createModalSyncStateService();
    const sessionId = service.beginSession({
      payload: { roundId: 1, rowId: 2, cellId: 3 },
      modalMode: 'edit',
    });

    expect(sessionId).toMatch(/^modal-/);
    expect(service.getSessionId()).toBe(sessionId);
    expect(service.getOpenCellPayload()).toMatchObject({
      roundId: 1,
      rowId: 2,
      cellId: 3,
      sessionId,
    });
    expect(service.getViewState()).toEqual({
      mode: 'edit',
      isAnswerShown: true,
      sessionId,
    });
    expect(service.getDirectedBetState()).toEqual({ sessionId });
    expect(service.getPressState()).toMatchObject({
      winnerPlayerId: null,
      pressEnabled: false,
      sessionId,
    });
  });

  it('hydrates modal state only when open_cell has a sessionId', () => {
    const service = createModalSyncStateService();

    expect(service.hydrateFromOpenCell({ roundId: 1, rowId: 1, cellId: 1 })).toBe(false);

    const accepted = service.hydrateFromOpenCell({
      roundId: 1,
      rowId: 1,
      cellId: 1,
      modalMode: 'view',
      sessionId: 'modal-abc',
    });
    expect(accepted).toBe(true);
    expect(service.getSessionId()).toBe('modal-abc');
    expect(service.getViewState()).toEqual({
      mode: 'view',
      isAnswerShown: false,
      sessionId: 'modal-abc',
    });
  });

  it('dedupes repeated open_cell payloads for controller mirror', () => {
    const service = createModalSyncStateService();
    const payload = {
      roundId: 1,
      rowId: 1,
      cellId: 1,
      modalMode: 'view',
      sessionId: 'modal-1',
    };

    expect(service.isDuplicateControllerOpen(payload)).toBe(false);
    service.markControllerOpen(payload);
    expect(service.isDuplicateControllerOpen(payload)).toBe(true);
    expect(service.isDuplicateControllerOpen({ ...payload, modalMode: 'edit' })).toBe(true);
  });

  it('accepts modal events only for the active session', () => {
    const service = createModalSyncStateService();

    expect(service.acceptEventForActiveSession({ sessionId: 'modal-1' })).toBe(true);
    expect(service.getSessionId()).toBe('modal-1');
    expect(service.acceptEventForActiveSession({ sessionId: 'modal-1' })).toBe(true);
    expect(service.acceptEventForActiveSession({ sessionId: 'modal-2' })).toBe(false);
    expect(service.acceptEventForActiveSession({})).toBe(false);
  });

  it('accepts close only for matching session when active session exists', () => {
    const service = createModalSyncStateService();
    service.beginSession({
      payload: { roundId: 1, rowId: 2, cellId: 3 },
      modalMode: 'view',
    });

    const sessionId = service.getSessionId();
    expect(service.acceptCloseForActiveSession({ sessionId: 'other' })).toBe(false);
    expect(service.acceptCloseForActiveSession({ sessionId })).toBe(true);
    expect(service.closeSession()).toBe(sessionId);
    expect(service.acceptCloseForActiveSession({})).toBe(true);
  });
});
