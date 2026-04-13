const THEME_KEY = 'quiz-game:ui-theme';
const DEFAULT_THEME = 'base';
const listeners = new Set();

const supportedThemes = Object.freeze(['base', 'skillcore', 'play-listen']);

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getSupportedThemes() {
  return [...supportedThemes];
}

export function getTheme() {
  if (!canUseStorage()) return DEFAULT_THEME;
  const stored = window.localStorage.getItem(THEME_KEY);
  return supportedThemes.includes(stored) ? stored : DEFAULT_THEME;
}

function applyThemeToDocument(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(nextTheme) {
  const normalized = supportedThemes.includes(nextTheme) ? nextTheme : DEFAULT_THEME;
  if (canUseStorage()) {
    window.localStorage.setItem(THEME_KEY, normalized);
  }
  applyThemeToDocument(normalized);
  listeners.forEach((listener) => listener(normalized));
  return normalized;
}

export function initThemeFromStorage() {
  const theme = getTheme();
  applyThemeToDocument(theme);
  return theme;
}

export function subscribeTheme(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
