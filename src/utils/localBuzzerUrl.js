const LOCAL_BUZZER_URL_KEY = 'quiz-game:local-buzzer-url';
const BUZZER_MODE_KEY = 'quiz-game:buzzer-mode';

function canUseStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function normalizeBuzzerUrl(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';

  const withProtocol = /^[a-z]+:\/\//i.test(raw) ? raw : `ws://${raw}`;

  try {
    const url = new URL(withProtocol);
    if (url.protocol === 'http:') url.protocol = 'ws:';
    if (url.protocol === 'https:') url.protocol = 'wss:';
    if (url.protocol !== 'ws:' && url.protocol !== 'wss:') return '';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export function getCloudBuzzerUrl() {
  return normalizeBuzzerUrl((import.meta.env?.VITE_BUZZER_WS_URL || '').trim());
}

export function getStoredLocalBuzzerUrl() {
  if (!canUseStorage()) return '';
  return normalizeBuzzerUrl(window.localStorage.getItem(LOCAL_BUZZER_URL_KEY) || '');
}

export function setStoredLocalBuzzerUrl(nextUrl) {
  const normalized = normalizeBuzzerUrl(nextUrl);
  if (!canUseStorage()) return normalized;
  if (normalized) {
    window.localStorage.setItem(LOCAL_BUZZER_URL_KEY, normalized);
  } else {
    window.localStorage.removeItem(LOCAL_BUZZER_URL_KEY);
  }
  return normalized;
}

export function getSuggestedLocalBuzzerUrl() {
  const stored = getStoredLocalBuzzerUrl();
  if (stored) return stored;

  if (typeof window === 'undefined') return '';
  const host = window.location.hostname;
  if (!host) return '';
  if (host === 'localhost' || host === '127.0.0.1') return `ws://${host}:8787`;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return `ws://${host}:8787`;
  return '';
}

export function getStoredBuzzerMode() {
  if (!canUseStorage()) {
    return getCloudBuzzerUrl() ? 'cloud' : 'local';
  }

  const raw = window.localStorage.getItem(BUZZER_MODE_KEY);
  if (raw === 'local' || raw === 'cloud') return raw;
  return getCloudBuzzerUrl() ? 'cloud' : 'local';
}

export function setStoredBuzzerMode(mode) {
  const normalized = mode === 'local' ? 'local' : 'cloud';
  if (canUseStorage()) {
    window.localStorage.setItem(BUZZER_MODE_KEY, normalized);
  }
  return normalized;
}

export function getActiveBuzzerUrl({ mode = getStoredBuzzerMode(), overrideUrl = '' } = {}) {
  const normalizedOverride = normalizeBuzzerUrl(overrideUrl);
  if (normalizedOverride) return normalizedOverride;

  if (mode === 'local') {
    return getSuggestedLocalBuzzerUrl();
  }

  return getCloudBuzzerUrl();
}
