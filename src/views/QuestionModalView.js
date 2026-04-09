// src/views/QuestionModalView.js
import { ViewDisposer } from '../utils/disposer.js';
import { bindOverlayDismiss } from '../utils/overlayDismiss.js';
import { CELL_MODIFIERS } from '../constants/cellModifiers.js';
import { buildModalDom } from './questionModal.template.js';
import { initMediaUI, applyModeUI, renderAll } from './questionModal.render.js';

export class QuestionModalView {
    constructor({
        mode,
        headerTitle,
        isAnswered,
        modifier,
        modifierPlayers,
        question,
        answer,
        onClose,
        onIncorrect,
        onCorrect,
        onToggleAnswered,
        onToggleModifier,
        onApplyModifier,
        onQuestionChange,
        onAnswerChange,
        onUploadMedia,
        onDeleteMedia,
        onAddAudio,
        onDeleteAudio,
        onViewStateChange,
    }) {
        this._mode          = mode;
        this._headerTitle   = (headerTitle || '').trim();
        this._winnerName    = '';
        this._isAnswered    = !!isAnswered;
        this._modifier      = modifier || null;
        this._modifierPlayers = Array.isArray(modifierPlayers) ? modifierPlayers.slice() : [];
        this._modifierApplyingPlayerId = null;
        this._question      = { ...(question || {}), audioFiles: question?.audioFiles || [] };
        this._answer        = { ...(answer   || {}), audioFiles: answer?.audioFiles   || [] };
        this._isAnswerShown = mode === 'edit';

        this._cb = {
            onClose, onIncorrect, onCorrect,
            onToggleAnswered, onToggleModifier, onApplyModifier, onQuestionChange, onAnswerChange,
            onUploadMedia, onDeleteMedia, onAddAudio, onDeleteAudio, onViewStateChange,
        };

        const { root, refs } = buildModalDom();
        this._root = root;
        this._refs = refs;

        this._mediaUI = {
            question: initMediaUI(refs.questionMediaHost),
            answer:   initMediaUI(refs.answerMediaHost)
        };

        this._disposer = new ViewDisposer();

        this._bindEvents();
        this._bindFullscreenEvents();

        applyModeUI(this, this._refs);
        renderAll(this, this._refs);

        // Result buttons start disabled — enabled only when a player claims the press
        if (this._refs.btnIncorrect) this._refs.btnIncorrect.disabled = true;
        if (this._refs.btnCorrect)   this._refs.btnCorrect.disabled   = true;

        this._prefetchMedia(this._question.media);
        this._prefetchMedia(this._answer.media);

        // Show loading overlay until all media is decoded and paint-ready
        this._showContentWhenReady();
    }

    get el() { return this._root; }

    triggerIncorrect() {
        this._refs.btnIncorrect?.click();
    }

    destroy() {
        // Pause + src-clear video before DOM removal — cleanest abort signal.
        // No video.load() call: it triggers extra async browser steps and
        // the element is about to be removed anyway.
        for (const type of ['question', 'answer']) {
            const video = this._refs[`${type}MediaHost`]?.querySelector('video');
            if (video?.src) {
                try { video.pause(); } catch {}
                video.removeAttribute('src');
            }
        }

        this._disposer.destroy();
        this._root?.remove();
    }

    // Called by ModalService after image/video upload or delete
    updateMedia(mediaType, media) {
        if (mediaType === 'question') {
            this._question.media = media;
        } else {
            this._answer.media = media;
        }

        renderAll(this, this._refs);
        this._prefetchMedia(media);
    }

    // Called by ModalService after audio add or delete
    updateAudioList(target, audioFiles) {
        if (target === 'question') this._question.audioFiles = audioFiles;
        else                       this._answer.audioFiles   = audioFiles;

        renderAll(this, this._refs);
    }

    // Show/hide upload progress overlay on the media block
    setUploading(target, isLoading) {
        const overlay  = this._refs[`${target}UploadOverlay`];
        const actions  = this._refs[`${target}MediaActions`];
        if (overlay) {
            overlay.hidden = !isLoading;
            overlay.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
        }
        if (actions) actions.classList.toggle('is-uploading', isLoading);
    }

    // Safe public accessor so ModalService doesn't reach into private state
    getAudioFiles(target) {
        const files = target === 'question' ? this._question.audioFiles : this._answer.audioFiles;
        return [...(files || [])];
    }

