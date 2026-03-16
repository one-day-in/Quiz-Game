import { isQuizSpinnerMedia } from '../constants/quizSpinnerMedia.js';
import { QuestionModalView } from '../views/QuestionModalView.js';
import { Disposer } from '../utils/disposer.js';
import { showConfirm } from '../utils/confirm.js';
import { getGameRuntime, subscribeToGameRuntime } from '../api/gameApi.js';

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
    const t =
      this._game?.getModel?.()?.getTopic?.(roundId, rowId) ??
      topic ??
      '';

    const topicPart = (t || '').trim() || 'No topic';

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

      onClose: () => this.close(),

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
          alert('Error applying Quiz Spinner template: ' + (e?.message || e));
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
          alert('Error uploading media: ' + (e?.message || e));
          throw e;
        } finally {
          this.view?.setUploading(target, false);
        }
      },

      onDeleteMedia: async (target) => {
        if (!await showConfirm({ message: 'Delete media?' })) return;

        this.view.setUploading(target, true);
        try {
          await this._media.deleteFromCell({
            target,
            ...this.activeCell
          });
          this.view.updateMedia(target, null);
        } catch (e) {
          console.error('[ModalService] delete media failed:', e);
          alert('Error deleting media: ' + (e?.message || e));
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
          alert('Error uploading audio: ' + (e?.message || e));
        } finally {
          this.view?.setUploading(target, false);
        }
      },

      onDeleteAudio: async (filename, target) => {
        if (!await showConfirm({ message: 'Delete audio track?' })) return;

        this.view.setUploading(target, true);
        try {
          await this._media.deleteAudioFromCell({
            filename, target, ...this.activeCell
          });
          this.view.updateAudioList(target, this.view.getAudioFiles(target).filter(f => f.filename !== filename));
        } catch (e) {
          console.error('[ModalService] delete audio failed:', e);
          alert('Error deleting audio: ' + (e?.message || e));
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
      if (!silent) alert('Save failed. Please try again.');
      throw error;
    }
  }

  close() {
    // Flush any pending debounced text saves before clearing activeCell
    clearTimeout(this._questionTimer);
    clearTimeout(this._answerTimer);
    this._questionTimer = null;
    this._answerTimer   = null;
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
    void this._game.setPressEnabled(false);
    if (this.container?.isConnected) this.container.innerHTML = '';

    // Targeted patch — only the closed cell's is-answered state updates
    this._game.touch(lastCell);
  }

  async _resetPressRuntime() {
    try {
      await this._game.setPressEnabled(true);
      const runtime = await getGameRuntime(this._game.getGameId());
      this.view?.updateWinnerName(runtime?.winnerName || '');
    } catch (error) {
      console.error('[ModalService] Failed to reset press runtime:', error);
    }
  }

  _bindPressRuntime() {
    const gameId = this._game.getGameId();
    if (!gameId) return;

    this._stopRuntimeSubscription?.();
    this._stopRuntimeSubscription = subscribeToGameRuntime(gameId, (runtime) => {
      this.view?.updateWinnerName(runtime?.winnerName || '');
    });
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
