import { QuestionModalView } from '../views/QuestionModalView.js';
import { Disposer } from '../utils/disposer.js';
import { showConfirm } from '../utils/confirm.js';
import { adjustPlayerScore, resolveGamePress } from '../api/gameApi.js';
import { t } from '../i18n.js';

const PRESS_RESPONSE_SECONDS = 30;
const PRESS_OPEN_RETRY_ATTEMPTS = 3;
const PRESS_OPEN_RETRY_DELAY_MS = 220;

export class ModalService {
  constructor(gameService, mediaService, pressRuntime, playersService, options = {}) {
    this._game = gameService;
    this._media = mediaService;
    this._pressRuntime = pressRuntime;
    this._players = playersService;
    this._presentationMode = options.presentationMode || 'host';
    this._onModalClose = options.onModalClose || null;
    this._onControllerMediaControl = options.onControllerMediaControl || null;
    this._onControllerCommand = options.onControllerCommand || null;
    this._onModalViewStateChange = options.onModalViewStateChange || null;
    this._onMediaPlaybackStateChange = options.onMediaPlaybackStateChange || null;
    this._onScoreLog = options.onScoreLog || null;

    this._disposer = new Disposer();
    this.view = null;
    this.container = null;
    this.activeCell = null;

    // Debounce state for text inputs
    this._pendingQuestionText = null;
    this._pendingAnswerText   = null;
    this._questionTimer       = null;
    this._answerTimer         = null;
    this._stopRuntimeSubscription = null;
    this._pressWinnerId = null;
    this._cellValue = 0;
    this._pressCountdownTimer = null;
    this._pressCountdownDeadline = null;
    this._pressCountdownRemainingMs = null;
    this._pressTimerPaused = false;
    this._isResettingPressRuntime = false;
    this._isResolvingPressResult = false;
    this._isClosing = false;
    this._currentResolutionValue = 0;
    this._mediaInteractionUnlocked = this.isControllerMode();
    this._pendingMediaControl = null;

    if (!this.isControllerMode() && typeof document !== 'undefined') {
      const unlock = () => this._unlockMediaInteraction();
      this._disposer.addEventListener(document, 'pointerdown', unlock, { passive: true });
      this._disposer.addEventListener(document, 'keydown', unlock);
      this._disposer.addEventListener(document, 'touchstart', unlock, { passive: true });
    }
  }

  _unlockMediaInteraction() {
    if (this._mediaInteractionUnlocked) return;
    this._mediaInteractionUnlocked = true;
    if (!this._pendingMediaControl) return;

    const pending = this._pendingMediaControl;
    this._pendingMediaControl = null;
    void this.controlMedia(pending.target, pending.action);
  }

  _ensureContainer() {
    if (this.container?.isConnected) return this.container;

    const old = document.getElementById('modal-container');
    if (old) old.remove();

    const c = document.createElement('div');
    c.id = 'modal-container';
    c.className = 'modal-container';
    document.body.appendChild(c);

    this._disposer.add(() => c?.remove());
    this.container = c;
    return c;
  }

  // True from the moment activeCell is set (opening) until it's cleared (closed)
  isOpen() {
    return !!this.activeCell;
  }

  showQuestionView(cellData) {
    this._open('view', cellData);
  }

  isControllerMode() {
    return this._presentationMode === 'controller';
  }

  _getHeaderTitle({ roundId, rowId, value, topic }) {
    const topicText =
      this._game?.getModel?.()?.getTopic?.(roundId, rowId) ??
      topic ??
      '';

    const topicPart = (topicText || '').trim() || t('no_topic');

    // ✅ only points/value, no coordinates
    const valuePart =
      typeof value === 'number' || typeof value === 'string'
        ? String(value).trim()
        : '';

    return valuePart ? `${topicPart} • ${valuePart}` : topicPart;

  }