    updateAnsweredState(isAnswered) {
        this._isAnswered = !!isAnswered;
        if (this._refs.answeredCheckbox) this._refs.answeredCheckbox.checked = this._isAnswered;
    }

    updateModifierPlayers(players) {
        this._modifierPlayers = Array.isArray(players) ? players.slice() : [];
        renderAll(this, this._refs);
    }

    setModifierApplying(playerId = null) {
        this._modifierApplyingPlayerId = playerId || null;
        renderAll(this, this._refs);
    }

    updateWinnerName(name) {
        this._winnerName = (name || '').trim();

        const bannerTextEl = this._refs.pressBannerMain;
        if (bannerTextEl && this._winnerName) {
            bannerTextEl.textContent = `🔔 ${this._winnerName}`;
        }
        this.syncPressBannerVisibility({ animate: !!this._winnerName });

        // Enable/disable result buttons based on whether there is a winner
        const hasWinner = !!this._winnerName;
        if (this._refs.btnIncorrect) this._refs.btnIncorrect.disabled = !hasWinner;
        if (this._refs.btnCorrect)   this._refs.btnCorrect.disabled   = !hasWinner;
    }

    updatePressTimer(secondsRemaining) {
        const timerEl = this._refs.pressBannerTimer;
        if (!timerEl) return;

        const totalSeconds = Number.isFinite(secondsRemaining) ? Math.max(0, Math.ceil(secondsRemaining)) : null;
        if (totalSeconds === null) {
            timerEl.hidden = true;
            return;
        }

        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        timerEl.hidden = false;
    }

    syncPressBannerVisibility({ animate = false } = {}) {
        const bannerEl = this._refs.pressBanner;
        if (!bannerEl) return;

        const shouldShow = !!this._winnerName && !(this._mode === 'view' && this._isAnswerShown);
        if (!shouldShow) {
            bannerEl.hidden = true;
            bannerEl.classList.remove('is-visible');
            return;
        }

        bannerEl.hidden = false;
        if (animate) {
            bannerEl.classList.remove('is-visible');
            void bannerEl.offsetWidth;
        }
        bannerEl.classList.add('is-visible');
    }

