import { GRID_CONFIG, getCellValueByCol } from '../utils/utils.js';
import { t } from '../i18n.js';

// ---------- helpers ----------

function setTopicCellText(el, topic) {
  const topicText = (topic || '').trim();

  // Keep span between renders (so fitText doesn't break)
  let span = el.querySelector(':scope > span');
  if (!span) {
    span = document.createElement('span');
    el.appendChild(span);
  }

  if (!topicText || /^Topic \d+$/.test(topicText)) {
    el.classList.add('is-empty');
    span.textContent = t('add_topic');
  } else {
    el.classList.remove('is-empty');
    span.textContent = topicText;
  }
}

function renderTopicCellFromModel(el, model, roundId, row) {
  setTopicCellText(el, model.getTopic(roundId, row) || '');
}

function resetTopicCellContent(el) {
  el.querySelector('input.topic-editor')?.remove();
  el.querySelector(':scope > span')?.remove();
}

// ---------- view ----------

export function GameGridView({ model, uiState, roundId, onCellClick, onTopicChange }) {
  const root = document.createElement('main');
  root.className = 'game-grid';

  const inner = document.createElement('div');
  inner.className = 'game-grid__inner';
  root.appendChild(inner);

  if (!model) return root;

  const { ROWS, COLS } = GRID_CONFIG;

  const grid = document.createElement('div');
  grid.className = 'grid';

  for (let row = 0; row < ROWS; row++) {

    // ---------- Topic cell ----------
    const topicCell = document.createElement('div');
    topicCell.className = 'cell cell-topic';

    renderTopicCellFromModel(topicCell, model, roundId, row);

    // ✏ edit button — always visible in top-right corner of the topic cell
    const editTopicBtn = document.createElement('button');
    editTopicBtn.type = 'button';
    editTopicBtn.className = 'cell-topic__editBtn';
    editTopicBtn.setAttribute('aria-label', t('edit_topic'));
    editTopicBtn.textContent = '✏';
    topicCell.appendChild(editTopicBtn);

    const openTopicEditor = () => {
      if (topicCell.querySelector('input.topic-editor')) return;

      const currentTopic = model.getTopic(roundId, row) || '';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'topic-editor';
      input.value = currentTopic;
      input.placeholder = t('edit_topic');

      // Replace content with input (keep editBtn out of the way)
      const span = topicCell.querySelector('span');
      if (span) span.remove();
      editTopicBtn.remove();
      topicCell.classList.remove('is-empty');
      topicCell.appendChild(input);

      input.focus();
      input.select();

      let committed = false;

      const closeFromModel = () => {
        resetTopicCellContent(topicCell);
        renderTopicCellFromModel(topicCell, model, roundId, row);
        topicCell.appendChild(editTopicBtn);
      };

      const commit = () => {
        if (committed) return;
        committed = true;

        const next = input.value.trim();
        const prev = (currentTopic || '').trim();

        if (next === prev) {
          closeFromModel();
          return;
        }

        resetTopicCellContent(topicCell);
        setTopicCellText(topicCell, next);
        topicCell.appendChild(editTopicBtn);
        onTopicChange?.(roundId, row, next);
      };

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { ev.preventDefault(); committed = true; closeFromModel(); }
      });

      input.addEventListener('blur', commit);
    };

    editTopicBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openTopicEditor();
    });

    grid.appendChild(topicCell);

    // ---------- Question cells ----------
    for (let col = 0; col < COLS; col++) {
      const value = getCellValueByCol(col);

      const cellEl = document.createElement('div');
      cellEl.className = 'cell cell-question';
      cellEl.dataset.cell = `r${row}c${col}`;

      // Text in span — fitText targets it
      const span = document.createElement('span');
      span.textContent = value;
      cellEl.appendChild(span);

      const cell = model.getCell(roundId, row, col);

      if (!cell?.question?.text) {
        cellEl.classList.add('question-empty');
      }

      if (cell?.isAnswered) {
        cellEl.classList.add('is-answered');
      }

      cellEl.addEventListener('click', (e) => {
        e.stopPropagation();
        onCellClick?.({ roundId, rowId: row, cellId: col, value });
      });

      grid.appendChild(cellEl);
    }
  }

  inner.appendChild(grid);
  return root;
}
