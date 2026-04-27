// src/views/questionModal.render.js
import { t } from '../i18n.js';

// ─── Media collapse threshold ────────────────────────────────────────────────
// If the space available for media (after text + audio fill their natural height)
// is less than this many px, media is hidden and replaced by a peek button.
const MEDIA_COLLAPSE_THRESHOLD = 150; // px

const PLAY_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M8 6.5v11l9-5.5z"></path>
  </svg>
`;

const PAUSE_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 6h4v12H7zM13 6h4v12h-4z"></path>
  </svg>
`;

function pauseOtherAudioTracks(currentAudioEl) {
  document.querySelectorAll('.qmodal__audioTrack').forEach((audioEl) => {
    if (audioEl !== currentAudioEl) {
      try { audioEl.pause(); } catch {}
    }
  });
}

function formatAudioTime(seconds) {
  const totalSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function createAudioPlayer(audio = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'qmodal__audioPlayer';

  const audioEl = document.createElement('audio');
  audioEl.className = 'qmodal__audioTrack';
  audioEl.preload = 'metadata';
  audioEl.playsInline = true;
  audioEl.src = audio.src || audio.url || '';

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'qmodal__audioPlayBtn';
  playBtn.setAttribute('aria-label', 'Play audio');
  playBtn.innerHTML = `<span class="qmodal__audioPlayIcon">${PLAY_ICON}</span>`;

  const body = document.createElement('div');
  body.className = 'qmodal__audioBody';

  const header = document.createElement('div');
  header.className = 'qmodal__audioHeader';

  const time = document.createElement('span');
  time.className = 'qmodal__audioTime';
  time.textContent = '0:00 / 0:00';

  const progress = document.createElement('input');
  progress.className = 'qmodal__audioProgress';
  progress.type = 'range';
  progress.min = '0';
  progress.max = '1';
  progress.step = '0.01';
  progress.value = '0';
  progress.setAttribute('aria-label', 'Audio progress');

  header.append(time);
  body.append(header, progress);
  wrap.append(playBtn, body, audioEl);

  const syncUI = () => {
    const isPlaying = !audioEl.paused && !audioEl.ended;
    wrap.classList.toggle('is-playing', isPlaying);
    playBtn.innerHTML = `<span class="qmodal__audioPlayIcon">${isPlaying ? PAUSE_ICON : PLAY_ICON}</span>`;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause audio' : 'Play audio');

    const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
    const currentTime = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0;
    if (duration > 0) {
      progress.value = String(Math.min(1, currentTime / duration));
    } else {
      progress.value = '0';
    }
    time.textContent = `${formatAudioTime(currentTime)} / ${formatAudioTime(duration)}`;
  };

  playBtn.addEventListener('click', async () => {
    try {
      if (!audioEl.paused && !audioEl.ended) {
        audioEl.pause();
      } else {
        pauseOtherAudioTracks(audioEl);
        await audioEl.play();
      }
    } catch (error) {
      console.warn('[QuestionModal] audio playback failed:', error);
    } finally {
      syncUI();
    }
  });

  progress.addEventListener('input', () => {
    const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : 0;
    if (duration <= 0) return;
    audioEl.currentTime = Number(progress.value) * duration;
    syncUI();
  });

  audioEl.addEventListener('loadedmetadata', syncUI);
  audioEl.addEventListener('timeupdate', syncUI);
  audioEl.addEventListener('play', syncUI);
  audioEl.addEventListener('pause', syncUI);
  audioEl.addEventListener('ended', () => {
    audioEl.currentTime = 0;
    syncUI();
  });

  syncUI();
  return { wrap, audioEl };
}

/* ------------------------ Media UI (image / video) ------------------------ */

export function initMediaUI(host) {
  if (!host) return null;

  const img   = document.createElement('img');
  const video = document.createElement('video');

  img.className     = 'qmodal__media qmodal__media--img';
  img.fetchPriority = 'high'; // hint browser to prioritise this fetch
  video.className   = 'qmodal__media qmodal__media--video';
  video.controls    = true;
  video.preload     = 'metadata';
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('webkit-playsinline', '');

  host.append(img, video);

  function hideAll() {
    [img, video].forEach(el => {
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
    });
  }

  function clearSources() {
    img.removeAttribute('src');
    try { video.pause(); } catch {}
    video.removeAttribute('src');
    video.load();
  }

  function show(el) {
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');
  }

  function set(media) {
    hideAll();
    clearSources();
    if (!media?.src) return;
    const mime = (media.mime || '').toLowerCase();
    if      (mime.startsWith('image/')) { img.src   = media.src; show(img);   }
    else if (mime.startsWith('video/')) { video.src = media.src; show(video); }
    // audio is rendered in the audio list, not here
  }

  hideAll();
  clearSources();
  return { set };
}

/* ------------------------ helpers ------------------------ */

function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = !!hidden;
  el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
}

