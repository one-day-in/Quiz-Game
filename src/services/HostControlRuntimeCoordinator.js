import { CONTROL_EVENTS } from '../sync/controlEvents.js';

export class HostControlRuntimeCoordinator {
  constructor({
    hostMode = 'host',
    sendControl,
    requestControllerStateSync,
    onControllerAvailabilityChange = null,
    onHostControllerConnectedChange = null,
    pingMs = 2000,
    staleMs = 4500,
    controllerStateSyncMs = 4000,
    roundSyncRetryMs = 1500,
  } = {}) {
    this._hostMode = hostMode === 'controller' ? 'controller' : 'host';
    this._sendControl = sendControl;
    this._requestControllerStateSync = requestControllerStateSync;
    this._onControllerAvailabilityChange = onControllerAvailabilityChange;
    this._onHostControllerConnectedChange = onHostControllerConnectedChange;
    this._pingMs = pingMs;
    this._staleMs = staleMs;
    this._controllerStateSyncMs = controllerStateSyncMs;
    this._roundSyncRetryMs = roundSyncRetryMs;

    this._hostActivityPingTimer = null;
    this._mainHostStaleTimer = null;
    this._controllerActivityPingTimer = null;
    this._hostControllerStaleTimer = null;
    this._controllerStateSyncTimer = null;
    this._roundSyncRetryTimer = null;
    this._hasRoundStateSynced = false;
  }

  start() {
    if (this._hostMode === 'host') {
      this._sendHostActivity(true);
      this._hostActivityPingTimer = globalThis.setInterval(() => this._sendHostActivity(true), this._pingMs);
      void this._sendControl?.(CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE_REQUEST);
      return;
    }

    this._onControllerAvailabilityChange?.(false);
    this._sendControllerActivity(true);
    this._controllerActivityPingTimer = globalThis.setInterval(() => this._sendControllerActivity(true), this._pingMs);
    this._requestControllerStateSync?.();
    this._controllerStateSyncTimer = globalThis.setInterval(() => {
      this._requestControllerStateSync?.();
    }, this._controllerStateSyncMs);
  }

  stop() {
    globalThis.clearInterval(this._hostActivityPingTimer);
    this._hostActivityPingTimer = null;
    globalThis.clearTimeout(this._mainHostStaleTimer);
    this._mainHostStaleTimer = null;

    globalThis.clearInterval(this._controllerActivityPingTimer);
    this._controllerActivityPingTimer = null;
    globalThis.clearTimeout(this._hostControllerStaleTimer);
    this._hostControllerStaleTimer = null;

    globalThis.clearInterval(this._controllerStateSyncTimer);
    this._controllerStateSyncTimer = null;
    this.stopRoundSyncRetry();

    if (this._hostMode === 'host') {
      this._sendHostActivity(false);
      this._onHostControllerConnectedChange?.(false);
      return;
    }

    this._sendControllerActivity(false);
    this._onControllerAvailabilityChange?.(false);
  }

  handleHostRuntimeState(active) {
    if (this._hostMode !== 'controller') return;
    const isActive = active !== false;
    this._onControllerAvailabilityChange?.(isActive);
    globalThis.clearTimeout(this._mainHostStaleTimer);
    if (isActive) {
      this._mainHostStaleTimer = globalThis.setTimeout(() => {
        this._onControllerAvailabilityChange?.(false);
      }, this._staleMs);
    }

    if (!isActive) {
      this._hasRoundStateSynced = false;
      this.stopRoundSyncRetry();
    } else if (!this._hasRoundStateSynced) {
      this.startRoundSyncRetry();
    }
  }

  handleControllerRuntimeState(active) {
    if (this._hostMode !== 'host') return;
    const isActive = active !== false;
    this._onHostControllerConnectedChange?.(isActive);
    globalThis.clearTimeout(this._hostControllerStaleTimer);
    if (!isActive) return;
    this._hostControllerStaleTimer = globalThis.setTimeout(() => {
      this._onHostControllerConnectedChange?.(false);
    }, this._staleMs);
  }

  setRoundStateSynced(value) {
    this._hasRoundStateSynced = !!value;
    if (this._hasRoundStateSynced) {
      this.stopRoundSyncRetry();
    }
  }

  hasRoundStateSynced() {
    return !!this._hasRoundStateSynced;
  }

  startRoundSyncRetry() {
    if (this._hostMode !== 'controller') return;
    if (this._roundSyncRetryTimer) return;
    this._requestControllerStateSync?.();
    this._roundSyncRetryTimer = globalThis.setInterval(() => {
      if (this._hasRoundStateSynced) {
        this.stopRoundSyncRetry();
        return;
      }
      this._requestControllerStateSync?.();
    }, this._roundSyncRetryMs);
  }

  stopRoundSyncRetry() {
    if (!this._roundSyncRetryTimer) return;
    globalThis.clearInterval(this._roundSyncRetryTimer);
    this._roundSyncRetryTimer = null;
  }

  _sendHostActivity(active) {
    void this._sendControl?.(CONTROL_EVENTS.HOST_RUNTIME_STATE, {
      active: !!active,
      sentAt: new Date().toISOString(),
    });
  }

  _sendControllerActivity(active) {
    void this._sendControl?.(CONTROL_EVENTS.CONTROLLER_RUNTIME_STATE, {
      active: !!active,
      sentAt: new Date().toISOString(),
    });
  }
}

export function createHostControlRuntimeCoordinator(options = {}) {
  return new HostControlRuntimeCoordinator(options);
}
