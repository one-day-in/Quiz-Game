const THEME_KEY = 'quiz-game:ui-theme';
const DEFAULT_THEME = 'base';
const listeners = new Set();

const supportedThemes = Object.freeze(['base', 'skillcore', 'play-listen']);

function canUseStorage() {
  if (typeof window === 'undefined') return false;
  try {
    return typeof window.localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function getSupportedThemes() {
  return [...supportedThemes];
}

export function getTheme() {
  if (!canUseStorage()) return DEFAULT_THEME;
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return supportedThemes.includes(stored) ? stored : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function applyThemeToDocument(theme) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

export function setTheme(nextTheme) {
  const normalized = supportedThemes.includes(nextTheme) ? nextTheme : DEFAULT_THEME;
  if (canUseStorage()) {
    try {
      window.localStorage.setItem(THEME_KEY, normalized);
    } catch {
      // Keep app functional when storage is blocked/unavailable.
    }
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