  _open(mode, cellData) {
    if (this.isOpen()) this.close();
    this._ensureContainer();

    this.activeCell = {
      roundId: cellData.roundId,
      rowId: cellData.rowId,
      cellId: cellData.cellId
    };
    this._cellValue = Number(cellData.value) || 0;
    this._currentResolutionValue = this._cellValue;
    if (!this.isControllerMode()) {
      void this._resetPressRuntime();
    }

    const shouldMarkAsAnswered = !this.isControllerMode() && mode === 'view' && !cellData.isAnswered;
    if (shouldMarkAsAnswered) {
      void this._updateCell({ isAnswered: true }, { silent: true });
    }

    const question = { ...(cellData.question || {}) };
    const answer = { ...(cellData.answer || {}) };

    if (question.media) question.media = this._media.toViewMedia(question.media);
    if (answer.media)   answer.media   = this._media.toViewMedia(answer.media);

    // Convert raw audioFiles arrays to view format (adds .src)
    question.audioFiles = this._media.toViewAudioFiles(question.audioFiles);
    answer.audioFiles   = this._media.toViewAudioFiles(answer.audioFiles);

    const headerTitle = this._getHeaderTitle(cellData);

    this.view = new QuestionModalView({
      mode,
      displayMode: this.isControllerMode() ? 'controller' : 'host',
      headerTitle,

      isAnswered: shouldMarkAsAnswered ? true : cellData.isAnswered,
      question,
      answer,

      onClose:     () => {
        if (this.isControllerMode()) {
          this._onControllerCommand?.('close_modal');
        }
        this.close();
      },
      onIncorrect: () => {
        if (this.isControllerMode()) {
          this._onControllerCommand?.('modal_incorrect');
          return;
        }
        void this._handleIncorrect();
      },
      onCorrect:   () => {
        if (this.isControllerMode()) {
          this._onControllerCommand?.('modal_correct');
          return;
        }
        void this._handleCorrect();
      },

      onToggleAnswered: (checked) => {
        void this._updateCell({ isAnswered: checked });
      },

      onQuestionChange: (text) => {
        this._pendingQuestionText = text;
        clearTimeout(this._questionTimer);
        this._questionTimer = setTimeout(() => {
          void this._updateCell({ question: { text } });
          this._pendingQuestionText = null;
        }, 400);
      },

      onAnswerChange: (text) => {
        this._pendingAnswerText = text;
        clearTimeout(this._answerTimer);
        this._answerTimer = setTimeout(() => {
          void this._updateCell({ answer: { text } });
          this._pendingAnswerText = null;
        }, 400);
      },

      onUploadMedia: async (file, target) => {
        this.view.setUploading(target, true);
        try {
          const viewMedia = await this._media.uploadToCell({
            file,
            target,
            ...this.activeCell
          });
          this.view.updateMedia(target, viewMedia);
        } catch (e) {
          console.error('[ModalService] upload failed:', e);
          alert(`${t('upload_media_error')}: ` + (e?.message || e));
          throw e;
        } finally {
          this.view?.setUploading(target, false);
        }
      },

      onDeleteMedia: async (target) => {
        if (!await showConfirm({ message: t('delete_media_confirm') })) return;

        this.view.setUploading(target, true);
        try {
          await this._media.deleteFromCell({
            target,
            ...this.activeCell
          });
          this.view.updateMedia(target, null);
        } catch (e) {
          console.error('[ModalService] delete media failed:', e);
          alert(`${t('delete_media_error')}: ` + (e?.message || e));
          throw e;
        } finally {
          this.view?.setUploading(target, false);
        }
      },

      onAddAudio: async (file, target) => {
        this.view.setUploading(target, true);
        try {
          const viewAudio = await this._media.addAudioToCell({
            file, target, ...this.activeCell
          });
          this.view.updateAudioList(target, [...this.view.getAudioFiles(target), viewAudio]);
        } catch (e) {
          console.error('[ModalService] add audio failed:', e);
          alert(`${t('upload_audio_error')}: ` + (e?.message || e));
        } finally {
          this.view?.setUploading(target, false);
        }
      },

      onDeleteAudio: async (filename, target) => {
        if (!await showConfirm({ message: t('delete_audio_confirm') })) return;

        this.view.setUploading(target, true);
        try {
          await this._media.deleteAudioFromCell({
            filename, target, ...this.activeCell
          });
          this.view.updateAudioList(target, this.view.getAudioFiles(target).filter(f => f.filename !== filename));
        } catch (e) {
          console.error('[ModalService] delete audio failed:', e);
          alert(`${t('delete_audio_error')}: ` + (e?.message || e));
        } finally {
          this.view?.setUploading(target, false);
        }
      },

      onViewStateChange: ({ mode: nextMode, isAnswerShown }) => {
        this._onModalViewStateChange?.({ mode: nextMode, isAnswerShown });
        if (this.isControllerMode()) return;
        if (nextMode !== 'view' || isAnswerShown) {
          this._pausePressCountdown();
          return;
        }

        this._resumePressCountdown();
      },

      onControllerMediaControl: ({ target, action }) => {
        if (this.isControllerMode()) {
          this._onControllerMediaControl?.({ target, action });
          return;
        }
        if (action === 'toggle_answer') {
          this.view?.toggleAnswerVisibility?.();
          return;
        }
        void this.controlMedia(target, action);
      },
    });

    this.container.appendChild(this.view.el);

    this._onModalViewStateChange?.({ mode: this.view?._mode || 'view', isAnswerShown: !!this.view?._isAnswerShown });

    this._bindPressRuntime();
    // ESC is handled inside QuestionModalView (properly cleaned up on destroy).
    // Do NOT add a document keydown listener here — ModalService._disposer is
    // long-lived and never destroyed between openings, so listeners would
    // accumulate and call close() / touch() N times per ESC press.
  }

