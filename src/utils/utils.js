// public/src/utils/utils.js
export function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export const GRID_CONFIG = {
  ROWS: 5,
  COLS: 5,
  MIN_VALUE: 100,
  VALUE_STEP: 100
};

export function getCellValueByCol(col) {
  const { MIN_VALUE, VALUE_STEP } = GRID_CONFIG;
  return MIN_VALUE + (Number(col) * VALUE_STEP);
}
