import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHostControlOutboxService } from './HostControlOutboxService.js';
import { CONTROL_EVENTS } from '../sync/controlEvents.js';

describe('HostControlOutboxService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('sends non-critical event once without retries', async () => {
    const send = vi.fn().mockResolvedValue(false);
    const outbox = createHostControlOutboxService({ send });

    const result = await outbox.send(CONTROL_EVENTS.SCORE_LOG_APPEND, { id: '1' }, { critical: false });

    expect(result).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries critical event and succeeds on next attempt', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const outbox = createHostControlOutboxService({
      send,
      baseDelayMs: 100,
      maxDelayMs: 100,
      maxAttempts: 3,
    });

    const pending = outbox.send(CONTROL_EVENTS.OPEN_CELL, { sessionId: 'modal-1' });
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;

    expect(result).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('dedupes same critical key while retry is in flight', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const outbox = createHostControlOutboxService({
      send,
      baseDelayMs: 100,
      maxDelayMs: 100,
      maxAttempts: 3,
    });

    const first = outbox.send(CONTROL_EVENTS.MODAL_VIEW_STATE, { sessionId: 'modal-1' }, { key: 'view:modal-1' });
    const second = outbox.send(CONTROL_EVENTS.MODAL_VIEW_STATE, { sessionId: 'modal-1' }, { key: 'view:modal-1' });

    await vi.advanceTimersByTimeAsync(100);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(true);
    expect(secondResult).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
