import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createHostControlRuntimeCoordinator } from './HostControlRuntimeCoordinator.js';
import { CONTROL_EVENTS } from '../sync/controlEvents.js';

describe('HostControlRuntimeCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('starts host ping loop and sends inactive state on stop', () => {
    const sendControl = vi.fn().mockResolvedValue(true);
    const coordinator = createHostControlRuntimeCoordinator({
      hostMode: 'host',
      sendControl,
      requestControllerStateSync: vi.fn(),
      onHostControllerConnectedChange: vi.fn(),
      pingMs: 1000,
    });

    coordinator.start();
    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.HOST_RUNTIME_STATE, expect.objectContaining({ active: true }));
    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE_REQUEST);

    vi.advanceTimersByTime(2000);
    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.HOST_RUNTIME_STATE, expect.objectContaining({ active: true }));

    coordinator.stop();
    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.HOST_RUNTIME_STATE, expect.objectContaining({ active: false }));
  });

  it('starts controller sync loop and round retry while host is active', () => {
    const sendControl = vi.fn().mockResolvedValue(true);
    const requestControllerStateSync = vi.fn();
    const onControllerAvailabilityChange = vi.fn();

    const coordinator = createHostControlRuntimeCoordinator({
      hostMode: 'controller',
      sendControl,
      requestControllerStateSync,
      onControllerAvailabilityChange,
      pingMs: 1000,
      controllerStateSyncMs: 3000,
      roundSyncRetryMs: 1500,
      staleMs: 2000,
    });

    coordinator.start();
    expect(onControllerAvailabilityChange).toHaveBeenCalledWith(false);
    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE, expect.objectContaining({ active: true }));
    expect(requestControllerStateSync).toHaveBeenCalledTimes(1);

    coordinator.handleHostRuntimeState(true);
    vi.advanceTimersByTime(1500);
    expect(requestControllerStateSync).toHaveBeenCalledTimes(3);

    coordinator.setRoundStateSynced(true);
    vi.advanceTimersByTime(2000);
    expect(onControllerAvailabilityChange).toHaveBeenLastCalledWith(false);

    coordinator.stop();
    expect(sendControl).toHaveBeenCalledWith(CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE, expect.objectContaining({ active: false }));
  });
});
