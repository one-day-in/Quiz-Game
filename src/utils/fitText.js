// src/utils/fitText.js

const DEFAULTS = {
  widthRatio:  0.85,
  heightRatio: 0.50,
  minSize:     6,
  step:        0.5,
  noWrap:      true,
  respectMinSizeOnStart: false,
};

/**
 * Shrinks textEl font size to fit inside box.
 * box — the container (defines dimensions), textEl — the element with text.
 */
export function fitTextToBox(box, textEl, options = {}) {
  if (!box || !textEl) return;

  const opts = { ...DEFAULTS, ...options };
  const { widthRatio, heightRatio, minSize, step, noWrap, respectMinSizeOnStart } = opts;

  textEl.style.whiteSpace = noWrap ? 'nowrap' : '';

  const maxW = box.clientWidth  * widthRatio;
  const maxH = box.clientHeight * (opts.heightRatio ?? 1);

  // Element not in DOM yet — skip
  if (maxW <= 0 || maxH <= 0) return;

  const startSize = box.clientHeight * heightRatio;
  let size = respectMinSizeOnStart ? Math.max(startSize, minSize) : startSize;
  textEl.style.fontSize = size + 'px';

  while (
    (textEl.scrollWidth > maxW || textEl.scrollHeight > maxH) &&
    size > minSize
  ) {
    size -= step;
    textEl.style.fontSize = size + 'px';
  }
}

/**
 * Fits text in the first <span> of a cell.
 */
export function fitTextToCell(cell, options = {}) {
  const span = cell.querySelector(':scope > span');
  if (!span) return;
  fitTextToBox(cell, span, options);
}

/**
 * Topic cell — text may wrap.
 */
export function fitTopicCell(cell) {
  fitTextToCell(cell, {
    widthRatio:  0.88,
    heightRatio: 0.38,
    noWrap:      false,
    minSize:     8,
  });
}

/**
 * Value cell (100, 200…) — single line.
 */
export function fitValueCell(cell) {
  fitTextToCell(cell, {
    widthRatio:  0.80,
    heightRatio: 0.52,
    noWrap:      true,
    minSize:     10,
  });
}

/**
 * Fit all cells inside a container.
 */
export function fitAllCells(container) {
  if (!container) return;
  container.querySelectorAll('.cell-topic').forEach(fitTopicCell);
  container.querySelectorAll('.cell-question').forEach(fitValueCell);
}
