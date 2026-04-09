// src/views/questionModal.template.js
import { t } from '../i18n.js';

export function buildModalDom() {
  const root = document.createElement('div');
  root.className = 'qmodal';

  root.innerHTML = `
    <div class="qmodal__overlay"></div>

    <div class="qmodal__dialog" role="dialog" aria-modal="true">

      <!-- HEADER — same in both modes -->
      <header class="qmodal__header">
        <!-- Center: title -->
        <div class="qmodal__headerMain">
          <div class="qmodal__headerTitle"></div>
        </div>

        <div class="qmodal__headerActions">
          <label class="qmodal__headerToggle">
            <input type="checkbox" class="qmodal__modifierInput">
            <span>${t('flip_score_modifier')}</span>
          </label>

          <!-- Right: toggle view/edit mode -->
          <button
            class="qmodal__btn qmodal__btn--ghost qmodal__btnToggleMode"
            type="button"
          >✏ ${t('edit')}</button>
        </div>
      </header>

      <!-- BODY -->
      <section class="qmodal__body">
        <!-- PRESS WINNER BANNER — absolute overlay over body content -->
        <div class="qmodal__pressBanner" hidden aria-live="polite">
          <div class="qmodal__pressBannerMain"></div>
          <div class="qmodal__pressBannerTimer" hidden>00:30</div>
        </div>
        <div class="qmodal__emptyState">✏️ is empty</div>

          <!-- QUESTION -->
          <div class="qmodal__section qmodal__questionSection">

            <div class="qmodal__sectionLabel">${t('question')}</div>

            <div class="qmodal__sectionContent">

              <!-- Left: text block -->
              <div class="qmodal__textBlock">
                <div class="qmodal__text qmodal__questionText"></div>
                <textarea
                  class="qmodal__textarea qmodal__questionInput"
                  placeholder="${t('question')}"
                ></textarea>
              </div>

              <!-- Right: media block -->
              <div class="qmodal__mediaBlock">

                <!-- Upload progress overlay (edit mode) -->
                <div class="qmodal__uploadOverlay qmodal__questionUploadOverlay" hidden aria-hidden="true">
                  <div class="qmodal__uploadRing"></div>
                  <span class="qmodal__uploadText">${t('uploading')}</span>
                </div>

                <!-- Edit-mode controls -->
                <div class="qmodal__mediaActions qmodal__questionMediaActions">
                  <input class="qmodal__file qmodal__questionFile" type="file" hidden accept="image/*,video/*">
                  <button type="button" class="qmodal__btn qmodal__btn--primary qmodal__btn--mediaAction qmodal__questionUploadBtn" title="${t('image_video')}">⬆️ ${t('image_video')}</button>
                  <input class="qmodal__file qmodal__questionAudioFile" type="file" hidden accept="audio/*">
                  <button type="button" class="qmodal__btn qmodal__btn--secondary qmodal__btn--mediaAction qmodal__questionAddAudioBtn" title="${t('add_audio')}">🎵 ${t('add_audio')}</button>
                </div>

                <!-- Image / Video player + delete -->
                <div class="qmodal__mediaRow">
                  <div class="qmodal__mediaHostWrap qmodal__questionMediaHostWrap">
                    <div class="qmodal__mediaHost" data-media="question"></div>
                  </div>
                  <button type="button" class="qmodal__btn qmodal__btn--danger qmodal__audioDeleteBtn qmodal__mediaDeleteBtn qmodal__questionDeleteBtn" title="${t('delete_media')}" hidden aria-hidden="true">🗑️</button>
                </div>

                <!-- Audio list (visible in both edit and view modes) -->
                <div class="qmodal__audioList qmodal__questionAudioList" hidden></div>

                <!-- Peek button: view mode only, shown by JS when text is too long
                     for media to display comfortably (< 150 px available height) -->
                <button type="button" class="qmodal__mediaPeekBtn qmodal__questionMediaPeekBtn" hidden>
                  📷 ${t('show_media')}
                </button>

              </div>
            </div>
          </div>

          <!-- ANSWER -->
          <div class="qmodal__section qmodal__answerSection">

            <div class="qmodal__sectionLabel">${t('answer')}</div>

            <div class="qmodal__sectionContent">

              <!-- Left: text block -->
              <div class="qmodal__textBlock">
                <div class="qmodal__text qmodal__answerText"></div>
                <textarea
                  class="qmodal__textarea qmodal__answerInput"
                  placeholder="${t('answer')}"
                ></textarea>
              </div>

              <!-- Right: media block -->
              <div class="qmodal__mediaBlock">

                <!-- Upload progress overlay (edit mode) -->
                <div class="qmodal__uploadOverlay qmodal__answerUploadOverlay" hidden aria-hidden="true">
                  <div class="qmodal__uploadRing"></div>
                  <span class="qmodal__uploadText">${t('uploading')}</span>
                </div>

                <!-- Edit-mode controls -->
                <div class="qmodal__mediaActions qmodal__answerMediaActions">
                  <input class="qmodal__file qmodal__answerFile" type="file" hidden accept="image/*,video/*">
                  <button type="button" class="qmodal__btn qmodal__btn--primary qmodal__btn--mediaAction qmodal__answerUploadBtn" title="${t('image_video')}">⬆️ ${t('image_video')}</button>
                  <input class="qmodal__file qmodal__answerAudioFile" type="file" hidden accept="audio/*">
                  <button type="button" class="qmodal__btn qmodal__btn--secondary qmodal__btn--mediaAction qmodal__answerAddAudioBtn" title="${t('add_audio')}">🎵 ${t('add_audio')}</button>
                </div>

                <!-- Image / Video player + delete -->
                <div class="qmodal__mediaRow">
                  <div class="qmodal__mediaHostWrap qmodal__answerMediaHostWrap">
                    <div class="qmodal__mediaHost" data-media="answer"></div>
                  </div>
                  <button type="button" class="qmodal__btn qmodal__btn--danger qmodal__audioDeleteBtn qmodal__mediaDeleteBtn qmodal__answerDeleteBtn" title="${t('delete_media')}" hidden aria-hidden="true">🗑️</button>
                </div>

                <!-- Audio list (visible in both edit and view modes) -->
                <div class="qmodal__audioList qmodal__answerAudioList" hidden></div>

                <!-- Peek button: view mode only, shown by JS when text is too long -->
                <button type="button" class="qmodal__mediaPeekBtn qmodal__answerMediaPeekBtn" hidden>
                  📷 ${t('show_media')}
                </button>

              </div>
            </div>
          </div>
      </section>

      <!-- FOOTER — same in both modes: Answered + Show answer (view only) + result placeholders -->
      <footer class="qmodal__footer">

        <!-- Left: Answered toggle + Show answer -->
        <div class="qmodal__footerLeft">
          <label class="qmodal__toggle">
            <input type="checkbox" class="qmodal__toggleInput">
            <span>${t('answered')}</span>
          </label>

          <button type="button" class="qmodal__btn qmodal__btnToggleAnswer">
            👁️ ${t('show_answer')}
          </button>
        </div>

        <!-- Right: result buttons (equal width, side by side) -->
        <div class="qmodal__footerRight">
          <button type="button" class="qmodal__btn qmodal__btn--danger qmodal__btnIncorrect">
            ✕ ${t('not_correct')}
          </button>

          <button type="button" class="qmodal__btn qmodal__btn--primary qmodal__btnCorrect">
            ✓ ${t('correct')}
          </button>
        </div>

      </footer>
    </div>
  `;

  const qs = (sel) => root.querySelector(sel);

  return {
    root,
    refs: {
      root,
      body:               qs('.qmodal__body'),
      overlay:            qs('.qmodal__overlay'),
      title:              qs('.qmodal__headerTitle'),
      pressBanner:        qs('.qmodal__pressBanner'),
      pressBannerMain:    qs('.qmodal__pressBannerMain'),
      pressBannerTimer:   qs('.qmodal__pressBannerTimer'),
      headerModifier:     qs('.qmodal__headerToggle'),
      modifierCheckbox:   qs('.qmodal__modifierInput'),
      btnToggleMode:      qs('.qmodal__btnToggleMode'),
      btnIncorrect:       qs('.qmodal__btnIncorrect'),
      btnCorrect:         qs('.qmodal__btnCorrect'),
      answeredCheckbox:   qs('.qmodal__toggleInput'),
      toggleAnswerBtn:    qs('.qmodal__btnToggleAnswer'),
      emptyState:         qs('.qmodal__emptyState'),

      questionSection:        qs('.qmodal__questionSection'),
      questionTextView:       qs('.qmodal__questionText'),
      questionTextInput:      qs('.qmodal__questionInput'),
      questionMediaHost:      qs('[data-media="question"]'),
      questionMediaHostWrap:  qs('.qmodal__questionMediaHostWrap'),
      questionUploadOverlay:  qs('.qmodal__questionUploadOverlay'),
      questionMediaActions:   qs('.qmodal__questionMediaActions'),
      questionUploadBtn:      qs('.qmodal__questionUploadBtn'),
      questionDeleteBtn:      qs('.qmodal__questionDeleteBtn'),
      questionFile:           qs('.qmodal__questionFile'),
      questionAddAudioBtn:    qs('.qmodal__questionAddAudioBtn'),
      questionAudioFile:      qs('.qmodal__questionAudioFile'),
      questionAudioList:      qs('.qmodal__questionAudioList'),
      questionMediaPeekBtn:  qs('.qmodal__questionMediaPeekBtn'),

      answerSection:          qs('.qmodal__answerSection'),
      answerTextView:         qs('.qmodal__answerText'),
      answerTextInput:        qs('.qmodal__answerInput'),
      answerMediaHost:        qs('[data-media="answer"]'),
      answerMediaHostWrap:    qs('.qmodal__answerMediaHostWrap'),
      answerUploadOverlay:    qs('.qmodal__answerUploadOverlay'),
      answerMediaActions:     qs('.qmodal__answerMediaActions'),
      answerUploadBtn:        qs('.qmodal__answerUploadBtn'),
      answerDeleteBtn:        qs('.qmodal__answerDeleteBtn'),
      answerFile:             qs('.qmodal__answerFile'),
      answerAddAudioBtn:      qs('.qmodal__answerAddAudioBtn'),
      answerAudioFile:        qs('.qmodal__answerAudioFile'),
      answerAudioList:        qs('.qmodal__answerAudioList'),
      answerMediaPeekBtn:     qs('.qmodal__answerMediaPeekBtn'),
    }
  };
}
