import { supabase } from '../api/supabaseClient.js';
import { parseControlMessage } from '../sync/controlEvents.js';

function randomId(prefix = 'hostctl') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function isTransientChannelError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (!message) return false;
  return (
    message.includes('unauthorized')
    || message.includes('failed to fetch')
    || message.includes('network')
    || message.includes('internet disconnected')
    || message.includes('name not resolved')
    || message.includes('quic')
    || message.includes('timeout')
    || message.includes('channel status')
    || message.includes('before subscribe')
    || message.includes('subscribe timeout')
  );
}

export class HostControlChannelService {
  constructor({ gameId, role = 'host' } = {}) {
    this._gameId = gameId;
    this._role = role;
    this._instanceId = randomId(role);
    this._subs = new Set();
    this._channel = null;
    this._isConnected = false;
    this._connectPromise = null;
    this._lastSendWarningAt = 0;
  }

  async connect() {
    if (this._isConnected || !this._gameId) return;
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const settle = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      const channel = supabase
        .channel(`host-control:${this._gameId}`)
        .on('broadcast', { event: 'host-command' }, (payload) => {
          const message = parseControlMessage(payload?.payload || null);
          if (!message) return;
          if (message.senderId === this._instanceId) return;

          for (const fn of this._subs) {
            fn(message);
          }
        });

      this._channel = channel;
      const resetOnTerminalStatus = (status) => {
        this._isConnected = false;
        if (this._channel === channel) {
          this._channel = null;
        }
        try {
          supabase.removeChannel(channel);
        } catch {}
        if (!settled) {
          settle(reject, new Error(`Host control channel status: ${status}`));
        }
      };

      const timeoutId = globalThis.setTimeout(() => {
        resetOnTerminalStatus('SUBSCRIBE_TIMEOUT');
      }, 6000);

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          globalThis.clearTimeout(timeoutId);
          this._isConnected = true;
          settle(resolve);
          return;
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          globalThis.clearTimeout(timeoutId);
          resetOnTerminalStatus(status);
          return;
        }

        if (status === 'CLOSED') {
          globalThis.clearTimeout(timeoutId);
          resetOnTerminalStatus(status);
        }
      });
    }).finally(() => {
      this._connectPromise = null;
    });

    return this._connectPromise;
  }

  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  async send(type, payload = {}) {
    if (!this._gameId) return false;
    try {
      await this.connect();
    } catch (error) {
      if (isTransientChannelError(error)) {
        this._warnTransientSendError(type, error);
        return false;
      }
      throw error;
    }
    if (!this._channel) return false;

    const broadcastPayload = {
      type,
      payload,
      senderRole: this._role,
      senderId: this._instanceId,
      sentAt: new Date().toISOString(),
    };

    try {
      if (typeof this._channel.httpSend === 'function') {
        await this._channel.httpSend('host-command', broadcastPayload);
        return true;
      }

      await this._channel.send({
        type: 'broadcast',
        event: 'host-command',
        payload: broadcastPayload,
      });
      return true;
    } catch (error) {
      // If REST broadcast fails (401/network), best-effort fallback to WS send.
      if (typeof this._channel.send === 'function') {
        try {
          await this._channel.send({
            type: 'broadcast',
            event: 'host-command',
            payload: broadcastPayload,
          });
          return true;
        } catch (fallbackError) {
          if (isTransientChannelError(fallbackError)) {
            this._isConnected = false;
            this._warnTransientSendError(type, fallbackError);
            return false;
          }
          throw fallbackError;
        }
      }

      if (isTransientChannelError(error)) {
        this._isConnected = false;
        this._warnTransientSendError(type, error);
        return false;
      }
      throw error;
    }
  }

  _warnTransientSendError(type, error) {
    const now = Date.now();
    if (now - this._lastSendWarningAt < 5000) return;
    this._lastSendWarningAt = now;
    console.warn('[HostControlChannel] transient send failure, will continue in degraded mode:', {
      type,
      message: String(error?.message || error),
    });
  }

  destroy() {
    this._subs.clear();
    this._connectPromise = null;
    if (this._channel) {
      supabase.removeChannel(this._channel);
      this._channel = null;
    }
    this._isConnected = false;
  }
}

export function createHostControlChannelService(options) {
  return new HostControlChannelService(options);
}
