import { QuestionModalView } from '../views/QuestionModalView.js';
import { Disposer } from '../utils/disposer.js';
import { showConfirm } from '../utils/confirm.js';
import { adjustPlayerScore, resolveGamePress } from '../api/gameApi.js';
import { t } from '../i18n.js';
import {
  createCellModifier,
  DIRECTED_BET_STAKE_CONFIG,
  MODIFIER_TYPES,
  isAutoApplyModifierType,
} from '../modifiers/modifierEngine.js';

const FALLBACK_PRESS_RESPONSE_SECONDS = Number(import.meta?.env?.VITE_PRESS_RESPONSE_SECONDS) > 0
  ? Number(import.meta.env.VITE_PRESS_RESPONSE_SECONDS)
  : 30;
const PRESS_OPEN_RETRY_ATTEMPTS = 3;
const PRESS_OPEN_RETRY_DELAY_MS = 220;
const DIRECTED_BET_MIN_STAKE = DIRECTED_BET_STAKE_CONFIG.min;
const DIRECTED_BET_MAX_STAKE = DIRECTED_BET_STAKE_CONFIG.max;
const DIRECTED_BET_STEP = DIRECTED_BET_STAKE_CONFIG.step;
const DIRECTED_BET_RESPONSE_SECONDS = DIRECTED_BET_STAKE_CONFIG.responseSeconds;
const STEAL_LEADER_POINTS_VALUE = 1000;
const AUTO_MODIFIER_BANNER_MS = 4000;
const PRESS_TRACE_ENABLED = String(import.meta?.env?.VITE_PRESS_TRACE || '').toLowerCase() === 'true';

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
    this._onDirectedBetStateChange = options.onDirectedBetStateChange || null;

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
    this._pressAutoResolveBlocked = false;
    this._pressDeadlineIso = null;
    this._modalViewMode = 'view';
    this._modalIsAnswerShown = false;
    this._pressAvailabilityIntent = null;
    this._pressSyncVersion = 0;
    this._globalGameMode = 'play';
    this._mediaInteractionUnlocked = this.isControllerMode();
    this._pendingMediaControl = null;
    this._pressResyncTimer = null;
    this._activeModifier = null;
    this._directedBet = null;
    this._openRequestId = 0;

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

  _setBackgroundInteractionBlocked(blocked) {
    if (typeof document === 'undefined') return;
    const body = document.body;
    const appShell = document.querySelector('.app-shell');
    if (blocked) {
      body?.classList?.add('qmodal-open');
      appShell?.classList?.add('app-shell--modalBlocked');
      appShell?.setAttribute?.('inert', '');
      return;
    }
    body?.classList?.remove('qmodal-open');
    appShell?.classList?.remove('app-shell--modalBlocked');
    appShell?.removeAttribute?.('inert');
  }

  // True from the moment activeCell is set (opening) until it's cleared (closed)
  isOpen() {
    return !!this.activeCell;
  }

  showQuestionView(cellData) {
    void this._openQueued('view', cellData);
  }

  showEditView(cellData) {
    void this._openQueued('edit', cellData);
  }

  async _openQueued(mode, cellData) {
    const requestId = ++this._openRequestId;
    if (this.isOpen() || this._isClosing) {
      await this.close();
    }
    if (requestId !== this._openRequestId) return;
    this._open(mode, cellData);
  }

  setGameMode(mode = 'play') {
    const nextMode = String(mode || 'play').toLowerCase() === 'edit' ? 'edit' : 'play';
    if (this._globalGameMode === nextMode) return;
    this._globalGameMode = nextMode;
    void this._syncPressAvailability({ reason: 'game_mode_changed' });
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
    this._ensureContainer();
    this._setBackgroundInteractionBlocked(true);

    this.activeCell = {
      roundId: cellData.roundId,
      rowId: cellData.rowId,
      cellId: cellData.cellId
    };
    this._cellValue = Number(cellData.value) || 0;
    this._currentResolutionValue = this._cellValue;
    this._pressWinnerId = null;
    this._pressAutoResolveBlocked = false;
    this._pressDeadlineIso = null;
    const allowModeToggle = !this.isControllerMode() && this._globalGameMode === 'edit';
    const effectiveMode = allowModeToggle && mode === 'edit' ? 'edit' : 'view';
    this._modalViewMode = effectiveMode;
    this._modalIsAnswerShown = effectiveMode === 'edit';
    this._activeModifier = cellData?.modifier ? { ...cellData.modifier } : null;
    this._directedBet = null;
    this._pressAvailabilityIntent = null;
    if (!this.isControllerMode() && !this._shouldAutoApplyModifierOnOpen()) {
      void this._resetPressRuntime();
    }

    const shouldMarkAsAnswered = !this.isControllerMode() && !cellData.isAnswered;
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
    this._initDirectedBetState();

    this.view = new QuestionModalView({
      mode: effectiveMode,
      allowModeToggle,
      displayMode: this.isControllerMode() ? 'controller' : 'host',
      headerTitle,
      directedBetState: this._getDirectedBetViewState(),
      activeModifierType: this._activeModifier?.type || MODIFIER_TYPES.NONE,

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

      onModifierChange: async (nextType) => {
        if (this.isControllerMode()) return;
        const normalizedType = String(nextType || MODIFIER_TYPES.NONE).toLowerCase();
        this._activeModifier = createCellModifier(normalizedType);
        this._directedBet = null;
        this.view?.setDirectedBetState?.(null);
        this._emitDirectedBetStateChange(null);
        await this._updateCell({ modifier: this._activeModifier });
      },

      onViewStateChange: ({ mode: nextMode, isAnswerShown }) => {
        this._onModalViewStateChange?.({ mode: nextMode, isAnswerShown });
        if (this.isControllerMode()) return;
        this._modalViewMode = nextMode === 'edit' ? 'edit' : 'view';
        this._modalIsAnswerShown = !!isAnswerShown;
        this._pressAutoResolveBlocked = nextMode !== 'view' || !!isAnswerShown;
        if (this._pressAutoResolveBlocked) {
          this._pausePressCountdown();
          const keepWinnerForResolution = !!this._pressWinnerId
            && nextMode === 'view'
            && !!isAnswerShown;
          if (!keepWinnerForResolution) {
            void this._syncPressAvailability({ reason: 'view_state_blocked' });
          }
          return;
        }

        this._resumePressCountdown();
        void this._syncPressAvailability({ reason: 'view_state_active' });
      },
      onDirectedBetAction: (action) => {
        if (this.isControllerMode()) {
          this._onControllerCommand?.('modal_directed_bet_action', action || {});
          return;
        }
        this._handleDirectedBetAction(action);
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

    if (this._shouldAutoApplyModifierOnOpen()) {
      void this._runAutoApplyModifierFlow();
      return;
    }

    this._bindPressRuntime();
    // _resetPressRuntime already performs forced availability sync when modal opens.
    if (this.isControllerMode()) {
      void this._syncPressAvailability({ reason: 'modal_opened_controller' });
    }
    this._schedulePressAvailabilityResync();
    this._emitDirectedBetStateChange(this._getDirectedBetViewState());
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
      this._pressAutoResolveBlocked = false;
      this._pressDeadlineIso = null;
      this._modalViewMode = 'view';
      this._modalIsAnswerShown = false;
      this._pressAvailabilityIntent = null;
      clearTimeout(this._pressResyncTimer);
      this._pressResyncTimer = null;
      this._activeModifier = null;
      this._directedBet = null;
      this._emitDirectedBetStateChange(null);
      this._tracePressAvailability('close:modal_shutdown', { reason: 'modal_closed' });
      try {
        await this._pressRuntime?.closePress?.();
      } catch (error) {
        console.warn('[ModalService] closePress during modal shutdown failed:', error?.message || error);
      }
      if (this.container?.isConnected) this.container.innerHTML = '';
      if (hadOpenModal) {
        this._onModalClose?.();
      }
  
      // Targeted patch — only the closed cell's is-answered state updates
      this._game.touch(lastCell);
    } finally {
      this._setBackgroundInteractionBlocked(false);
      this._isClosing = false;
    }
  }

  async _handleIncorrect({ source = 'manual' } = {}) {
    if (!this._pressWinnerId || this._isResolvingPressResult) return;
    if (source === 'timeout' && this._shouldBlockAutoIncorrect()) return;
    this._isResolvingPressResult = true;
    this._clearPressCountdown();
    const resolutionValue = this._getEffectiveResolutionValue();
    const winnerId = this._pressWinnerId;
    const lockAcquired = await this._acquirePressResolutionLock(winnerId, {
      pressEnabled: true,
      source,
    });
    if (!lockAcquired) {
      this._isResolvingPressResult = false;
      return;
    }
    try {
      await this._applyScoreDeltaWithLog({
        playerId: winnerId,
        delta: -resolutionValue,
        outcome: 'incorrect',
      });
    } catch (e) {
      console.error('[ModalService] adjustPlayerScore (incorrect) failed:', e);
    }

    if (this._directedBet?.enabled && this._directedBet.phase === 'answering' && !this._directedBet.fallbackActivated) {
      this._activateDirectedBetFallback();
      this._isResolvingPressResult = false;
      return;
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
      await this._applyScoreDeltaWithLog({
        playerId: winnerId,
        delta: resolutionValue,
        outcome: 'correct',
      });
      await this._game?.setCurrentPlayerId?.(winnerId);
    } catch (e) {
      console.error('[ModalService] correct resolution failed:', e);
    }
    this.close();
  }

  async _acquirePressResolutionLock(winnerPlayerId, { pressEnabled = false, source = 'manual' } = {}) {
    if (!winnerPlayerId) return false;
    if (this._directedBet?.enabled && this._directedBet.phase === 'answering' && !this._directedBet.fallbackActivated) {
      return true;
    }
    try {
      // Use one stable resolve path for timeout/manual to avoid strict timeout-RPC
      // deadline mismatches that surface as noisy 400s in production logs.
      await resolveGamePress(this._game.getGameId(), winnerPlayerId, {
        pressEnabled: source === 'timeout' ? true : !!pressEnabled,
      });
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
      await this._syncPressAvailability({ force: true, reason: 'press_runtime_reset' });
    } catch (error) {
      console.error('[ModalService] Failed to reset press runtime:', error);
    }
  }

  _isQuestionPressWindowActive() {
    if (this._isDirectedBetLocked()) return false;
    if (this._isPressBlockedByModifier()) return false;
    return this.isOpen()
      && !this.isControllerMode()
      && this._globalGameMode === 'play'
      && this._modalViewMode === 'view'
      && !this._modalIsAnswerShown;
  }

  _isPressBlockedByModifier() {
    const type = String(this._activeModifier?.type || '').trim().toLowerCase();
    return isAutoApplyModifierType(type);
  }

  _shouldAutoApplyModifierOnOpen() {
    if (this.isControllerMode()) return false;
    if (this._globalGameMode !== 'play') return false;
    if (this._modalViewMode !== 'view') return false;
    return isAutoApplyModifierType(this._activeModifier?.type);
  }

  _createModifierUserError(key) {
    const error = new Error(String(key || 'modifier_error'));
    error.userMessage = t(String(key || 'save_failed'));
    return error;
  }

  _getCurrentChooserPlayerId() {
    const chooserId = String(this._game?.getCurrentPlayerId?.() || '').trim();
    return chooserId || null;
  }

  async _runAutoApplyModifierFlow() {
    if (!this._shouldAutoApplyModifierOnOpen()) return;
    const modifierType = String(this._activeModifier?.type || '').trim().toLowerCase();
    this._isResolvingPressResult = true;
    try {
      if (modifierType === MODIFIER_TYPES.FLIP_SCORE) {
        await this._applyFlipScoreModifier();
      } else if (modifierType === MODIFIER_TYPES.STEAL_LEADER_POINTS) {
        await this._applyStealLeaderPointsModifier();
      }
    } catch (error) {
      console.error('[ModalService] auto modifier apply failed:', error);
      alert(error?.userMessage || t('save_failed'));
    } finally {
      await new Promise((resolve) => setTimeout(resolve, AUTO_MODIFIER_BANNER_MS));
      this._isResolvingPressResult = false;
      await this.close();
    }
  }

  async _applyFlipScoreModifier() {
    const chooserId = this._getCurrentChooserPlayerId();
    if (!chooserId) throw this._createModifierUserError('modifier_no_current_player');

    const chooser = this._getPlayersSnapshot().find((player) => String(player?.id || '') === chooserId);
    if (!chooser) throw this._createModifierUserError('modifier_no_current_player');

    const currentPoints = Number(chooser.points) || 0;
    const delta = -2 * currentPoints;
    if (delta === 0) return;

    await this._applyScoreDeltaWithLog({
      playerId: chooserId,
      delta,
      outcome: 'modifier_flip_score',
      kind: 'cell_resolution',
    });
  }

  async _applyStealLeaderPointsModifier() {
    const chooserId = this._getCurrentChooserPlayerId();
    if (!chooserId) throw this._createModifierUserError('modifier_no_current_player');

    const players = this._getPlayersSnapshot().filter((player) => String(player?.id || '').trim());
    const chooser = players.find((player) => String(player?.id || '') === chooserId);
    if (!chooser) throw this._createModifierUserError('modifier_no_current_player');

    const others = players.filter((player) => String(player?.id || '') !== chooserId);
    if (!others.length) throw this._createModifierUserError('modifier_not_available');

    const chooserPoints = Number(chooser.points) || 0;
    const byPointsAsc = [...others].sort((a, b) => (Number(a?.points) || 0) - (Number(b?.points) || 0));
    const byPointsDesc = [...others].sort((a, b) => (Number(b?.points) || 0) - (Number(a?.points) || 0));
    const lowestOther = byPointsAsc[0];
    const highestOther = byPointsDesc[0];
    const highestOtherPoints = Number(highestOther?.points) || 0;

    if (chooserPoints >= highestOtherPoints) {
      await this._applyScoreTransfer(chooserId, String(lowestOther?.id || ''), STEAL_LEADER_POINTS_VALUE, {
        fromOutcome: 'modifier_steal_give',
        toOutcome: 'modifier_steal_receive',
      });
      return;
    }

    await this._applyScoreTransfer(String(highestOther?.id || ''), chooserId, STEAL_LEADER_POINTS_VALUE, {
      fromOutcome: 'modifier_steal_give',
      toOutcome: 'modifier_steal_receive',
    });
  }

  async _applyScoreTransfer(fromPlayerId, toPlayerId, amount, { fromOutcome, toOutcome } = {}) {
    const fromId = String(fromPlayerId || '').trim();
    const toId = String(toPlayerId || '').trim();
    if (!fromId || !toId || fromId === toId) {
      throw this._createModifierUserError('modifier_not_available');
    }

    const transfer = Math.abs(Number(amount) || 0);
    if (!transfer) return;
    const fromDelta = -transfer;
    const toDelta = transfer;
    const happenedAt = new Date().toISOString();
    const fromLabel = this._buildScoreLogCellLabel(fromDelta);
    const toLabel = this._buildScoreLogCellLabel(toDelta);

    if (typeof this._players?.transferPlayerScoreWithLogs === 'function') {
      const result = await this._players.transferPlayerScoreWithLogs({
        fromPlayerId: fromId,
        toPlayerId: toId,
        amount: transfer,
        fromLog: {
          cellLabel: fromLabel,
          outcome: fromOutcome || 'modifier_transfer_out',
          kind: 'cell_resolution',
          happenedAt,
        },
        toLog: {
          cellLabel: toLabel,
          outcome: toOutcome || 'modifier_transfer_in',
          kind: 'cell_resolution',
          happenedAt,
        },
      });
      this._emitScoreLog(result?.fromScoreLog || {
        playerId: fromId,
        delta: fromDelta,
        cellLabel: fromLabel,
        outcome: fromOutcome || 'modifier_transfer_out',
        kind: 'cell_resolution',
        happenedAt,
      });
      this._emitScoreLog(result?.toScoreLog || {
        playerId: toId,
        delta: toDelta,
        cellLabel: toLabel,
        outcome: toOutcome || 'modifier_transfer_in',
        kind: 'cell_resolution',
        happenedAt,
      });
      return;
    }

    // Compatibility fallback for older runtime without atomic transfer helper.
    await this._applyScoreDeltaWithLog({
      playerId: fromId,
      delta: fromDelta,
      outcome: fromOutcome || 'modifier_transfer_out',
      kind: 'cell_resolution',
      cellLabel: fromLabel,
      happenedAt,
    });
    await this._applyScoreDeltaWithLog({
      playerId: toId,
      delta: toDelta,
      outcome: toOutcome || 'modifier_transfer_in',
      kind: 'cell_resolution',
      cellLabel: toLabel,
      happenedAt,
    });
  }

  _getPressTraceSnapshot() {
    return {
      isOpen: this.isOpen(),
      gameMode: this._globalGameMode,
      modalMode: this._modalViewMode,
      isAnswerShown: !!this._modalIsAnswerShown,
      hasWinner: !!this._pressWinnerId,
      directedBetLocked: this._isDirectedBetLocked(),
      intent: this._pressAvailabilityIntent,
    };
  }

  _tracePressAvailability(event, details = {}) {
    if (!PRESS_TRACE_ENABLED) return;
    console.debug('[ModalService][press-trace]', event, {
      ...details,
      snapshot: this._getPressTraceSnapshot(),
    });
  }

  async _syncPressAvailability({ force = false, reason = 'unspecified' } = {}) {
    if (!this._pressRuntime) return;
    const syncVersion = ++this._pressSyncVersion;
    const shouldEnable = this._isQuestionPressWindowActive();
    if (!force && this._pressAvailabilityIntent === shouldEnable) {
      this._tracePressAvailability('skip', { reason, syncVersion, shouldEnable, force });
      return;
    }

    const prevIntent = this._pressAvailabilityIntent;
    this._pressAvailabilityIntent = shouldEnable;
    try {
      if (shouldEnable) {
        this._tracePressAvailability('open:start', { reason, syncVersion, shouldEnable, force });
        await this._openPressRuntimeWithRetry();
        const staleOpen = syncVersion !== this._pressSyncVersion;
        if (!this._isQuestionPressWindowActive()) {
          this._tracePressAvailability('open:postcheck-close', { reason, syncVersion, staleOpen });
          await this._pressRuntime?.closePress?.();
          return;
        }
        this._tracePressAvailability('open:done', { reason, syncVersion, staleOpen });
        return;
      }
      this._tracePressAvailability('close:start', { reason, syncVersion, shouldEnable, force });
      await this._pressRuntime?.closePress?.();
      this._tracePressAvailability('close:done', { reason, syncVersion });
    } catch (error) {
      // Do not leave stale intent on transport/socket failures.
      this._pressAvailabilityIntent = prevIntent;
      this._tracePressAvailability('error', {
        reason,
        syncVersion,
        message: error?.message || String(error),
      });
      throw error;
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

  _initDirectedBetState() {
    if (this._modalViewMode !== 'view') return;
    if (this._globalGameMode !== 'play') return;
    if (this.isControllerMode()) return;
    if (this._activeModifier?.type !== MODIFIER_TYPES.DIRECTED_BET) return;

    const openerId = String(this._game?.getCurrentPlayerId?.() || '').trim();
    const players = this._getPlayersSnapshot()
      .filter((player) => {
        const id = String(player?.id || '').trim();
        return id && id !== openerId;
      })
      .map((player) => ({ id: String(player.id), name: String(player.name || t('player_fallback')) }));

    this._directedBet = {
      enabled: true,
      phase: 'select',
      openerId: openerId || null,
      selectedPlayerId: null,
      selectedStake: DIRECTED_BET_MIN_STAKE,
      players,
      fallbackActivated: false,
    };
    this._pressAutoResolveBlocked = true;
    this.view?.setPressBannerSuppressed?.(true);
  }

  _getDirectedBetViewState() {
    if (!this._directedBet?.enabled) return null;
    const state = this._directedBet;
    const isSelectionPhase = state.phase === 'select';
    return {
      enabled: isSelectionPhase,
      phase: state.phase,
      players: Array.isArray(state.players) ? state.players : [],
      selectedPlayerId: state.selectedPlayerId || null,
      selectedStake: Number(state.selectedStake) || DIRECTED_BET_MIN_STAKE,
      canStart: isSelectionPhase
        && !!state.selectedPlayerId
        && Number(state.selectedStake) >= DIRECTED_BET_MIN_STAKE
        && Number(state.selectedStake) <= DIRECTED_BET_MAX_STAKE,
    };
  }

  _syncDirectedBetView() {
    const nextState = this._getDirectedBetViewState();
    this.view?.setDirectedBetState?.(nextState);
    this._emitDirectedBetStateChange(nextState);
  }

  _emitDirectedBetStateChange(state) {
    this._onDirectedBetStateChange?.(state ? { ...state } : null);
  }

  _isDirectedBetLocked() {
    return !!(this._directedBet?.enabled && !this._directedBet?.fallbackActivated);
  }

  _activateDirectedBetFallback() {
    if (!this._directedBet?.enabled) return;
    this._directedBet.phase = 'fallback';
    this._directedBet.fallbackActivated = true;
    this._pressAutoResolveBlocked = false;
    this.view?.setPressBannerSuppressed?.(false);
    this._currentResolutionValue = Number(this._cellValue) || 0;
    this._setPressWinner(null, '');
    this._syncDirectedBetView();
    void this._syncPressAvailability({ force: true, reason: 'directed_bet_fallback' });
  }

  _handleDirectedBetAction(action = {}) {
    if (!this._directedBet?.enabled) return;
    if (this._directedBet.phase !== 'select') return;
    const type = String(action?.type || '').trim();
    if (type === 'select_player') {
      const playerId = String(action?.playerId || '').trim();
      if (!playerId) return;
      const exists = this._directedBet.players.some((player) => String(player.id) === playerId);
      if (!exists) return;
      this._directedBet.selectedPlayerId = playerId;
      this._syncDirectedBetView();
      return;
    }

    if (type === 'select_stake') {
      const stake = Number(action?.stake) || 0;
      if (!Number.isFinite(stake)) return;
      if (stake < DIRECTED_BET_MIN_STAKE || stake > DIRECTED_BET_MAX_STAKE) return;
      if (stake % DIRECTED_BET_STEP !== 0) return;
      this._directedBet.selectedStake = stake;
      this._syncDirectedBetView();
      return;
    }

    if (type === 'start') {
      const selectedPlayerId = String(this._directedBet.selectedPlayerId || '').trim();
      const stake = Number(this._directedBet.selectedStake) || 0;
      if (!selectedPlayerId) return;
      if (stake < DIRECTED_BET_MIN_STAKE || stake > DIRECTED_BET_MAX_STAKE) return;

      const selectedPlayer = this._directedBet.players.find((player) => String(player.id) === selectedPlayerId);
      this._directedBet.phase = 'answering';
      this._directedBet.fallbackActivated = false;
      this._currentResolutionValue = stake;
      this._pressAutoResolveBlocked = false;
      this._setPressWinner(selectedPlayerId, selectedPlayer?.name || t('player_fallback'));
      this.view?.setPressBannerSuppressed?.(false);
      this._syncDirectedBetView();
      this.view?.setResolutionButtonsEnabled?.(true);
      this._clearPressCountdown();
      this._startPressCountdown(DIRECTED_BET_RESPONSE_SECONDS * 1000);
      void this._syncPressAvailability({ force: true, reason: 'directed_bet_start' });
    }
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
    if (this._shouldBlockAutoIncorrect()) return;
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

  _startPressCountdown(durationMs = FALLBACK_PRESS_RESPONSE_SECONDS * 1000, deadlineIso = null) {
    if (!this._pressWinnerId || this._isResolvingPressResult) return;
    if (this._pressCountdownTimer) return;

    this._pressCountdownRemainingMs = durationMs;
    this._pressCountdownDeadline = Date.now() + durationMs;
    this._pressDeadlineIso = deadlineIso || new Date(this._pressCountdownDeadline).toISOString();
    this._syncPressCountdownView();

    this._pressCountdownTimer = setInterval(() => {
      if (!this._pressCountdownDeadline) return;
      if (this._shouldBlockAutoIncorrect()) {
        this._pausePressCountdown();
        return;
      }

      const remainingMs = this._pressCountdownDeadline - Date.now();
      if (remainingMs <= 0) {
        this._clearPressCountdown();
        void this._handleIncorrect({ source: 'timeout' });
        return;
      }

      this._syncPressCountdownView();
    }, 250);
  }

  _handlePressRuntimeUpdate(runtime) {
    if (this._isDirectedBetLocked()) return;
    const nextWinnerId = runtime?.winnerPlayerId || null;
    const nextWinnerName = runtime?.winnerName || '';
    const prevWinnerId = this._pressWinnerId;

    if (this._isResettingPressRuntime && nextWinnerId) {
      // If winner arrived while reset/open handshake is still marked in flight,
      // accept it once press is actually open in an active question window.
      if (runtime?.pressEnabled === true && this._isQuestionPressWindowActive()) {
        this._isResettingPressRuntime = false;
      } else {
        return;
      }
    }

    if (!nextWinnerId) {
      const waitingForOpenAck = this._isResettingPressRuntime
        && this._pressAvailabilityIntent === true
        && runtime?.pressEnabled !== true;
      if (waitingForOpenAck) {
        return;
      }

      const wasResetting = this._isResettingPressRuntime;
      this._isResettingPressRuntime = false;
      this._clearPressCountdown();
      this._pressTimerPaused = false;
      this._setPressWinner(null, '');
      if (!wasResetting && this._isQuestionPressWindowActive() && runtime?.pressEnabled === false) {
        this._schedulePressAvailabilityResync();
      }
      return;
    }

    this._setPressWinner(nextWinnerId, nextWinnerName);
    this._currentResolutionValue = this._cellValue;
    this.view?.setResolutionButtonsEnabled?.(null);

    if (nextWinnerId !== prevWinnerId) {
      this._clearPressCountdown();
      this._pressTimerPaused = false;
      const serverDeadlineMs = this._deriveRuntimeDeadlineMs(runtime);
      if (serverDeadlineMs) {
        const remainingMs = Math.max(0, serverDeadlineMs - Date.now());
        const serverDeadlineIso = new Date(serverDeadlineMs).toISOString();
        this._startPressCountdown(remainingMs, serverDeadlineIso);
      } else {
        this._startPressCountdown();
      }
    }
  }

  _deriveRuntimeDeadlineMs(runtime) {
    const directDeadline = Date.parse(runtime?.pressExpiresAt || '');
    if (Number.isFinite(directDeadline) && directDeadline > 0) return directDeadline;

    const pressedAtMs = Date.parse(runtime?.pressedAt || '');
    if (Number.isFinite(pressedAtMs) && pressedAtMs > 0) {
      return pressedAtMs + (FALLBACK_PRESS_RESPONSE_SECONDS * 1000);
    }
    return 0;
  }

  _shouldBlockAutoIncorrect() {
    if (this._pressAutoResolveBlocked) return true;
    if (this._isClosing) return true;
    if (!this.view) return true;
    if (this.view?._mode !== 'view') return true;
    if (this.view?._isAnswerShown) return true;
    return false;
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

  _schedulePressAvailabilityResync(delayMs = 420) {
    if (this.isControllerMode()) return;
    if (!this._isQuestionPressWindowActive()) return;
    if (this._isResettingPressRuntime) return;
    clearTimeout(this._pressResyncTimer);
    this._pressResyncTimer = setTimeout(() => {
      this._pressResyncTimer = null;
      if (!this._isQuestionPressWindowActive()) return;
      if (this._pressWinnerId) return;
      void this._syncPressAvailability({ force: true, reason: 'runtime_resync' }).catch((error) => {
        console.warn('[ModalService] press availability resync failed:', error?.message || error);
      });
    }, delayMs);
  }

  _getEffectiveResolutionValue() {
    const directValue = Number(this._currentResolutionValue);
    if (Number.isFinite(directValue) && directValue !== 0) return directValue;
    return Number(this._cellValue) || 0;
  }

  _buildScoreLogCellLabel(delta, fallbackLabel = null) {
    if (typeof fallbackLabel === 'string' && fallbackLabel.trim()) return fallbackLabel.trim();
    const activeCell = this.activeCell || null;
    const topic = activeCell
      ? this._game?.getModel?.()?.getTopic?.(activeCell.roundId, activeCell.rowId) || t('no_topic')
      : t('no_topic');
    const absoluteValue = Math.abs(Number(delta) || 0);
    return `${topic} / ${delta >= 0 ? '+' : '-'}${absoluteValue}`;
  }

  async _applyScoreDeltaWithLog({
    playerId,
    delta,
    outcome = null,
    kind = 'cell_resolution',
    cellLabel = null,
    happenedAt = null,
  } = {}) {
    const safePlayerId = String(playerId || '').trim();
    const safeDelta = Number(delta) || 0;
    if (!safePlayerId) throw new Error('Player id is required');
    const nextHappenedAt = happenedAt || new Date().toISOString();
    const nextCellLabel = this._buildScoreLogCellLabel(safeDelta, cellLabel);
    const knownPlayer = this._getPlayersSnapshot().find((entry) => String(entry?.id || '') === safePlayerId);
    const fallbackPlayerName = knownPlayer?.name || t('player_fallback');

    if (typeof this._players?.adjustPlayerScoreWithLog === 'function') {
      const result = await this._players.adjustPlayerScoreWithLog(safePlayerId, safeDelta, {
        playerName: fallbackPlayerName,
        cellLabel: nextCellLabel,
        outcome,
        kind,
        happenedAt: nextHappenedAt,
      });
      this._emitScoreLog(result?.scoreLog || {
        playerId: safePlayerId,
        playerName: fallbackPlayerName,
        cellLabel: nextCellLabel,
        outcome,
        delta: safeDelta,
        kind,
        happenedAt: nextHappenedAt,
      });
      return result;
    }

    const updatedPlayer = typeof this._players?.adjustPlayerScore === 'function'
      ? await this._players.adjustPlayerScore(safePlayerId, safeDelta)
      : await adjustPlayerScore(this._game.getGameId(), safePlayerId, safeDelta);
    const scoreAfter = Number(updatedPlayer?.points ?? updatedPlayer?.score);
    const safeScoreAfter = Number.isFinite(scoreAfter) ? scoreAfter : null;
    const scoreBefore = safeScoreAfter === null ? null : safeScoreAfter - safeDelta;
    this._emitScoreLog({
      playerId: safePlayerId,
      playerName: updatedPlayer?.name || fallbackPlayerName,
      cellLabel: nextCellLabel,
      outcome,
      delta: safeDelta,
      scoreBefore,
      scoreAfter: safeScoreAfter,
      kind,
      happenedAt: nextHappenedAt,
    });
    return {
      player: updatedPlayer,
      scoreLog: {
        playerId: safePlayerId,
        playerName: updatedPlayer?.name || fallbackPlayerName,
        cellLabel: nextCellLabel,
        outcome,
        delta: safeDelta,
        scoreBefore,
        scoreAfter: safeScoreAfter,
        kind,
        happenedAt: nextHappenedAt,
      },
    };
  }

  _emitScoreLog({
    id = null,
    playerId,
    playerName = '',
    cellLabel = '',
    delta,
    outcome,
    scoreBefore = null,
    scoreAfter = null,
    kind = 'cell_resolution',
    happenedAt = null,
  }) {
    if (!this._onScoreLog) return;
    const safeDelta = Number(delta) || 0;
    const player = this._getPlayersSnapshot().find((entry) => String(entry?.id || '') === String(playerId || ''));
    const resolvedPlayerName = String(playerName || player?.name || t('player_fallback'));
    const resolvedLabel = this._buildScoreLogCellLabel(safeDelta, cellLabel);
    const resolvedHappenedAt = happenedAt || new Date().toISOString();

    this._onScoreLog({
      id: id || null,
      kind,
      playerId: playerId || null,
      playerName: resolvedPlayerName,
      cellLabel: resolvedLabel,
      outcome,
      delta: safeDelta,
      scoreBefore: Number.isFinite(Number(scoreBefore)) ? Number(scoreBefore) : null,
      scoreAfter: Number.isFinite(Number(scoreAfter)) ? Number(scoreAfter) : null,
      happenedAt: resolvedHappenedAt,
    });
  }

  destroy() {
    this.close();
    this._disposer.destroy();
    this.container = null;
  }

  async controlMedia(target = '', action = 'play', options = {}) {
    const fromRemote = !!options?.fromRemote;
    const resolvedTarget = target || this.view?.getMediaControlTarget?.() || 'question';
    if (!this.isControllerMode() && !fromRemote && action === 'play' && !this._mediaInteractionUnlocked) {
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
      return this.controlMedia(payload?.target, payload?.action, { fromRemote: true });
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
      return;
    }
    if (type === 'modal_directed_bet_state') {
      this.view?.setDirectedBetState?.(payload || null);
      return;
    }
    if (type === 'modal_directed_bet_action') {
      if (this.isControllerMode()) return;
      this._handleDirectedBetAction(payload || {});
      return;
    }
    if (type === 'modal_press_state') {
      if (!this.isOpen()) return;
      this._applyRemotePressState(payload);
      return;
    }
  }

  _applyRemotePressState(payload = {}) {
    const nextWinnerId = String(payload?.winnerPlayerId || '').trim() || null;
    const nextWinnerName = String(payload?.winnerName || '').trim();

    if (!nextWinnerId) {
      this._clearPressCountdown();
      this._pressTimerPaused = false;
      this._setPressWinner(null, '');
      return;
    }

    const prevWinnerId = this._pressWinnerId;
    this._setPressWinner(nextWinnerId, nextWinnerName);
    this._currentResolutionValue = this._cellValue;
    this.view?.setResolutionButtonsEnabled?.(null);

    if (nextWinnerId !== prevWinnerId) {
      this._clearPressCountdown();
      this._pressTimerPaused = false;
      const serverDeadlineMs = this._deriveRuntimeDeadlineMs(payload);
      if (serverDeadlineMs) {
        const remainingMs = Math.max(0, serverDeadlineMs - Date.now());
        const serverDeadlineIso = new Date(serverDeadlineMs).toISOString();
        this._startPressCountdown(remainingMs, serverDeadlineIso);
      } else {
        this._startPressCountdown();
      }
    }
  }
}

export function createModalService(gameService, mediaService, pressRuntime, playersService, options = {}) {
  return new ModalService(gameService, mediaService, pressRuntime, playersService, options);
}