    _bindFullscreenEvents() {
        const fsEvents = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];
        fsEvents.forEach(name => {
            this._disposer.addEventListener(document, name, () => {
                if (!this._isFullscreen() && this._root?.isConnected) {
                    setTimeout(() => this._refs.closeX?.focus(), 100);
                }
            });
        });
    }

    _isFullscreen() {
        return !!(
            document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement
        );
    }

    _bindEvents() {
        const r = this._refs;

        // ── Close ──────────────────────────────────────────────────────────────
        this._disposer.addEventListener(r.btnIncorrect, 'click', () => this._cb.onIncorrect?.());
        this._disposer.addEventListener(r.btnCorrect,   'click', () => this._cb.onCorrect?.());

        // ── Toggle mode button (view ↔ edit) ──────────────────────────────────
        this._disposer.addEventListener(r.btnToggleMode, 'click', () => {
            this._mode = this._mode === 'edit' ? 'view' : 'edit';
            if (this._mode === 'edit') this._isAnswerShown = true;
            applyModeUI(this, this._refs);
            renderAll(this, this._refs);
            this.syncPressBannerVisibility();
            this._cb.onViewStateChange?.({ mode: this._mode, isAnswerShown: this._isAnswerShown });
        });

        bindOverlayDismiss({
            disposer: this._disposer,
            overlay: r.overlay,
            onDismiss: () => this._cb.onClose?.(),
            shouldDismissOnEscape: () => !this._isFullscreen(),
        });

        // ── Answered toggle ────────────────────────────────────────────────────
        this._disposer.addEventListener(r.answeredCheckbox, 'change', (e) => {
            this._cb.onToggleAnswered?.(e.target.checked);
        });
        this._disposer.addEventListener(r.modifierCheckbox, 'change', async (e) => {
            const checked = !!e.target.checked;
            const prev = this._modifier;
            this._modifier = checked ? CELL_MODIFIERS.FLIP_SCORE : null;

            try {
                await this._cb.onToggleModifier?.(checked);
            } catch {
                this._modifier = prev;
                e.target.checked = prev;
                renderAll(this, this._refs);
            }
        });

        this._disposer.addEventListener(r.modifierPlayers, 'click', async (e) => {
            const button = e.target.closest('.qmodal__modifierPlayerBtn');
            if (!button || button.disabled) return;

            const playerId = button.dataset.playerId;
            this.setModifierApplying(playerId);
            try {
                await this._cb.onApplyModifier?.(playerId);
            } catch {
                this.setModifierApplying(null);
            }
        });

        // ── Media peek buttons (view mode: opens a lightbox overlay) ────────
        // The body uses overflow:hidden + flex layout, so there is no scrollable
        // space to reveal the mediaRow in-place. Instead we open a floating
        // lightbox that sits above everything (position:absolute inside dialog).
        for (const type of ['question', 'answer']) {
            const peekBtn = r[`${type}MediaPeekBtn`];
            if (!peekBtn) continue;

            this._disposer.addEventListener(peekBtn, 'click', () => {
                const media = type === 'question' ? this._question.media : this._answer.media;
                if (!media?.src) return;
                const dialog = this._root.querySelector('.qmodal__dialog');
                this._openMediaLightbox(media, dialog);
            });
        }

        // ── Question ↔ Answer toggle (view mode) ───────────────────────────────
        this._disposer.addEventListener(r.toggleAnswerBtn, 'click', () => {
            if (r.toggleAnswerBtn.disabled || this._mode !== 'view') return;
            this._isAnswerShown = !this._isAnswerShown;
            applyModeUI(this, this._refs);
            renderAll(this, this._refs);
            this.syncPressBannerVisibility();
            this._cb.onViewStateChange?.({ mode: this._mode, isAnswerShown: this._isAnswerShown });

            if (this._isAnswerShown) {
                requestAnimationFrame(() => {
                    r.answerSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                });
            }
        });

        // ── Text input ─────────────────────────────────────────────────────────
        // IMPORTANT: also update the view's own state so that subsequent
        // renderAll() calls (triggered e.g. by media upload completing) don't
        // overwrite the textarea with the old persisted value.
        this._disposer.addEventListener(r.questionTextInput, 'input', (e) => {
            this._question.text = e.target.value;
            this._cb.onQuestionChange?.(e.target.value);
        });
        this._disposer.addEventListener(r.answerTextInput, 'input', (e) => {
            this._answer.text = e.target.value;
            this._cb.onAnswerChange?.(e.target.value);
        });

        // ── Image / Video upload ───────────────────────────────────────────────
        this._disposer.addEventListener(r.questionUploadBtn, 'click', () => r.questionFile.click());
        this._disposer.addEventListener(r.answerUploadBtn,   'click', () => r.answerFile.click());

        this._disposer.addEventListener(r.questionFile, 'change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            this._cb.onUploadMedia?.(file, 'question');
            e.target.value = '';
        });
        this._disposer.addEventListener(r.answerFile, 'change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            this._cb.onUploadMedia?.(file, 'answer');
            e.target.value = '';
        });

        // ── Image / Video delete ───────────────────────────────────────────────
        this._disposer.addEventListener(r.questionDeleteBtn, 'click', () => {
            if (!this._question.media) return;
            this._cb.onDeleteMedia?.('question');
        });
        this._disposer.addEventListener(r.answerDeleteBtn, 'click', () => {
            if (!this._answer.media) return;
            this._cb.onDeleteMedia?.('answer');
        });

        // ── Audio upload ───────────────────────────────────────────────────────
        this._disposer.addEventListener(r.questionAddAudioBtn, 'click', () => r.questionAudioFile.click());
        this._disposer.addEventListener(r.answerAddAudioBtn,   'click', () => r.answerAudioFile.click());

        this._disposer.addEventListener(r.questionAudioFile, 'change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            this._cb.onAddAudio?.(file, 'question');
            e.target.value = '';
        });
        this._disposer.addEventListener(r.answerAudioFile, 'change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            this._cb.onAddAudio?.(file, 'answer');
            e.target.value = '';
        });

        // ── Audio delete (delegated on the list containers) ────────────────────
        this._disposer.addEventListener(r.questionAudioList, 'click', (e) => {
            const btn = e.target.closest('.qmodal__audioDeleteBtn');
            if (!btn) return;
            this._cb.onDeleteAudio?.(btn.dataset.filename, btn.dataset.target);
        });
        this._disposer.addEventListener(r.answerAudioList, 'click', (e) => {
            const btn = e.target.closest('.qmodal__audioDeleteBtn');
            if (!btn) return;
            this._cb.onDeleteAudio?.(btn.dataset.filename, btn.dataset.target);
        });
    }

    _openMediaLightbox(media, dialogEl) {
        // Build a full-dialog overlay (position:absolute inside the dialog)
        // so the media renders at the full dialog size regardless of the flex layout.
        const lb = document.createElement('div');
        lb.className = 'qmodal__mediaLightbox';
        lb.setAttribute('role', 'dialog');
        lb.setAttribute('aria-modal', 'true');
        lb.setAttribute('aria-label', 'Media preview');

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.type      = 'button';
        closeBtn.className = 'qmodal__mediaLightbox__close';
        closeBtn.setAttribute('aria-label', 'Close preview');
        closeBtn.textContent = '✕';

        // Media element
        let mediaEl;
        const mime = (media.mime || '').toLowerCase();
        if (mime.startsWith('video/')) {
            mediaEl = document.createElement('video');
            mediaEl.controls = true;
            mediaEl.src      = media.src;
        } else {
            mediaEl = document.createElement('img');
            mediaEl.alt = '';
            mediaEl.src = media.src;
        }
        mediaEl.className = 'qmodal__mediaLightbox__media';

        lb.append(closeBtn, mediaEl);
        (dialogEl || this._root).appendChild(lb);

        // Focus close button for keyboard users
        requestAnimationFrame(() => closeBtn.focus());

        const closeLightbox = () => {
            if (mediaEl.tagName === 'VIDEO') { try { mediaEl.pause(); } catch {} }
            lb.remove();
            document.removeEventListener('keydown', onKeyDown, true);
        };

        const onKeyDown = (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation(); // prevent the modal itself from closing
                closeLightbox();
            }
        };

        closeBtn.addEventListener('click', closeLightbox);
        // Clicking the backdrop (but not the media element) also closes
        lb.addEventListener('click', (e) => { if (e.target === lb) closeLightbox(); });
        // Capture-phase so it fires before the modal's own keydown handler
        document.addEventListener('keydown', onKeyDown, true);
    }

    _prefetchMedia(media) {
        if (!media?.src || !media?.mime?.startsWith('image/')) return;
        const img = new Image();
        img.decoding = 'async';
        img.src = media.src;
    }

    // ── Media loading overlay ──────────────────────────────────────────────
    // Shows a spinner over the whole dialog until every image/video that is
    // part of this cell is decoded and paint-ready. Falls back after 8 s so a
    // slow/broken file never blocks the user forever.
    //
    // Uses the actual <img>/<video> elements already in the DOM (created by
    // initMediaUI) — no orphan elements, no duplicate network requests.

    async _showContentWhenReady() {
        const waits = [];

        for (const type of ['question', 'answer']) {
            const media = this[`_${type}`]?.media;
            if (!media?.src || !media?.mime) continue;

            const host = this._refs[`${type}MediaHost`];
            if (!host) continue;

            const mime = (media.mime || '').toLowerCase();

            if (mime.startsWith('image/')) {
                const img = host.querySelector('img');
                if (img) waits.push(img.decode().catch(() => {}));
            } else if (mime.startsWith('video/')) {
                const video = host.querySelector('video');
                if (video) {
                    if (video.readyState >= 1 /* HAVE_METADATA */) {
                        // already ready — no wait needed
                    } else {
                        waits.push(new Promise(resolve => {
                            video.addEventListener('loadedmetadata', resolve, { once: true });
                            video.addEventListener('error',          resolve, { once: true });
                        }));
                    }
                }
            }
        }

        if (!waits.length) return; // text-only or audio-only cell

        // Build overlay
        const overlay = document.createElement('div');
        overlay.className = 'qmodal__mediaLoadOverlay';
        overlay.innerHTML = '<div class="qmodal__mediaLoadSpinner"></div>';

        const dialog = this._root.querySelector('.qmodal__dialog');
        dialog?.appendChild(overlay);

        // Wait for all media with an 8-second safety timeout
        const timeout = new Promise(r => setTimeout(r, 8000));
        await Promise.race([Promise.allSettled(waits), timeout]);

        // Fade out then remove
        overlay.classList.add('qmodal__mediaLoadOverlay--done');
        overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
        setTimeout(() => overlay.remove(), 300); // fallback if no transition fires
    }
}