function hasText(v) {
  return !!(v && v.trim().length);
}

function fitViewText(refs, type) {
  const textEl = refs[`${type}TextView`];
  if (!textEl || textEl.hidden) return;

  textEl.style.fontSize = '';

  const maxHeight = textEl.clientHeight || textEl.parentElement?.clientHeight || 0;
  if (maxHeight <= 0) return;

  let size = parseFloat(window.getComputedStyle(textEl).fontSize);
  const minSize = 16;

  while (textEl.scrollHeight > maxHeight && size > minSize) {
    size -= 1;
    textEl.style.fontSize = `${size}px`;
  }
}

/* ------------------------ Mode UI ------------------------ */

export function applyModeUI(view, refs) {
  const isController = view._displayMode === 'controller';
  const isEdit = view._mode === 'edit';

  refs.root?.classList.toggle('qmodal--edit', isEdit);
  refs.root?.classList.toggle('qmodal--controller', isController);

  if (refs.title) refs.title.textContent = view._headerTitle || t('question');

  // Toggle mode button: shows current mode and what clicking will do
  if (refs.btnToggleMode) {
    refs.btnToggleMode.textContent = isEdit ? `👁 ${t('view')}` : `✏ ${t('edit')}`;
    setHidden(refs.btnToggleMode, isController);
  }

  for (const t of ['question', 'answer']) {
    setHidden(refs[`${t}TextView`],      isEdit);
    setHidden(refs[`${t}TextInput`],    !isEdit);
    setHidden(refs[`${t}MediaActions`], !isEdit);
  }

  setHidden(refs.toggleAnswerBtn, isEdit || isController);
  setHidden(refs.answeredToggle, isController);
  setHidden(refs.footerLeft, false);
  setHidden(refs.controllerSharedMediaControls, !isController);
  setHidden(refs.btnIncorrect,   isEdit);
  setHidden(refs.btnCorrect,     isEdit);
}

export function applyAnswerVisibility(view, refs) {
  if (view._displayMode === 'controller') {
    setHidden(refs.questionSection, false);
    setHidden(refs.answerSection, false);
    return;
  }

  if (view._mode !== 'view') {
    // Edit mode: both sections always visible
    setHidden(refs.questionSection, false);
    setHidden(refs.answerSection,   false);
    return;
  }

  setHidden(refs.answerSection,   !view._isAnswerShown);
  setHidden(refs.questionSection,  !!view._isAnswerShown);

  if (refs.toggleAnswerBtn) {
    refs.toggleAnswerBtn.textContent = view._isAnswerShown
      ? `👁️ ${t('show_question')}`
      : `👁️ ${t('show_answer')}`;
  }
}

/* -------- Image / Video media slot -------- */

export function renderMedia(view, refs, type) {
  const media    = view[`_${type}`]?.media;
  const hasMedia = !!media?.src;
  const mediaMime = (media?.mime || '').toLowerCase();
  const hasVideoMedia = hasMedia && mediaMime.startsWith('video/');
  const isController = view._displayMode === 'controller';

  view._mediaUI[type]?.set(media);
  setHidden(refs[`${type}MediaHostWrap`], isController || !hasMedia);

  if (view._mode === 'edit') {
    const uploadBtn = refs[`${type}UploadBtn`];
    if (uploadBtn) uploadBtn.textContent = hasMedia ? `🔄 ${t('replace')}` : `⬆️ ${t('image_video')}`;
    setHidden(refs[`${type}DeleteBtn`], !hasMedia);
  }
}

/* -------- Audio list (multiple tracks) -------- */

export function renderAudioList(view, refs, type) {
  if (view._displayMode === 'controller') {
    const listEl = refs[`${type}AudioList`];
    if (listEl) listEl.hidden = true;
    return;
  }

  const audioFiles = view[`_${type}`]?.audioFiles || [];
  const listEl     = refs[`${type}AudioList`];
  if (!listEl) return;

  listEl.innerHTML = '';

  if (!audioFiles.length) {
    listEl.hidden = true;
    return;
  }

  listEl.hidden = false;

  const isEdit = view._mode === 'edit';

  for (const audio of audioFiles) {
    const item    = document.createElement('div');
    item.className        = 'qmodal__audioItem';
    item.dataset.filename = audio.filename;

    const player = createAudioPlayer(audio);
    item.appendChild(player.wrap);

    if (isEdit) {
      const delBtn = document.createElement('button');
      delBtn.type             = 'button';
      delBtn.className        = 'qmodal__btn qmodal__btn--danger qmodal__audioDeleteBtn';
      delBtn.dataset.filename = audio.filename;
      delBtn.dataset.target   = type;
      delBtn.textContent      = '🗑️';
      delBtn.title            = t('delete_audio_track');
      item.appendChild(delBtn);
    }

    listEl.appendChild(item);
  }
}

