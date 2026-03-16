// src/views/questionModal.render.js

// ─── Media collapse threshold ────────────────────────────────────────────────
// If the space available for media (after text + audio fill their natural height)
// is less than this many px, media is hidden and replaced by a peek button.
const MEDIA_COLLAPSE_THRESHOLD = 150; // px

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
  const isEdit = view._mode === 'edit';

  refs.root?.classList.toggle('qmodal--edit', isEdit);

  if (refs.title) refs.title.textContent = view._headerTitle || 'Question';
  renderBuzzState(view, refs);
  setHidden(refs.headerQuizSpinner, !isEdit);

  // Toggle mode button: shows current mode and what clicking will do
  if (refs.btnToggleMode) {
    refs.btnToggleMode.textContent = isEdit ? '👁 View' : '✏ Edit';
  }

  for (const t of ['question', 'answer']) {
    setHidden(refs[`${t}TextView`],      isEdit);
    setHidden(refs[`${t}TextInput`],    !isEdit);
    setHidden(refs[`${t}MediaActions`], !isEdit);
  }

  setHidden(refs.toggleAnswerBtn, isEdit);
}

function renderBuzzState(view, refs) {
  const buzzEl = refs.buzzStatus;
  if (!buzzEl) return;

  const buzz = view._buzzState;
  if (!buzz?.status) {
    setHidden(buzzEl, true);
    buzzEl.textContent = '';
    buzzEl.className = 'qmodal__buzzStatus';
    return;
  }

  let label = '';
  const stateClass = buzz.status === 'buzzed'
    ? 'buzzed'
    : Date.now() >= new Date(buzz.enabledAt || 0).getTime()
      ? 'open'
      : 'pending';

  if (stateClass === 'pending') label = 'Buzz opens in 1s';
  else if (stateClass === 'open') label = 'Buzz is live';
  else if (stateClass === 'buzzed') label = buzz.winnerName ? `First: ${buzz.winnerName}` : 'First player locked';

  buzzEl.textContent = label;
  buzzEl.className = `qmodal__buzzStatus qmodal__buzzStatus--${stateClass}`;
  setHidden(buzzEl, !label);
}

export function applyAnswerVisibility(view, refs) {
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
      ? '👁️ Show question'
      : '👁️ Show answer';
  }
}

/* -------- Image / Video media slot -------- */

export function renderMedia(view, refs, type) {
  const media    = view[`_${type}`]?.media;
  const hasMedia = !!media?.src;

  view._mediaUI[type]?.set(media);
  setHidden(refs[`${type}MediaHostWrap`], !hasMedia);

  if (view._mode === 'edit') {
    const uploadBtn = refs[`${type}UploadBtn`];
    if (uploadBtn) uploadBtn.textContent = hasMedia ? '🔄 replace' : '⬆️ image/video';
    setHidden(refs[`${type}DeleteBtn`], !hasMedia);
  }
}

/* -------- Audio list (multiple tracks) -------- */

export function renderAudioList(view, refs, type) {
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

    const audioEl     = document.createElement('audio');
    audioEl.className = 'qmodal__audioTrack';
    audioEl.controls  = true;
    audioEl.preload   = 'metadata';
    audioEl.src       = audio.src || audio.url || '';
    item.appendChild(audioEl);

    if (isEdit) {
      const delBtn = document.createElement('button');
      delBtn.type             = 'button';
      delBtn.className        = 'qmodal__btn qmodal__btn--danger qmodal__audioDeleteBtn';
      delBtn.dataset.filename = audio.filename;
      delBtn.dataset.target   = type;
      delBtn.textContent      = '🗑️';
      delBtn.title            = 'Delete audio track';
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
    peekBtn.textContent = '📷 Show media';
  }
}

/* ------------------------ Render ------------------------ */

export function renderAll(view, refs) {
  if (refs.answeredCheckbox) {
    refs.answeredCheckbox.checked = !!view._isAnswered;
  }
  if (refs.quizSpinnerCheckbox) {
    refs.quizSpinnerCheckbox.checked = !!view._isQuizSpinner;
  }
  renderBuzzState(view, refs);

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
      refs.toggleAnswerBtn.textContent = '👁️ Show answer';
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

  // View-mode visibility
  if (view._mode === 'view') {
    setHidden(refs.questionTextView,      !qHasText);
    setHidden(refs.questionMediaHostWrap, !qHasMedia);
    setHidden(refs.answerTextView,        !aHasText);
    setHidden(refs.answerMediaHostWrap,   !aHasMedia);

    if (refs.toggleAnswerBtn) refs.toggleAnswerBtn.disabled = !aHasAny;
    if (!aHasAny) view._isAnswerShown = false;
  } else {
    if (refs.toggleAnswerBtn) refs.toggleAnswerBtn.disabled = false;
  }

  applyAnswerVisibility(view, refs);

  // Post-render: check whether media needs to collapse to a peek button.
  // Must run in a requestAnimationFrame so layout is settled and offsetHeight
  // values reflect the actual rendered dimensions.
  if (view._mode === 'view') {
    requestAnimationFrame(() => {
      checkMediaCollapse(view, refs, 'question');
      checkMediaCollapse(view, refs, 'answer');
      fitViewText(refs, 'question');
      fitViewText(refs, 'answer');
    });
  }
}