  async _updateCell(update, { silent = false } = {}) {
    if (!this.activeCell) return;

    const { roundId, rowId, cellId } = this.activeCell;

    try {
      await this._game.updateCell(roundId, rowId, cellId, update);
    } catch (error) {
      console.error('[ModalService] Failed to update cell:', error);
      if (!silent) alert(t('save_failed'));
      throw error;
    }
  }

  _buildClosePatch(cell) {
    if (!cell || this.isControllerMode()) return null;

    const patch = {};
    if (this._pendingQuestionText !== null) {
      patch.question = { text: this._pendingQuestionText };
      this._pendingQuestionText = null;
    }
    if (this._pendingAnswerText !== null) {
      patch.answer = { text: this._pendingAnswerText };
      this._pendingAnswerText = null;
    }

    return Object.keys(patch).length ? patch : null;
  }

  async close() {
    if (this._isClosing) return;
    this._isClosing = true;
    try {
      const hadOpenModal = !!this.activeCell || !!this.view;
      // Flush any pending debounced text saves before clearing activeCell
      clearTimeout(this._questionTimer);
      clearTimeout(this._answerTimer);
      this._clearPressCountdown();
      this._questionTimer = null;
      this._answerTimer   = null;
      const cell = this.activeCell;
      const closePatch = this._buildClosePatch(cell);
      if (cell && closePatch) {
        try {
          await this._updateCell(closePatch, { silent: true });
        } catch (error) {
          console.warn('[ModalService] close flush failed:', error);
        }
      }
  
      const lastCell = this.activeCell; // capture before clearing
  
      if (this.view) {
        this.view.destroy();
        this.view = null;
      }
      this._stopRuntimeSubscription?.();
      this._stopRuntimeSubscription = null;
      this.activeCell = null;
      this._pressWinnerId = null;
      this._cellValue = 0;
      this._pressTimerPaused = false;
      this._isResolvingPressResult = false;
      this._currentResolutionValue = 0;
      void this._pressRuntime?.closePress?.();
      if (this.container?.isConnected) this.container.innerHTML = '';
      if (hadOpenModal) {
        this._onModalClose?.();
      }
  
      // Targeted patch — only the closed cell's is-answered state updates
      this._game.touch(lastCell);
    } finally {
      this._isClosing = false;
    }
  }

  async _handleIncorrect() {
    if (!this._pressWinnerId || this._isResolvingPressResult) return;
    this._isResolvingPressResult = true;
    this._clearPressCountdown();
    const resolutionValue = this._getEffectiveResolutionValue();
    const winnerId = this._pressWinnerId;
    const lockAcquired = await this._acquirePressResolutionLock(winnerId, { pressEnabled: true });
    if (!lockAcquired) {
      this._isResolvingPressResult = false;
      return;
    }
    try {
      await adjustPlayerScore(this._game.getGameId(), winnerId, -resolutionValue);
      this._emitScoreLog({
        playerId: winnerId,
        delta: -resolutionValue,
        outcome: 'incorrect',
      });
    } catch (e) {
      console.error('[ModalService] adjustPlayerScore (incorrect) failed:', e);
    }
    // Reset press — modal stays open, another player can press.
    await this._resetPressRuntime();
    this._isResolvingPressResult = false;
  }

  async _handleCorrect() {
    if (!this._pressWinnerId || this._isResolvingPressResult) return;
    this._isResolvingPressResult = true;
    const resolutionValue = this._getEffectiveResolutionValue();
    const winnerId = this._pressWinnerId;
    const lockAcquired = await this._acquirePressResolutionLock(winnerId, { pressEnabled: false });
    if (!lockAcquired) {
      this._isResolvingPressResult = false;
      this.close();
      return;
    }
    try {
      await adjustPlayerScore(this._game.getGameId(), winnerId, resolutionValue);
      await this._game?.setCurrentPlayerId?.(winnerId);
      this._emitScoreLog({
        playerId: winnerId,
        delta: resolutionValue,
        outcome: 'correct',
      });
    } catch (e) {
      console.error('[ModalService] correct resolution failed:', e);
    }
    this.close();
  }

