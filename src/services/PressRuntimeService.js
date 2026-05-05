import {
  claimGamePress,
  getGameRuntime,
  setPressEnabled,
  subscribeToGameRuntime,
} from '../api/gameApi.js';
import { getSession } from '../api/authApi.js';
import { getActiveBuzzerUrl } from '../utils/localBuzzerUrl.js';

const DEV_BUZZER_PORT = '8787';
const FALLBACK_POLL_MS = 1000;
const IS_DEV =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

function resolveBuzzerUrl(overrideUrl = '') {
  const resolved = getActiveBuzzerUrl({ overrideUrl });
  if (resolved) return resolved;
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${host}:${DEV_BUZZER_PORT}`;
  }

  return '';
}

function normalizeRuntime(gameId, runtime = null) {
  return {
    gameId,
    pressEnabled: !!runtime?.pressEnabled,
    winnerPlayerId: runtime?.winnerPlayerId || null,
    winnerName: runtime?.winnerName || null,
    pressedAt: runtime?.pressedAt || null,
    pressExpiresAt: runtime?.pressExpiresAt || runtime?.press_expires_at || null,
    pressStatus: runtime?.pressStatus || runtime?.press_status || null,
    resolvedAt: runtime?.resolvedAt || runtime?.resolved_at || null,
    updatedAt: runtime?.updatedAt || null,
  };
}

class ApiPressRuntimeService {
  constructor({ gameId, controllerId = null }) {
    this.gameId = gameId;
    this.controllerId = controllerId;
    this._subs = new Set();
    this._state = normalizeRuntime(gameId, null);
    this._stopRuntimeSubscription = null;
    this._pollTimer = null;
    this._connected = false;
  }

  async connect() {
    if (this._connected) return;
    this._connected = true;

    const emitRuntime = async () => {
      try {
        this._setState(await getGameRuntime(this.gameId));
      } catch (error) {
        console.error('[PressRuntimeService] fallback runtime refresh failed:', error);
      }
    };

    await emitRuntime();
    this._stopRuntimeSubscription = subscribeToGameRuntime(this.gameId, (runtime) => {
      this._setState(runtime);
    });
    this._pollTimer = window.setInterval(() => { void emitRuntime(); }, FALLBACK_POLL_MS);
  }

  subscribe(fn) {
    this._subs.add(fn);
    void this.connect();
    queueMicrotask(() => {
      if (this._subs.has(fn)) fn(this._state);
    });
    return () => this._subs.delete(fn);
  }

  async openPress() {
    const runtime = await setPressEnabled(this.gameId, true);
    this._setState(runtime);
    return runtime;
  }

  async closePress() {
    const runtime = await setPressEnabled(this.gameId, false);
    this._setState(runtime);
    return runtime;
  }

  async getRuntime() {
    const runtime = await getGameRuntime(this.gameId);
    this._setState(runtime);
    return this._state;
  }

  async claimPress() {
    const runtime = await claimGamePress(this.gameId, this.controllerId);
    this._setState(runtime);
    return runtime;
  }

  destroy() {
    this._stopRuntimeSubscription?.();
    this._stopRuntimeSubscription = null;
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    this._subs.clear();
  }

  _setState(runtime) {
    this._state = normalizeRuntime(this.gameId, runtime);
    for (const fn of this._subs) fn(this._state);
  }
}

class SocketPressRuntimeService {
  constructor({ gameId, role, controllerId = null, getAccessToken = null, wsUrl }) {
    this.gameId = gameId;
    this.role = role;
    this.controllerId = controllerId;
    this._getAccessToken = getAccessToken;
    this._wsUrl = wsUrl;
    this._subs = new Set();
    this._state = normalizeRuntime(gameId, null);
    this._ws = null;
    this._connectPromise = null;
    this._destroyed = false;
    this._reconnectTimer = null;
    this._requestId = 0;
    this._pending = new Map();
    this._pendingHello = null;
    this._permanentError = null;
  }

  subscribe(fn) {
    this._subs.add(fn);
    void this.connect();
    queueMicrotask(() => {
      if (this._subs.has(fn)) fn(this._state);
    });
    return () => this._subs.delete(fn);
  }

  async connect() {
    if (this._destroyed) return;
    if (this._permanentError) throw this._permanentError;
    if (this._ws && this._ws.readyState === WebSocket.OPEN) return;
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this._wsUrl);
      this._ws = ws;

      const fail = (error) => {
        if (settled) return;
        settled = true;
        this._connectPromise = null;
        reject(error);
      };

      ws.addEventListener('open', async () => {
        try {
          const accessToken = this._getAccessToken ? await this._getAccessToken() : null;
          const timeoutId = window.setTimeout(() => {
            if (!this._pendingHello) return;
            this._pendingHello.reject(new Error('Buzzer socket handshake timed out'));
            this._pendingHello = null;
            ws.close();
          }, 4000);

          this._pendingHello = {
            resolve: () => {
              if (settled) return;
              settled = true;
              this._connectPromise = null;
              window.clearTimeout(timeoutId);
              this._pendingHello = null;
              resolve();
            },
            reject: (error) => {
              if (settled) return;
              settled = true;
              this._connectPromise = null;
              window.clearTimeout(timeoutId);
              this._pendingHello = null;
              reject(error);
            },
          };

          ws.send(JSON.stringify({
            type: 'hello',
            gameId: this.gameId,
            role: this.role,
            controllerId: this.controllerId,
            accessToken: accessToken || null,
          }));
        } catch (error) {
          fail(error);
          ws.close();
        }
      });

      ws.addEventListener('message', (event) => {
        try {
          const message = JSON.parse(event.data);
          this._handleMessage(message);
        } catch (error) {
          console.error('[PressRuntimeService] invalid websocket message:', error);
        }
      });

      ws.addEventListener('error', () => {
        fail(new Error('Buzzer socket connection failed'));
      });

      ws.addEventListener('close', () => {
        this._pendingHello?.reject?.(new Error('Buzzer socket disconnected'));
        this._pendingHello = null;
        const pending = Array.from(this._pending.values());
        this._pending.clear();
        for (const request of pending) request.reject(new Error('Buzzer socket disconnected'));
        this._ws = null;
        this._connectPromise = null;
        if (!this._destroyed) this._scheduleReconnect();
      });
    });

    return this._connectPromise;
  }

  async openPress() {
    return this._sendRequest('host_open_press');
  }

  async closePress() {
    return this._sendRequest('host_close_press');
  }

  async claimPress() {
    return this._sendRequest('player_claim_press', {
      controllerId: this.controllerId,
    });
  }

  async getRuntime() {
    try {
      await this.connect();
    } catch {
      // ignore connect errors here; return the last known state
    }
    return this._state;
  }

  destroy() {
    this._destroyed = true;
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = null;
    const pending = Array.from(this._pending.values());
    this._pending.clear();
    for (const request of pending) request.reject(new Error('Buzzer socket destroyed'));
    this._ws?.close();
    this._ws = null;
    this._subs.clear();
  }

  async _sendRequest(type, payload = {}) {
    await this.connect();
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) {
      throw new Error('Buzzer socket is not connected');
    }

    const requestId = `${Date.now()}-${++this._requestId}`;
    const message = { type, requestId, ...payload };

    const result = await new Promise((resolve, reject) => {
      this._pending.set(requestId, { resolve, reject });
      this._ws.send(JSON.stringify(message));
    });

    if (result?.state) {
      this._setState(result.state);
      return this._state;
    }

    return this._state;
  }

  _handleMessage(message) {
    if (message?.type === 'snapshot' || message?.type === 'runtime') {
      this._setState(message.state);
      if (message.type === 'snapshot') {
        this._pendingHello?.resolve?.();
      }
      return;
    }

    if (message?.type === 'response' && message.requestId) {
      const pending = this._pending.get(message.requestId);
      if (!pending) return;
      this._pending.delete(message.requestId);
      if (message.ok) pending.resolve(message.data || null);
      else pending.reject(new Error(message.error || 'Buzzer request failed'));
      return;
    }

    if (message?.type === 'error') {
      const errorText = String(message.error || 'Buzzer socket error');
      this._pendingHello?.reject?.(new Error(errorText));
      if (errorText.includes('Host access denied')) {
        this._permanentError = new Error(errorText);
        this._destroyed = true;
        this._ws?.close();
        this._ws = null;
        this._connectPromise = null;
        return;
      }
      console.error('[PressRuntimeService] buzzer socket error:', errorText);
    }
  }

  _setState(runtime) {
    this._state = normalizeRuntime(this.gameId, runtime);
    for (const fn of this._subs) fn(this._state);
  }

  _scheduleReconnect() {
    clearTimeout(this._reconnectTimer);
    this._reconnectTimer = window.setTimeout(() => {
      if (this._destroyed) return;
      void this.connect().catch((error) => {
        if (this._permanentError) return;
        console.error('[PressRuntimeService] reconnect failed:', error);
      });
    }, 1000);
  }
}

class HybridPressRuntimeService {
  constructor(primary, fallback) {
    this._primary = primary;
    this._fallback = fallback;
    this._active = null;
    this._subs = new Map();
    this._connectPromise = null;
    this._shadowFallbackConnected = false;
  }

  subscribe(fn) {
    const entry = { active: null };
    this._subs.set(fn, entry);
    void this.connect();
    if (this._active) {
      entry.active = this._active.subscribe(fn);
    }
    return () => {
      const current = this._subs.get(fn);
      current?.active?.();
      this._subs.delete(fn);
    };
  }

  async connect() {
    if (this._active) {
      await this._active.connect();
      return;
    }
    if (this._connectPromise) return this._connectPromise;

    this._connectPromise = (async () => {
      try {
        await this._primary.connect();
        this._activate(this._primary);
        void this._connectFallbackShadow();
      } catch (error) {
        if (IS_DEV) {
          console.info('[PressRuntimeService] websocket runtime unavailable, using API fallback:', error?.message || error);
        }
        await this._fallback.connect();
        this._activate(this._fallback);
      } finally {
        this._connectPromise = null;
      }
    })();

    return this._connectPromise;
  }

  async openPress() {
    return this._call('openPress');
  }

  async closePress() {
    return this._call('closePress');
  }

  async claimPress() {
    return this._call('claimPress');
  }

  async getRuntime() {
    await this.connect();
    if (typeof this._fallback?.getRuntime === 'function') {
      try {
        return await this._fallback.getRuntime();
      } catch (error) {
        if (IS_DEV) {
          console.info('[PressRuntimeService] fallback runtime snapshot failed:', error?.message || error);
        }
      }
    }
    if (typeof this._active?.getRuntime === 'function') {
      return this._active.getRuntime();
    }
    return this._active?._state || null;
  }

  destroy() {
    for (const entry of this._subs.values()) {
      entry?.active?.();
    }
    this._subs.clear();
    this._primary?.destroy?.();
    this._fallback?.destroy?.();
  }

  async _call(methodName) {
    await this.connect();
    try {
      return await this._active[methodName]();
    } catch (error) {
      if (this._active !== this._primary) throw error;
      const isExpectedSocketDrop =
        methodName === 'closePress' &&
        String(error?.message || '').includes('Buzzer socket is not connected');
      if (!isExpectedSocketDrop && IS_DEV) {
        console.info(`[PressRuntimeService] ${methodName} failed on websocket runtime, switching to fallback:`, error?.message || error);
      }
      await this._fallback.connect();
      this._activate(this._fallback);
      return this._fallback[methodName]();
    }
  }

  _activate(service) {
    if (this._active === service) return;
    for (const entry of this._subs.values()) {
      entry?.active?.();
      if (entry) entry.active = null;
    }
    for (const [fn, entry] of this._subs) {
      entry.active = service.subscribe(fn);
    }
    this._active = service;
  }

  async _connectFallbackShadow() {
    if (this._shadowFallbackConnected) return;
    try {
      await this._fallback.connect();
      this._shadowFallbackConnected = true;
    } catch (error) {
      if (IS_DEV) {
        console.info('[PressRuntimeService] background fallback subscription failed:', error?.message || error);
      }
    }
  }
}

export function createPressRuntimeService({
  gameId,
  role,
  controllerId = null,
  wsUrl = '',
  disableSocket = false,
  disableFallback = false,
}) {
  if (disableSocket) {
    return new ApiPressRuntimeService({ gameId, controllerId });
  }
  const resolvedWsUrl = resolveBuzzerUrl(wsUrl);

  if (!resolvedWsUrl) {
    return new ApiPressRuntimeService({ gameId, controllerId });
  }

  const socketService = new SocketPressRuntimeService({
    gameId,
    role,
    controllerId,
    wsUrl: resolvedWsUrl,
    getAccessToken: role === 'host'
      ? async () => {
          const session = await getSession();
          return session?.access_token || null;
        }
      : null,
  });

  if (disableFallback) {
    return socketService;
  }

  const fallbackService = new ApiPressRuntimeService({ gameId, controllerId });
  return new HybridPressRuntimeService(socketService, fallbackService);
}
