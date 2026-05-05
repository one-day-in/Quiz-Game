// src/views/QuestionModalView.js
import { ViewDisposer } from '../utils/disposer.js';
import { bindOverlayDismiss } from '../utils/overlayDismiss.js';
import { buildModalDom } from './questionModal.template.js';
import { initMediaUI, applyModeUI, renderAll } from './questionModal.render.js';
import { t } from '../i18n.js';

export class QuestionModalView {
    constructor({
        mode,
        allowModeToggle = true,
        displayMode = 'host',
        headerTitle,
        directedBetState = null,
        activeModifierType = 'none',
        isAnswered,
        question,
        answer,
        onClose,
        onIncorrect,
        onCorrect,
        onToggleAnswered,
        onQuestionChange,
        onAnswerChange,
        onUploadMedia,
        onDeleteMedia,
        onAddAudio,
        onDeleteAudio,
        onViewStateChange,
        onControllerMediaControl,
        onDirectedBetAction,
        onModifierChange,
    }) {
        this._mode          = mode;
        this._allowModeToggle = !!allowModeToggle;
        this._displayMode   = displayMode;
        this._headerTitle   = (headerTitle || '').trim();
        this._directedBetState = directedBetState && typeof directedBetState === 'object'
            ? { ...directedBetState }
            : null;
        this._winnerName    = '';
        this._winnerPlayerId = null;
        this._hasWinner    = false;
        this._activeModifierType = String(activeModifierType || 'none');
        this._isAnswered    = !!isAnswered;
        this._question      = { ...(question || {}), audioFiles: question?.audioFiles || [] };
        this._answer        = { ...(answer   || {}), audioFiles: answer?.audioFiles   || [] };
        this._isAnswerShown = mode === 'edit';
        this._isPressBannerSuppressed = false;
        this._manualResolutionButtons = null;
        this._controllerMediaTarget = 'question';
        this._controllerMediaPlaying = false;

        this._cb = {
            onClose, onIncorrect, onCorrect,
            onToggleAnswered, onQuestionChange, onAnswerChange,
            onUploadMedia, onDeleteMedia, onAddAudio, onDeleteAudio, onViewStateChange, onControllerMediaControl,
            onDirectedBetAction, onModifierChange,
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
        this._syncModifierSelect();
        this.setControllerMediaPlaying(false);

        // Result buttons stay active in view mode for manual resolution parity.
        this._updateResolutionButtons();

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

    updateWinner(winnerPlayerId = null, winnerName = '') {
        this._winnerPlayerId = String(winnerPlayerId || '').trim() || null;
        this._winnerName = String(winnerName || '').trim();
        this._hasWinner = !!(this._winnerPlayerId || this._winnerName);
        const bannerName = this._winnerName || (this._hasWinner ? t('player_fallback') : '');

        const bannerTextEl = this._refs.pressBannerMain;
        if (bannerTextEl) {
            bannerTextEl.textContent = bannerName ? `🔔 ${bannerName}` : '';
        }
        this.syncPressBannerVisibility({ animate: this._hasWinner });

        // Enable/disable result buttons based on whether there is a winner
        this._updateResolutionButtons();
    }

    updateWinnerName(name) {
        this.updateWinner(this._winnerPlayerId, name);
    }

    setPressBannerSuppressed(suppressed) {
        this._isPressBannerSuppressed = !!suppressed;
        this.syncPressBannerVisibility();
    }

    setDirectedBetState(nextState) {
        this._directedBetState = nextState && typeof nextState === 'object' ? { ...nextState } : null;
        this._renderDirectedBetPanel();
        this.syncPressBannerVisibility();
    }

    setActiveModifierType(nextType = 'none') {
        this._activeModifierType = String(nextType || 'none');
        this._syncModifierSelect();
        renderAll(this, this._refs);
    }

    _syncModifierSelect() {
        const select = this._refs.modifierSelect;
        if (!select) return;
        select.value = this._activeModifierType || 'none';
    }

    async controlMedia(target, action) {
        const type = target || this.getMediaControlTarget();
        const mediaHost = this._refs[`${type}MediaHost`];
        const video = mediaHost?.querySelector('video:not([hidden])');
        const firstAudio = this._refs[`${type}AudioList`]?.querySelector('.qmodal__audioTrack');
        const normalizedAction = action === 'pause' ? 'pause' : (action === 'stop' ? 'stop' : 'play');

        if (video) {
            if (normalizedAction === 'play') {
                try {
                    await video.play();
                } catch (error) {
                    // Remote control from another device may hit autoplay policy.
                    // Retry muted for video as a best-effort fallback.
                    try {
                        const prevMuted = !!video.muted;
                        video.muted = true;
                        await video.play();
                        if (video.paused) video.muted = prevMuted;
                    } catch {
                        console.warn('[QuestionModal] video playback failed:', error);
                    }
                }
                return !video.paused;
            }
            try {
                video.pause();
                if (normalizedAction === 'stop') video.currentTime = 0;
            } catch {}
            return false;
        }

        if (!firstAudio) return false;
        if (normalizedAction === 'play') {
            try { await firstAudio.play(); } catch (error) {
                console.warn('[QuestionModal] audio playback failed:', error);
            }
            return !firstAudio.paused;
        }
        try {
            firstAudio.pause();
            if (normalizedAction === 'stop') firstAudio.currentTime = 0;
        } catch {}
        return false;
    }

    getMediaControlTarget() {
        if (this._displayMode === 'controller') return this._controllerMediaTarget || 'question';
        if (this._mode === 'view' && this._isAnswerShown) return 'answer';
        return 'question';
    }

    setControllerMediaTarget(target) {
        this._controllerMediaTarget = target === 'answer' ? 'answer' : 'question';
    }

    setAnswerShown(isShown) {
        this._isAnswerShown = !!isShown;
        applyModeUI(this, this._refs);
        renderAll(this, this._refs);
        this.syncPressBannerVisibility();
    }

    setViewState({ mode = 'view', isAnswerShown = false } = {}) {
        this._mode = String(mode || 'view').toLowerCase() === 'edit' ? 'edit' : 'view';
        if (this._mode === 'edit') {
            this._isAnswerShown = true;
        } else {
            this._isAnswerShown = !!isAnswerShown;
        }
        applyModeUI(this, this._refs);
        renderAll(this, this._refs);
        this.syncPressBannerVisibility();
    }

    toggleAnswerVisibility() {
        if (this._mode !== 'view') return;
        this._isAnswerShown = !this._isAnswerShown;
        applyModeUI(this, this._refs);
        renderAll(this, this._refs);
        this.syncPressBannerVisibility();
        this._cb.onViewStateChange?.({ mode: this._mode, isAnswerShown: this._isAnswerShown });
    }

    setControllerMediaPlaying(isPlaying) {
        this._controllerMediaPlaying = !!isPlaying;
        const toggleBtn = this._refs.controllerMediaToggleBtn;
        if (!toggleBtn) return;

        if (this._controllerMediaPlaying) {
            toggleBtn.dataset.action = 'pause';
            toggleBtn.textContent = '❚❚';
            toggleBtn.setAttribute('aria-label', t('pause_media'));
            toggleBtn.setAttribute('title', t('pause_media'));
        } else {
            toggleBtn.dataset.action = 'play';
            toggleBtn.textContent = '▶';
            toggleBtn.setAttribute('aria-label', t('play_media'));
            toggleBtn.setAttribute('title', t('play_media'));
        }
    }

    setResolutionButtonsEnabled(enabled = null) {
        this._manualResolutionButtons = typeof enabled === 'boolean' ? enabled : null;
        this._updateResolutionButtons();
    }

    updatePressTimer(secondsRemaining) {
        const timerEl = this._refs.pressBannerTimer;
        if (!timerEl) return;

        const totalSeconds = Number.isFinite(secondsRemaining) ? Math.max(0, Math.ceil(secondsRemaining)) : null;
        if (totalSeconds === null) {
            timerEl.hidden = false;
            timerEl.classList.add('is-idle');
            timerEl.setAttribute('aria-hidden', 'true');
            return;
        }

        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        timerEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        timerEl.hidden = false;
        timerEl.classList.remove('is-idle');
        timerEl.setAttribute('aria-hidden', 'false');
    }

    syncPressBannerVisibility({ animate = false } = {}) {
        const bannerEl = this._refs.pressBanner;
        if (!bannerEl) return;

        const isDirectedBetAnswering = String(this._directedBetState?.phase || '').trim().toLowerCase() === 'answering';
        bannerEl.classList.toggle(
            'qmodal__pressBanner--compact',
            this._displayMode !== 'controller' && this._mode === 'view' && isDirectedBetAnswering
        );

        if (this._displayMode === 'controller') {
            bannerEl.hidden = true;
            bannerEl.classList.remove('is-visible');
            return;
        }

        const shouldShow = !this._isPressBannerSuppressed && this._hasWinner && !(this._mode === 'view' && this._isAnswerShown);
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

    _renderDirectedBetPanel() {
        const panel = this._refs.directedBetPanel;
        if (!panel) return;

        const state = this._directedBetState;
        const enabled = !!(state?.enabled);
        panel.hidden = !enabled;
        panel.setAttribute('aria-hidden', enabled ? 'false' : 'true');
        if (!enabled) {
            panel.classList.remove('is-visible');
            return;
        }
        panel.classList.add('is-visible');

        const playersWrap = this._refs.directedBetPlayers;
        const emptyEl = this._refs.directedBetEmpty;
        const startBtn = this._refs.directedBetStartBtn;
        const stakesWrap = this._refs.directedBetStakes;
        const players = Array.isArray(state?.players) ? state.players : [];
        const selectedPlayerId = String(state?.selectedPlayerId || '');
        const selectedStake = Number(state?.selectedStake) || 0;
        const canStart = !!state?.canStart;

        if (playersWrap) {
            playersWrap.innerHTML = '';
            for (const player of players) {
                const id = String(player?.id || '').trim();
                if (!id) continue;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'qmodal__btn qmodal__btn--secondary qmodal__directedBetPlayerBtn';
                btn.dataset.playerId = id;
                btn.textContent = String(player?.name || '');
                if (id === selectedPlayerId) btn.classList.add('is-selected');
                if (state?.phase !== 'select') btn.disabled = true;
                playersWrap.appendChild(btn);
            }
        }

        if (emptyEl) {
            const showEmpty = players.length === 0;
            emptyEl.hidden = !showEmpty;
            emptyEl.setAttribute('aria-hidden', showEmpty ? 'false' : 'true');
        }

        if (stakesWrap) {
            stakesWrap.querySelectorAll('.qmodal__directedBetStakeBtn').forEach((el) => {
                const stake = Number(el?.dataset?.stake) || 0;
                el.classList.toggle('is-selected', stake === selectedStake);
                el.disabled = state?.phase !== 'select';
            });
        }

        if (startBtn) {
            startBtn.disabled = !canStart;
        }
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
            if (this._displayMode === 'controller' || !this._allowModeToggle) return;
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
            closeOnEscape: false,
        });

        // ── Modifier selector (edit mode) ─────────────────────────────────────────
        this._disposer.addEventListener(r.modifierSelect, 'change', (e) => {
            const nextType = String(e.target?.value || 'none');
            this.setActiveModifierType(nextType);
            this._cb.onModifierChange?.(nextType);
        });

        // ── Answered toggle ────────────────────────────────────────────────────
        this._disposer.addEventListener(r.answeredCheckbox, 'change', (e) => {
            this._cb.onToggleAnswered?.(e.target.checked);
        });
        this._disposer.addEventListener(this._root, 'click', (e) => {
            const button = e.target.closest('.qmodal__controllerMediaBtn');
            if (!button) return;
            const action = button.dataset.action || 'play';
            this._cb.onControllerMediaControl?.({
                action,
                // Let host resolve the active target from its own modal state.
                // Controller view can be one message behind while answer toggle syncs.
                target: this._displayMode === 'controller' ? '' : this.getMediaControlTarget(),
            });
            if (action === 'play') this.setControllerMediaPlaying(true);
            if (action === 'pause' || action === 'stop') this.setControllerMediaPlaying(false);
        });
        this._disposer.addEventListener(r.controllerAnswerToggleBtn, 'click', () => {
            if (this._displayMode === 'controller' && this._mode === 'view') {
                // Optimistic local update for instant target switch while host sync arrives.
                this._isAnswerShown = !this._isAnswerShown;
                this.setControllerMediaTarget(this._isAnswerShown ? 'answer' : 'question');
                applyModeUI(this, this._refs);
                renderAll(this, this._refs);
                this.syncPressBannerVisibility();
            }
            this._cb.onControllerMediaControl?.({
                action: 'toggle_answer',
                target: this.getMediaControlTarget(),
            });
        });
        this._disposer.addEventListener(this._root, 'click', (e) => {
            const playerBtn = e.target.closest('.qmodal__directedBetPlayerBtn');
            if (playerBtn) {
                this._cb.onDirectedBetAction?.({
                    type: 'select_player',
                    playerId: playerBtn.dataset.playerId || '',
                });
                return;
            }

            const stakeBtn = e.target.closest('.qmodal__directedBetStakeBtn');
            if (stakeBtn) {
                this._cb.onDirectedBetAction?.({
                    type: 'select_stake',
                    stake: Number(stakeBtn.dataset.stake) || 0,
                });
                return;
            }

            if (e.target.closest('.qmodal__directedBetStartBtn')) {
                this._cb.onDirectedBetAction?.({ type: 'start' });
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
            this.toggleAnswerVisibility();

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

        this._renderDirectedBetPanel();
    }

    _updateResolutionButtons() {
        const enabled = this._manualResolutionButtons ?? (this._mode === 'view');
        if (this._refs.btnIncorrect) this._refs.btnIncorrect.disabled = !enabled;
        if (this._refs.btnCorrect) this._refs.btnCorrect.disabled = !enabled;
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
            mediaEl.preload = 'metadata';
            mediaEl.playsInline = true;
            mediaEl.setAttribute('playsinline', '');
            mediaEl.setAttribute('webkit-playsinline', '');
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
