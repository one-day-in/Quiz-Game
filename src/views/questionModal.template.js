// src/views/questionModal.template.js
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
          <div class="qmodal__headerWinner" hidden></div>
        </div>

        <div class="qmodal__headerActions">
          <label class="qmodal__headerToggle">
            <input type="checkbox" class="qmodal__quizSpinnerInput">
            <span>Quiz Spinner</span>
          </label>

          <!-- Right: toggle view/edit mode -->
          <button
            class="qmodal__btn qmodal__btn--ghost qmodal__btnToggleMode"
            type="button"
          >✏ Edit</button>
        </div>
      </header>

      <!-- BODY -->
      <section class="qmodal__body">
        <div class="qmodal__emptyState">✏️ is empty</div>

        <!-- QUESTION -->
        <div class="qmodal__section qmodal__questionSection">

          <div class="qmodal__sectionLabel">Question</div>

          <div class="qmodal__sectionContent">

            <!-- Left: text block -->
            <div class="qmodal__textBlock">
              <div class="qmodal__text qmodal__questionText"></div>
              <textarea
                class="qmodal__textarea qmodal__questionInput"
                placeholder="Type your question..."
              ></textarea>
            </div>

            <!-- Right: media block -->
            <div class="qmodal__mediaBlock">

              <!-- Upload progress overlay (edit mode) -->
              <div class="qmodal__uploadOverlay qmodal__questionUploadOverlay" hidden aria-hidden="true">
                <div class="qmodal__uploadRing"></div>
                <span class="qmodal__uploadText">Uploading…</span>
              </div>

              <!-- Edit-mode controls -->
              <div class="qmodal__mediaActions qmodal__questionMediaActions">
                <input class="qmodal__file qmodal__questionFile" type="file" hidden accept="image/*,video/*">
                <button type="button" class="qmodal__btn qmodal__btn--primary qmodal__btn--mediaAction qmodal__questionUploadBtn" title="Upload image or video">⬆️ image/video</button>
                <input class="qmodal__file qmodal__questionAudioFile" type="file" hidden accept="audio/*">
                <button type="button" class="qmodal__btn qmodal__btn--secondary qmodal__btn--mediaAction qmodal__questionAddAudioBtn" title="Add audio track">🎵 add audio</button>
              </div>

              <!-- Image / Video player + delete -->
              <div class="qmodal__mediaRow qmodal__audioItem">
                <div class="qmodal__mediaHostWrap qmodal__questionMediaHostWrap">
                  <div class="qmodal__mediaHost" data-media="question"></div>
                </div>
                <button type="button" class="qmodal__btn qmodal__btn--danger qmodal__audioDeleteBtn qmodal__mediaDeleteBtn qmodal__questionDeleteBtn" title="Delete media" hidden aria-hidden="true">🗑️</button>
              </div>

              <!-- Audio list (visible in both edit and view modes) -->
              <div class="qmodal__audioList qmodal__questionAudioList" hidden></div>

              <!-- Peek button: view mode only, shown by JS when text is too long
                   for media to display comfortably (< 150 px available height) -->
              <button type="button" class="qmodal__mediaPeekBtn qmodal__questionMediaPeekBtn" hidden>
                📷 Show media
              </button>

            </div>
          </div>
        </div>

        <!-- ANSWER -->
        <div class="qmodal__section qmodal__answerSection">

          <div class="qmodal__sectionLabel">Answer</div>

          <div class="qmodal__sectionContent">

            <!-- Left: text block -->
            <div class="qmodal__textBlock">
              <div class="qmodal__text qmodal__answerText"></div>
              <textarea
                class="qmodal__textarea qmodal__answerInput"
                placeholder="Type your answer..."
              ></textarea>
            </div>

            <!-- Right: media block -->
            <div class="qmodal__mediaBlock">

              <!-- Upload progress overlay (edit mode) -->
              <div class="qmodal__uploadOverlay qmodal__answerUploadOverlay" hidden aria-hidden="true">
                <div class="qmodal__uploadRing"></div>
                <span class="qmodal__uploadText">Uploading…</span>
              </div>

              <!-- Edit-mode controls -->
              <div class="qmodal__mediaActions qmodal__answerMediaActions">
                <input class="qmodal__file qmodal__answerFile" type="file" hidden accept="image/*,video/*">
                <button type="button" class="qmodal__btn qmodal__btn--primary qmodal__btn--mediaAction qmodal__answerUploadBtn" title="Upload image or video">⬆️ image/video</button>
                <input class="qmodal__file qmodal__answerAudioFile" type="file" hidden accept="audio/*">
                <button type="button" class="qmodal__btn qmodal__btn--secondary qmodal__btn--mediaAction qmodal__answerAddAudioBtn" title="Add audio track">🎵 add audio</button>
              </div>

              <!-- Image / Video player + delete -->
              <div class="qmodal__mediaRow qmodal__audioItem">
                <div class="qmodal__mediaHostWrap qmodal__answerMediaHostWrap">
                  <div class="qmodal__mediaHost" data-media="answer"></div>
                </div>
                <button type="button" class="qmodal__btn qmodal__btn--danger qmodal__audioDeleteBtn qmodal__mediaDeleteBtn qmodal__answerDeleteBtn" title="Delete media" hidden aria-hidden="true">🗑️</button>
              </div>

              <!-- Audio list (visible in both edit and view modes) -->
              <div class="qmodal__audioList qmodal__answerAudioList" hidden></div>

              <!-- Peek button: view mode only, shown by JS when text is too long -->
              <button type="button" class="qmodal__mediaPeekBtn qmodal__answerMediaPeekBtn" hidden>
                📷 Show media
              </button>

            </div>
          </div>
        </div>

      </section>

      <!-- FOOTER — same in both modes: Answered + Show answer (view only) + Done -->
      <footer class="qmodal__footer">
        <label class="qmodal__toggle">
          <input type="checkbox" class="qmodal__toggleInput">
          <span>Answered</span>
        </label>

        <button type="button" class="qmodal__btn qmodal__btnToggleAnswer">
          👁️ Show answer
        </button>

        <button type="button" class="qmodal__btn qmodal__btn--primary qmodal__btnClose">
          ✅ Done
        </button>
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
      winner:             qs('.qmodal__headerWinner'),
      headerQuizSpinner:  qs('.qmodal__headerToggle'),
      quizSpinnerCheckbox: qs('.qmodal__quizSpinnerInput'),
      btnToggleMode:      qs('.qmodal__btnToggleMode'),
      closeDone:          qs('.qmodal__btnClose'),
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
