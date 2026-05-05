import { isCriticalControlEventType } from '../sync/controlEvents.js';

function createDefaultKey(type, payload = {}) {
  const sessionId = String(payload?.sessionId || '').trim();
  if (sessionId) return `${type}:${sessionId}`;
  return `${type}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
}

export class HostControlOutboxService {
  constructor({
    send,
    baseDelayMs = 120,
    maxDelayMs = 1200,
    maxAttempts = 4,
  } = {}) {
    this._send = typeof send === 'function' ? send : null;
    this._baseDelayMs = Math.max(10, Number(baseDelayMs) || 120);
    this._maxDelayMs = Math.max(this._baseDelayMs, Number(maxDelayMs) || 1200);
    this._maxAttempts = Math.max(1, Number(maxAttempts) || 4);
    this._pending = new Map();
    this._destroyed = false;
  }

  async send(type, payload = {}, options = {}) {
    if (this._destroyed || !this._send || !type) return false;

    const shouldRetry = options?.critical ?? isCriticalControlEventType(type);
    if (!shouldRetry) {
      return this._trySend(type, payload);
    }

    const key = String(options?.key || createDefaultKey(type, payload));
    if (this._pending.has(key)) {
      return this._pending.get(key).promise;
    }

    const task = this._createTask(key, type, payload, options);
    this._pending.set(key, task);
    this._attempt(task);
    return task.promise;
  }

  destroy() {
    this._destroyed = true;
    for (const task of this._pending.values()) {
      if (task.timerId) globalThis.clearTimeout(task.timerId);
      task.resolve(false);
    }
    this._pending.clear();
  }

  _createTask(key, type, payload, options = {}) {
    const maxAttempts = Math.max(1, Number(options?.maxAttempts) || this._maxAttempts);
    let resolvePromise = null;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    return {
      key,
      type,
      payload,
      attempt: 0,
      maxAttempts,
      timerId: null,
      promise,
      resolve: resolvePromise,
    };
  }

  async _attempt(task) {
    if (this._destroyed) return this._finishTask(task, false);
    task.attempt += 1;
    const sent = await this._trySend(task.type, task.payload);
    if (sent) {
      this._finishTask(task, true);
      return;
    }
    if (task.attempt >= task.maxAttempts) {
      this._finishTask(task, false);
      return;
    }

    const delayMs = Math.min(this._maxDelayMs, this._baseDelayMs * (2 ** (task.attempt - 1)));
    task.timerId = globalThis.setTimeout(() => {
      task.timerId = null;
      this._attempt(task);
    }, delayMs);
  }

  _finishTask(task, result) {
    if (task.timerId) {
      globalThis.clearTimeout(task.timerId);
      task.timerId = null;
    }
    if (this._pending.get(task.key) === task) {
      this._pending.delete(task.key);
    }
    task.resolve(!!result);
  }

  async _trySend(type, payload) {
    try {
      return !!(await this._send(type, payload));
    } catch {
      return false;
    }
  }
}

export function createHostControlOutboxService(options = {}) {
  return new HostControlOutboxService(options);
}