/* ─── Media collapse check (view mode) ─────────────────────────────────────
 * Called via requestAnimationFrame after renderAll so we can measure real
 * layout heights. If the available vertical space for the media is less than
 * MEDIA_COLLAPSE_THRESHOLD, the media row is hidden and a peek button is
 * shown in its place. The user can click the button to reveal media inline.
 * ─────────────────────────────────────────────────────────────────────────── */

function checkMediaCollapse(view, refs, type) {
  if (view._mode !== 'view') return;

  const data      = view[`_${type}`];
  const mediaWrap = refs[`${type}MediaHostWrap`];
  const peekBtn   = refs[`${type}MediaPeekBtn`];
  if (!mediaWrap || !peekBtn) return;

  // Find the containing mediaRow (to hide/show it as a unit)
  const mediaRow = mediaWrap.closest('.qmodal__mediaRow');
  if (!mediaRow) return;

  // Always reset to uncollapsed first, then re-evaluate
  mediaRow.hidden = false;
  peekBtn.hidden  = true;

  // Nothing to collapse if there is no media
  if (!data?.media?.src) return;

  const bodyEl    = refs.body;
  const textEl    = refs[`${type}TextView`];
  const audioList = refs[`${type}AudioList`];
  if (!bodyEl) return;

  // Measure available space for media
  // bodyEl has 24px top + 24px bottom padding = 48px vertical
  const bodyH   = bodyEl.clientHeight;
  const bodyPad = 48;
  const textH   = (textEl  && !textEl.hidden)   ? textEl.offsetHeight   : 0;
  const audioH  = (audioList && !audioList.hidden) ? audioList.offsetHeight : 0;

  // 16px gap between each pair of visible flex siblings in sectionContent
  const gapAboveMedia = textH  > 0 ? 16 : 0; // gap: text → media
  const gapBelowMedia = audioH > 0 ? 16 : 0; // gap: media → audio

  const available = bodyH - bodyPad - textH - audioH - gapAboveMedia - gapBelowMedia;

  if (available < MEDIA_COLLAPSE_THRESHOLD) {
    mediaRow.hidden     = true;
    peekBtn.hidden      = false;
    peekBtn.textContent = `📷 ${t('show_media')}`;
  }
}

function applyAudioLayoutState(refs, type, { isHero = false, trackCount = 0 } = {}) {
  const listEl = refs[`${type}AudioList`];
  if (!listEl) return;
  listEl.classList.toggle('qmodal__audioList--hero', !!isHero);
  listEl.classList.toggle('qmodal__audioList--multi', trackCount > 1);
}

/* ------------------------ Render ------------------------ */

