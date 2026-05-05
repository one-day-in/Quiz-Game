function normalizeMode(mode = 'view') {
  return String(mode || 'view').toLowerCase() === 'edit' ? 'edit' : 'view';
}

function normalizeSessionId(rawValue) {
  const sessionId = String(rawValue || '').trim();
  return sessionId || null;
}

function createDefaultPressState(sessionId) {
  return {
    winnerPlayerId: null,
    winnerName: '',
    pressedAt: null,
    pressExpiresAt: null,
    pressEnabled: false,
    sessionId,
  };
}

export class ModalSyncStateService {
  constructor() {
    this._seq = 0;
    this._sessionId = null;
    this._openCellPayload = null;
    this._viewState = null;
    this._directedBetState = null;
    this._pressState = null;
    this._controllerOpenSignature = '';
  }

  beginSession({ payload = null, modalMode = 'view' } = {}) {
    const nextSessionId = `modal-${Date.now()}-${++this._seq}`;
    const mode = normalizeMode(modalMode);
    this._sessionId = nextSessionId;
    this._openCellPayload = payload ? { ...(payload || {}), sessionId: nextSessionId } : null;
    this._viewState = {
      mode,
      isAnswerShown: mode === 'edit',
      sessionId: nextSessionId,
    };
    this._directedBetState = { sessionId: nextSessionId };
    this._pressState = createDefaultPressState(nextSessionId);
    this._controllerOpenSignature = '';
    return nextSessionId;
  }

  closeSession() {
    const closedSessionId = this._sessionId || null;
    this._sessionId = null;
    this._openCellPayload = null;
    this._viewState = null;
    this._directedBetState = null;
    this._pressState = null;
    this._controllerOpenSignature = '';
    return closedSessionId;
  }

  getSessionId() {
    return this._sessionId || null;
  }

  hasSession() {
    return !!this._sessionId;
  }

  acceptEventForActiveSession(payload = {}) {
    const incomingSessionId = normalizeSessionId(payload?.sessionId);
    if (!incomingSessionId) return false;
    if (!this._sessionId) {
      this._sessionId = incomingSessionId;
      return true;
    }
    return incomingSessionId === this._sessionId;
  }

  acceptCloseForActiveSession(payload = {}) {
    if (!this._sessionId) return true;
    const incomingSessionId = normalizeSessionId(payload?.sessionId);
    if (!incomingSessionId) return false;
    return incomingSessionId === this._sessionId;
  }

  withSession(payload = {}) {
    return {
      ...(payload || {}),
      sessionId: this._sessionId || null,
    };
  }

  setViewState({ mode = 'view', isAnswerShown = false } = {}) {
    if (!this._sessionId) return null;
    const next = {
      mode: normalizeMode(mode),
      isAnswerShown: !!isAnswerShown,
      sessionId: this._sessionId,
    };
    this._viewState = next;
    return next;
  }

  setDirectedBetState(state = null) {
    if (!this._sessionId) return null;
    this._directedBetState = state ? { ...(state || {}), sessionId: this._sessionId } : { sessionId: this._sessionId };
    return this._directedBetState;
  }

  setPressState(state = null) {
    if (!this._sessionId) return null;
    this._pressState = state
      ? { ...(state || {}), sessionId: this._sessionId }
      : createDefaultPressState(this._sessionId);
    return this._pressState;
  }

  hydrateFromOpenCell(payload = {}) {
    const incomingSessionId = normalizeSessionId(payload?.sessionId);
    if (!incomingSessionId) return false;

    const nextMode = normalizeMode(payload?.modalMode);
    this._sessionId = incomingSessionId;
    this._openCellPayload = { ...(payload || {}), sessionId: incomingSessionId };
    this._viewState = {
      mode: nextMode,
      isAnswerShown: nextMode === 'edit',
      sessionId: incomingSessionId,
    };
    if (!this._directedBetState || normalizeSessionId(this._directedBetState?.sessionId) !== incomingSessionId) {
      this._directedBetState = { sessionId: incomingSessionId };
    }
    if (!this._pressState || normalizeSessionId(this._pressState?.sessionId) !== incomingSessionId) {
      this._pressState = createDefaultPressState(incomingSessionId);
    }
    return true;
  }

  buildControllerOpenSignature(payload = {}) {
    const sessionId = normalizeSessionId(payload?.sessionId);
    const roundId = Number(payload?.roundId);
    const rowId = Number(payload?.rowId);
    const cellId = Number(payload?.cellId);
    const mode = normalizeMode(payload?.modalMode);
    return sessionId ? `${sessionId}|${roundId}|${rowId}|${cellId}|${mode}` : '';
  }

  isDuplicateControllerOpen(payload = {}) {
    const signature = this.buildControllerOpenSignature(payload);
    if (!signature) return false;
    return this._controllerOpenSignature === signature;
  }

  markControllerOpen(payload = {}) {
    this._controllerOpenSignature = this.buildControllerOpenSignature(payload);
  }

  getOpenCellPayload() {
    return this._openCellPayload ? { ...this._openCellPayload } : null;
  }

  getViewState() {
    return this._viewState ? { ...this._viewState } : null;
  }

  getDirectedBetState() {
    return this._directedBetState ? { ...this._directedBetState } : null;
  }

  getPressState() {
    return this._pressState ? { ...this._pressState } : null;
  }
}

export function createModalSyncStateService() {
  return new ModalSyncStateService();
}
