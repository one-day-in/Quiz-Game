import { isQuizSpinnerMedia } from '../constants/quizSpinnerMedia.js';
import { QuestionModalView } from '../views/QuestionModalView.js';
import { Disposer } from '../utils/disposer.js';
import { showConfirm } from '../utils/confirm.js';
import { adjustPlayerScore, getGameRuntime, subscribeToGameRuntime } from '../api/gameApi.js';
import { t } from '../i18n.js';

export class ModalService {
  constructor(gameService, mediaService) {
    this._game = gameService;
    this._media = mediaService;

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

    void this._resetPressRuntime();

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
      isQuizSpinner: isQuizSpinnerMedia(question.media),
      question,
      answer,

      onClose:     () => this.close(),
      onIncorrect: () => void this._handleIncorrect(),
      onCorrect:   () => void this._handleCorrect(),

      onToggleAnswered: (checked) => {
        void this._updateCell({ isAnswered: checked });
      },

      onToggleQuizSpinner: async (checked) => {
        try {
          const media = await this._media.toggleQuizSpinnerOnQuestion({
            enabled: checked,
            ...this.activeCell
          });
          this.view.updateMedia('question', media);
        } catch (e) {
          console.error('[ModalService] toggle quiz spinner failed:', e);
          alert(`${t('quiz_spinner_error')}: ` + (e?.message || e));
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
      }
    });

    this.container.appendChild(this.view.el);
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

  close() {
    // Flush any pending debounced text saves before clearing activeCell
    clearTimeout(this._questionTimer);
    clearTimeout(this._answerTimer);
    clearTimeout(this._pressEnableTimer);
    this._questionTimer = null;
    this._answerTimer   = null;
    this._pressEnableTimer = null;
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
    void this._game.setPressEnabled(false);
    if (this.container?.isConnected) this.container.innerHTML = '';

    // Targeted patch — only the closed cell's is-answered state updates
    this._game.touch(lastCell);
  }

  async _handleIncorrect() {
    if (!this._pressWinnerId) return;
    try {
      await adjustPlayerScore(this._game.getGameId(), this._pressWinnerId, -this._cellValue);
    } catch (e) {
      console.error('[ModalService] adjustPlayerScore (incorrect) failed:', e);
    }
    // Reset press — modal stays open, another player can press
    await this._resetPressRuntime();
  }

  async _handleCorrect() {
    if (!this._pressWinnerId) return;
    try {
      await adjustPlayerScore(this._game.getGameId(), this._pressWinnerId, this._cellValue);
    } catch (e) {
      console.error('[ModalService] adjustPlayerScore (correct) failed:', e);
    }
    this.close();
  }

  async _resetPressRuntime() {
    try {
      clearTimeout(this._pressEnableTimer);
      this._pressEnableTimer = null;

      await this._game.setPressEnabled(false);
      const runtime = await getGameRuntime(this._game.getGameId());
      this._pressWinnerId = runtime?.winnerPlayerId || null;
      this.view?.updateWinnerName(runtime?.winnerName || '');
      this._pressEnableTimer = window.setTimeout(() => {
        void this._game.setPressEnabled(true);
      }, 2000);
    } catch (error) {
      console.error('[ModalService] Failed to reset press runtime:', error);
    }
  }

  _bindPressRuntime() {
    const gameId = this._game.getGameId();
    if (!gameId) return;

    const emitRuntime = async () => {
      try {
        const runtime = await getGameRuntime(gameId);
        this._pressWinnerId = runtime?.winnerPlayerId || null;
        this.view?.updateWinnerName(runtime?.winnerName || '');
      } catch (_) {}
    };

    this._stopRuntimeSubscription?.();

    // Realtime fires instantly when DB changes (requires realtime enabled on game_runtime table)
    const stopSub = subscribeToGameRuntime(gameId, (runtime) => {
      this._pressWinnerId = runtime?.winnerPlayerId || null;
      this.view?.updateWinnerName(runtime?.winnerName || '');
    });

    // Polling fallback at 800ms in case realtime is not configured for game_runtime
    const pollTimer = window.setInterval(emitRuntime, 800);

    this._stopRuntimeSubscription = () => {
      stopSub?.();
      clearInterval(pollTimer);
    };
  }

  destroy() {
    this.close();
    this._disposer.destroy();
    this.container = null;
  }
}

export function createModalService(gameService, mediaService) {
  return new ModalService(gameService, mediaService);
}