  async _acquirePressResolutionLock(winnerPlayerId, { pressEnabled = false } = {}) {
    if (!winnerPlayerId) return false;
    try {
      await resolveGamePress(this._game.getGameId(), winnerPlayerId, { pressEnabled });
      return true;
    } catch (error) {
      const message = String(error?.message || '');
      if (message.includes('Press already resolved')) return false;
      // Compatibility fallback while DB function is being rolled out.
      if (message.includes('resolve_game_press')) {
        console.warn('[ModalService] resolve_game_press RPC is unavailable, using legacy local resolution.');
        return true;
      }
      console.error('[ModalService] resolve_game_press failed:', error);
      return false;
    }
  }

  async _resetPressRuntime() {
    try {
      this._isResettingPressRuntime = true;
      this._clearPressCountdown();
      this._pressTimerPaused = false;
      this._setPressWinner(null, '');
      await this._openPressRuntimeWithRetry();
    } catch (error) {
      console.error('[ModalService] Failed to reset press runtime:', error);
    }
  }

  async _openPressRuntimeWithRetry() {
    let lastError = null;
    for (let attempt = 1; attempt <= PRESS_OPEN_RETRY_ATTEMPTS; attempt += 1) {
      try {
        await this._pressRuntime?.openPress?.();
        return true;
      } catch (error) {
        lastError = error;
        if (attempt >= PRESS_OPEN_RETRY_ATTEMPTS) break;
        await new Promise((resolve) => setTimeout(resolve, PRESS_OPEN_RETRY_DELAY_MS));
      }
    }
    throw lastError || new Error('Failed to open press runtime');
  }

  _setPressWinner(winnerPlayerId = null, winnerName = '') {
    this._pressWinnerId = winnerPlayerId || null;
    this.view?.updateWinnerName?.(winnerName || '');
  }

  _getPlayersSnapshot() {
    return Array.isArray(this._players?.getPlayers?.()) ? this._players.getPlayers() : [];
  }

  _clearPressCountdown() {
    clearInterval(this._pressCountdownTimer);
    this._pressCountdownTimer = null;
    this._pressCountdownDeadline = null;
    this._pressCountdownRemainingMs = null;
    this.view?.updatePressTimer?.(null);
  }

  _pausePressCountdown() {
    if (!this._pressCountdownDeadline) return;
    this._pressCountdownRemainingMs = Math.max(0, this._pressCountdownDeadline - Date.now());
    clearInterval(this._pressCountdownTimer);
    this._pressCountdownTimer = null;
    this._pressCountdownDeadline = null;
    this._pressTimerPaused = true;
  }

  _resumePressCountdown() {
    if (!this._pressWinnerId || this._isResolvingPressResult) return;
    if (!this._pressTimerPaused || !this._pressCountdownRemainingMs || this._pressCountdownTimer) return;
    this._pressTimerPaused = false;
    this._startPressCountdown(this._pressCountdownRemainingMs);
  }

  _syncPressCountdownView() {
    if (!this._pressCountdownDeadline) {
      this.view?.updatePressTimer?.(null);
      return;
    }

    const secondsRemaining = Math.max(0, (this._pressCountdownDeadline - Date.now()) / 1000);
    this.view?.updatePressTimer?.(secondsRemaining);
  }

  _startPressCountdown(durationMs = PRESS_RESPONSE_SECONDS * 1000) {
    if (!this._pressWinnerId || this._isResolvingPressResult) return;
    if (this._pressCountdownTimer) return;

    this._pressCountdownRemainingMs = durationMs;
    this._pressCountdownDeadline = Date.now() + durationMs;
    this._syncPressCountdownView();

    this._pressCountdownTimer = setInterval(() => {
      if (!this._pressCountdownDeadline) return;

      const remainingMs = this._pressCountdownDeadline - Date.now();
      if (remainingMs <= 0) {
        this._clearPressCountdown();
        if (typeof this.view?.triggerIncorrect === 'function') {
          this.view.triggerIncorrect();
        } else {
          void this._handleIncorrect();
        }
        return;
      }

      this._syncPressCountdownView();
    }, 250);
  }