export function renderAll(view, refs) {
  if (refs.answeredCheckbox) {
    refs.answeredCheckbox.checked = !!view._isAnswered;
  }

  view.syncPressBannerVisibility?.();

  // Gather content state for both sections
  const sections = {
    question: {
      text:  view._question?.text || '',
      media: view._question?.media,
      audio: view._question?.audioFiles || [],
    },
    answer: {
      text:  view._answer?.text || '',
      media: view._answer?.media,
      audio: view._answer?.audioFiles || [],
    },
  };

  const qHasText  = hasText(sections.question.text);
  const aHasText  = hasText(sections.answer.text);
  const qHasMedia = !!sections.question.media?.src;
  const aHasMedia = !!sections.answer.media?.src;
  const qHasAudio = sections.question.audio.length > 0;
  const aHasAudio = sections.answer.audio.length   > 0;
  const qHasAny   = qHasText || qHasMedia || qHasAudio;
  const aHasAny   = aHasText || aHasMedia || aHasAudio;
  const isController = view._displayMode === 'controller';
  const qMediaMime = (sections.question.media?.mime || '').toLowerCase();
  const aMediaMime = (sections.answer.media?.mime || '').toLowerCase();
  const qHasPlayableMedia = (qHasMedia && (qMediaMime.startsWith('video/') || qMediaMime.startsWith('audio/'))) || qHasAudio;
  const aHasPlayableMedia = (aHasMedia && (aMediaMime.startsWith('video/') || aMediaMime.startsWith('audio/'))) || aHasAudio;
  const hasAnyPlayableMedia = qHasPlayableMedia || aHasPlayableMedia;
  const qHeroAudio = view._mode === 'view' && !qHasText && !qHasMedia && qHasAudio;
  const aHeroAudio = view._mode === 'view' && !aHasText && !aHasMedia && aHasAudio;

  if (view._mode === 'view') {
    if (!aHasAny) view._isAnswerShown = false;
    else if (!qHasAny && aHasAny) view._isAnswerShown = true;
  }

  // Empty state (view mode only)
  const showEmpty = view._mode === 'view' && !(qHasAny || aHasAny);
  setHidden(refs.emptyState, !showEmpty);

  if (showEmpty) {
    view._isAnswerShown = false;
    setHidden(refs.questionSection,       true);
    setHidden(refs.answerSection,         true);
    setHidden(refs.questionMediaHostWrap, true);
    setHidden(refs.answerMediaHostWrap,   true);
    if (refs.toggleAnswerBtn) {
      refs.toggleAnswerBtn.disabled    = true;
      refs.toggleAnswerBtn.textContent = `👁️ ${t('show_answer')}`;
    }
    return;
  }

  // Render text + media + audio for both sections
  for (const [t, text, hasT] of [
    ['question', sections.question.text, qHasText],
    ['answer',   sections.answer.text,   aHasText],
  ]) {
    const textView  = refs[`${t}TextView`];
    const textInput = refs[`${t}TextInput`];
    if (textView) {
      textView.textContent = text;
      textView.classList.toggle('qmodal__text--empty', !hasT);
    }
    if (textInput) textInput.value = text;
  }

  renderMedia(view, refs, 'question');
  renderMedia(view, refs, 'answer');
  renderAudioList(view, refs, 'question');
  renderAudioList(view, refs, 'answer');
  applyAudioLayoutState(refs, 'question', {
    isHero: qHeroAudio,
    trackCount: sections.question.audio.length,
  });
  applyAudioLayoutState(refs, 'answer', {
    isHero: aHeroAudio,
    trackCount: sections.answer.audio.length,
  });

  // View-mode visibility
  if (view._mode === 'view') {
    setHidden(refs.questionTextView,      !qHasText);
    setHidden(refs.questionMediaHostWrap, isController || !qHasMedia);
    setHidden(refs.answerTextView,        !aHasText);
    setHidden(refs.answerMediaHostWrap,   isController || !aHasMedia);
    setHidden(refs.questionMediaPeekBtn, isController || !qHasMedia);
    setHidden(refs.answerMediaPeekBtn, isController || !aHasMedia);
    setHidden(refs.controllerSharedMediaControls, !isController || !hasAnyPlayableMedia);
    if (refs.controllerAnswerToggleBtn) {
      const showAnswer = !view._isAnswerShown;
      refs.controllerAnswerToggleBtn.textContent = `👁️ ${showAnswer ? t('show_answer') : t('show_question')}`;
      refs.controllerAnswerToggleBtn.setAttribute('aria-label', showAnswer ? t('show_answer') : t('show_question'));
      refs.controllerAnswerToggleBtn.setAttribute('title', showAnswer ? t('show_answer') : t('show_question'));
      refs.controllerAnswerToggleBtn.disabled = !aHasAny;
      setHidden(refs.controllerAnswerToggleBtn, !isController);
    }
    if (isController && !hasAnyPlayableMedia) {
      view.setControllerMediaPlaying?.(false);
    }

    if (refs.toggleAnswerBtn) refs.toggleAnswerBtn.disabled = !aHasAny;
    if (!aHasAny) view._isAnswerShown = false;
  } else {
    if (refs.toggleAnswerBtn) refs.toggleAnswerBtn.disabled = false;
    setHidden(refs.controllerSharedMediaControls, true);
    setHidden(refs.controllerAnswerToggleBtn, true);
    if (isController) view.setControllerMediaPlaying?.(false);
  }

  applyAnswerVisibility(view, refs);

  // Post-render: check whether media needs to collapse to a peek button.
  // Must run in a requestAnimationFrame so layout is settled and offsetHeight
  // values reflect the actual rendered dimensions.
  if (view._mode === 'view' && !isController) {
    requestAnimationFrame(() => {
      checkMediaCollapse(view, refs, 'question');
      checkMediaCollapse(view, refs, 'answer');
      fitViewText(refs, 'question');
      fitViewText(refs, 'answer');
    });
  }
}
