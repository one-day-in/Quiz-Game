import { supabase } from '../api/supabaseClient.js';

function randomId(prefix = 'hostctl') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

export class HostControlChannelService {
  constructor({ gameId, role = 'host' } = {}) {
    this._gameId = gameId;
    this._role = role;
    this._instanceId = randomId(role);
    this._subs = new Set();
    this._channel = null;
    this._isConnected = false;
  }

  async connect() {
    if (this._isConnected || !this._gameId) return;

    this._channel = supabase
      .channel(`host-control:${this._gameId}`)
      .on('broadcast', { event: 'host-command' }, (payload) => {
        const message = payload?.payload || null;
        if (!message) return;
        if (message.senderId === this._instanceId) return;

        for (const fn of this._subs) {
          fn(message);
        }
      });

    await this._channel.subscribe();
    this._isConnected = true;
  }

  subscribe(fn) {
    this._subs.add(fn);
    return () => this._subs.delete(fn);
  }

  async send(type, payload = {}) {
    if (!this._gameId) return;
    await this.connect();
    if (!this._channel) return;

    const broadcastPayload = {
      type,
      payload,
      senderRole: this._role,
      senderId: this._instanceId,
      sentAt: new Date().toISOString(),
    };

    if (typeof this._channel.httpSend === 'function') {
      await this._channel.httpSend('host-command', broadcastPayload);
      return;
    }

    await this._channel.send({
      type: 'broadcast',
      event: 'host-command',
      payload: broadcastPayload,
    });
  }

  destroy() {
    this._subs.clear();
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