  _handlePressRuntimeUpdate(runtime) {
    const nextWinnerId = runtime?.winnerPlayerId || null;
    const nextWinnerName = runtime?.winnerName || '';
    const prevWinnerId = this._pressWinnerId;

    if (this._isResettingPressRuntime && nextWinnerId) {
      return;
    }

    if (!nextWinnerId) {
      this._isResettingPressRuntime = false;
      this._clearPressCountdown();
      this._pressTimerPaused = false;
      this._setPressWinner(null, '');
      return;
    }

    this._setPressWinner(nextWinnerId, nextWinnerName);
    this._currentResolutionValue = this._cellValue;
    this.view?.setResolutionButtonsEnabled?.(null);

    if (nextWinnerId !== prevWinnerId) {
      this._clearPressCountdown();
      this._pressTimerPaused = false;
      this._startPressCountdown();
    }
  }

  _bindPressRuntime() {
    this._stopRuntimeSubscription?.();
    if (!this._pressRuntime) return;

    const stopSub = this._pressRuntime.subscribe((runtime) => {
      this._handlePressRuntimeUpdate(runtime);
    });

    this._stopRuntimeSubscription = () => {
      stopSub?.();
    };
  }

  _getEffectiveResolutionValue() {
    const directValue = Number(this._currentResolutionValue);
    if (Number.isFinite(directValue) && directValue !== 0) return directValue;
    return Number(this._cellValue) || 0;
  }

  _emitScoreLog({ playerId, delta, outcome }) {
    if (!this._onScoreLog) return;
    const player = this._getPlayersSnapshot().find((entry) => String(entry?.id || '') === String(playerId || ''));
    const activeCell = this.activeCell || null;
    const topic = activeCell
      ? this._game?.getModel?.()?.getTopic?.(activeCell.roundId, activeCell.rowId) || t('no_topic')
      : t('no_topic');
    const absoluteValue = Math.abs(Number(delta) || 0);
    const cellLabel = `${topic} / ${delta >= 0 ? '+' : '-'}${absoluteValue}`;

    this._onScoreLog({
      kind: 'cell_resolution',
      playerId: playerId || null,
      playerName: player?.name || t('player_fallback'),
      cellLabel,
      outcome,
      delta: Number(delta) || 0,
      happenedAt: new Date().toISOString(),
    });
  }

  destroy() {
    this.close();
    this._disposer.destroy();
    this.container = null;
  }

  async controlMedia(target = '', action = 'play') {
    const resolvedTarget = target || this.view?.getMediaControlTarget?.() || 'question';
    if (!this.isControllerMode() && action === 'play' && !this._mediaInteractionUnlocked) {
      this._pendingMediaControl = { target: resolvedTarget, action };
      this._onMediaPlaybackStateChange?.({
        target: resolvedTarget,
        isPlaying: false,
      });
      return { target: resolvedTarget, isPlaying: false };
    }

    const isPlaying = await this.view?.controlMedia?.(resolvedTarget, action);
    this._onMediaPlaybackStateChange?.({
      target: resolvedTarget,
      isPlaying: !!isPlaying,
    });
    return { target: resolvedTarget, isPlaying: !!isPlaying };
  }

  runRemoteCommand(type, payload = {}) {
    if (!type) return;
    if (type === 'close_modal') {
      this.close();
      return;
    }
    if (type === 'modal_incorrect') {
      void this._handleIncorrect();
      return;
    }
    if (type === 'modal_correct') {
      void this._handleCorrect();
      return;
    }
    if (type === 'modal_media_control') {
      return this.controlMedia(payload?.target, payload?.action);
    }
    if (type === 'modal_toggle_answer') {
      this.view?.toggleAnswerVisibility?.();
      return;
    }
    if (type === 'modal_view_state') {
      const nextTarget = payload?.isAnswerShown ? 'answer' : 'question';
      this.view?.setControllerMediaTarget?.(nextTarget);
      this.view?.setAnswerShown?.(!!payload?.isAnswerShown);
      return;
    }
    if (type === 'modal_media_state') {
      if (payload?.target) this.view?.setControllerMediaTarget?.(payload.target);
      this.view?.setControllerMediaPlaying?.(!!payload?.isPlaying);
    }
  }
}

export function createModalService(gameService, mediaService, pressRuntime, playersService, options = {}) {
  return new ModalService(gameService, mediaService, pressRuntime, playersService, options);
}
