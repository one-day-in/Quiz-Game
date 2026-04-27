import { GRID_CONFIG, getCellValueByCol } from '../utils/utils.js';
import { t } from '../i18n.js';
import { CELL_MODIFIERS, getCellModifierOptions } from '../constants/cellModifiers.js';

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
  el.querySelector('.topic-editor')?.remove();
  el.querySelector(':scope > span')?.remove();
}

function getModifierBadgeText(modifier) {
  if (modifier === CELL_MODIFIERS.FLIP_SCORE) return '+/-';
  if (modifier === CELL_MODIFIERS.STEAL_LEADER_POINTS) return '1000';
  if (modifier === CELL_MODIFIERS.DIRECTED_BET) return 'BET';
  return '';
}

export function applyQuestionCellState(el, cell, modifierLabelMap = new Map()) {
  const isAnswered = !!cell?.isAnswered;
  el.classList.toggle('is-answered', isAnswered);

  const modifier = String(cell?.modifier || '').trim();
  const modifierLabel = modifierLabelMap.get(modifier) || '';
  const hasModifier = Boolean(modifier && modifierLabel);

  el.classList.toggle('has-modifier', hasModifier);
  if (!hasModifier) {
    el.removeAttribute('data-modifier');
    el.removeAttribute('title');
    el.querySelector('.cell-question__modifier')?.remove();
    return;
  }

  el.dataset.modifier = modifier;
  el.title = `${t('cell_modifier_banner_title')}: ${modifierLabel}`;

  let badge = el.querySelector('.cell-question__modifier');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'cell-question__modifier';
    badge.setAttribute('aria-hidden', 'true');
    el.appendChild(badge);
  }
  badge.textContent = getModifierBadgeText(modifier);
}

// ---------- view ----------

export function GameGridView({ model, uiState, roundId, onCellClick, onTopicChange, isReadOnly = false }) {
  const root = document.createElement('main');
  root.className = 'game-grid';

  const inner = document.createElement('div');
  inner.className = 'game-grid__inner';
  root.appendChild(inner);

  if (!model) return root;

  const { ROWS, COLS } = GRID_CONFIG;
  const modifierLabelMap = new Map(
    getCellModifierOptions(t)
      .filter((option) => option.value)
      .map((option) => [option.value, option.label])
  );

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
    if (!isReadOnly) {
      topicCell.appendChild(editTopicBtn);
    }

    const openTopicEditor = () => {
      if (isReadOnly || topicCell.querySelector('.topic-editor')) return;

      const currentTopic = model.getTopic(roundId, row) || '';

      const input = document.createElement('textarea');
      input.className = 'topic-editor';
      input.value = currentTopic;
      input.placeholder = t('edit_topic');
      input.rows = 3;
      input.setAttribute('aria-label', t('edit_topic'));

      // Replace content with input (keep editBtn out of the way)
      const span = topicCell.querySelector('span');
      if (span) span.remove();
      editTopicBtn.remove();
      topicCell.classList.remove('is-empty');
      topicCell.appendChild(input);

      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);

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
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
          ev.preventDefault();
          commit();
        }
        if (ev.key === 'Escape') { ev.preventDefault(); committed = true; closeFromModel(); }
      });

      input.addEventListener('blur', commit);
    };

    if (!isReadOnly) {
      editTopicBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openTopicEditor();
      });
    }

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

      applyQuestionCellState(cellEl, cell, modifierLabelMap);

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
