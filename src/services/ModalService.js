import { updatePlayer } from '../api/playersApi.js';
import { QuestionModalView } from '../views/QuestionModalView.js';
import { Disposer } from '../utils/disposer.js';
import { showConfirm } from '../utils/confirm.js';
import { adjustPlayerScore } from '../api/gameApi.js';
import { CELL_MODIFIERS, isFlipScoreModifier } from '../constants/cellModifiers.js';
import { t } from '../i18n.js';

const PRESS_RESPONSE_SECONDS = 30;
const MODIFIER_BANNER_SECONDS = 10;

export class ModalService {
  constructor(gameService, mediaService, pressRuntime, playersService) {
    this._game = gameService;
    this._media = mediaService;
    this._pressRuntime = pressRuntime;
    this._players = playersService;

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
    this._pressEnableTimer = null;
    this._pressWinnerId = null;
    this._cellValue = 0;
    this._pressCountdownTimer = null;
    this._pressCountdownDeadline = null;
    this._pressCountdownRemainingMs = null;
    this._pressTimerPaused = false;
    this._isResettingPressRuntime = false;
    this._isResolvingPressResult = false;
    this._activeModifier = null;
    this._modifierCloseTimer = null;
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
    this._activeModifier = cellData.modifier || null;

    if (!isFlipScoreModifier(this._activeModifier)) {
      void this._resetPressRuntime();
    }

    const shouldMarkAsAnswered = mode === 'view' && !cellData.isAnswered;
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
      headerTitle,

      isAnswered: shouldMarkAsAnswered ? true : cellData.isAnswered,
      modifier: this._activeModifier,
      question,
      answer,

      onClose:     () => this.close(),
      onIncorrect: () => void this._handleIncorrect(),
      onCorrect:   () => void this._handleCorrect(),

      onToggleAnswered: (checked) => {
        void this._updateCell({ isAnswered: checked });
      },

      onToggleModifier: async (checked) => {
        try {
          const modifier = checked ? CELL_MODIFIERS.FLIP_SCORE : null;
          await this._updateCell({
            modifier,
          });
          this._activeModifier = modifier;
          this.view._modifier = modifier;
        } catch (e) {
          console.error('[ModalService] toggle modifier failed:', e);
          alert(`${t('save_failed')}: ` + (e?.message || e));
          throw e;
        }
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
        if (nextMode !== 'view' || isAnswerShown) {
          this._pausePressCountdown();
          return;
        }

        this._resumePressCountdown();
      },

      onModifierAcknowledge: () => this.close(),
    });

    this.container.appendChild(this.view.el);

    if (isFlipScoreModifier(this._activeModifier)) {
      void this._applyFlipScoreModifierToCurrentPlayer();
    } else {
      this._bindPressRuntime();
    }
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

  close() {
    // Flush any pending debounced text saves before clearing activeCell
    clearTimeout(this._questionTimer);
    clearTimeout(this._answerTimer);
    clearTimeout(this._pressEnableTimer);
    clearTimeout(this._modifierCloseTimer);
    this._clearPressCountdown();
    this._questionTimer = null;
    this._answerTimer   = null;
    this._pressEnableTimer = null;
    this._modifierCloseTimer = null;
    const cell = this.activeCell;
    if (cell) {
      if (this._pendingQuestionText !== null) {
        void this._game.updateCell(cell.roundId, cell.rowId, cell.cellId, { question: { text: this._pendingQuestionText } });
        this._pendingQuestionText = null;
      }
      if (this._pendingAnswerText !== null) {
        void this._game.updateCell(cell.roundId, cell.rowId, cell.cellId, { answer: { text: this._pendingAnswerText } });
        this._pendingAnswerText = null;
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
    this._activeModifier = null;
    void this._pressRuntime?.closePress?.();
    if (this.container?.isConnected) this.container.innerHTML = '';

    // Targeted patch — only the closed cell's is-answered state updates
    this._game.touch(lastCell);
  }

  async _handleIncorrect() {
    if (!this._pressWinnerId || this._isResolvingPressResult) return;
    this._isResolvingPressResult = true;
    this._clearPressCountdown();
    try {
      await adjustPlayerScore(this._game.getGameId(), this._pressWinnerId, -this._cellValue);
    } catch (e) {
      console.error('[ModalService] adjustPlayerScore (incorrect) failed:', e);
    }
    // Reset press — modal stays open, another player can press
    await this._resetPressRuntime();
    this._isResolvingPressResult = false;
  }

  async _handleCorrect() {
    if (!this._pressWinnerId || this._isResolvingPressResult) return;
    this._isResolvingPressResult = true;
    try {
      await adjustPlayerScore(this._game.getGameId(), this._pressWinnerId, this._cellValue);
      await this._game?.setCurrentPlayerId?.(this._pressWinnerId);
    } catch (e) {
      console.error('[ModalService] correct resolution failed:', e);
    }
    this.close();
  }

  async _resetPressRuntime() {
    try {
      clearTimeout(this._pressEnableTimer);
      this._pressEnableTimer = null;

      this._isResettingPressRuntime = true;
      this._clearPressCountdown();
      this._pressTimerPaused = false;
      this._setPressWinner(null, '');
      await this._pressRuntime?.openPress?.();
    } catch (error) {
      console.error('[ModalService] Failed to reset press runtime:', error);
    }
  }

  _setPressWinner(winnerPlayerId = null, winnerName = '') {
    this._pressWinnerId = winnerPlayerId || null;
    this.view?.updateWinnerName?.(winnerName || '');
  }

  async _applyFlipScoreModifier(playerId) {
    if (!playerId) return false;

    const player = this._players?.getPlayers?.().find((entry) => String(entry?.id) === String(playerId));
    if (!player) {
      console.warn('[ModalService] could not find player for flip-score modifier:', playerId);
      return false;
    }

    await updatePlayer(this._game.getGameId(), playerId, { points: -(Number(player.points) || 0) });
    return true;
  }

  async _applyFlipScoreModifierToCurrentPlayer() {
    const currentPlayerId = this._game?.getCurrentPlayerId?.() ?? null;
    if (!currentPlayerId) {
      alert(t('flip_score_no_current_player'));
      this.close();
      return false;
    }

    try {
      const applied = await this._applyFlipScoreModifier(currentPlayerId);
      if (!applied) {
        alert(t('flip_score_no_current_player'));
        this.close();
        return false;
      }
      this._scheduleModifierClose();
      return applied;
    } catch (e) {
      console.error('[ModalService] auto-apply modifier failed:', e);
      alert(`${t('could_not_update_score')}: ` + (e?.message || e));
      this.close();
      throw e;
    }
  }

  _scheduleModifierClose(durationMs = MODIFIER_BANNER_SECONDS * 1000) {
    clearTimeout(this._modifierCloseTimer);
    this._modifierCloseTimer = setTimeout(() => {
      this._modifierCloseTimer = null;
      this.close();
    }, durationMs);
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

  destroy() {
    this.close();
    this._disposer.destroy();
    this.container = null;
  }
}

export function createModalService(gameService, mediaService, pressRuntime, playersService) {
  return new ModalService(gameService, mediaService, pressRuntime, playersService);
}
