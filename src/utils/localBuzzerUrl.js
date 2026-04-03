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

export function getActiveBuzzerUrl({ overrideUrl = '' } = {}) {
  const normalizedOverride = normalizeBuzzerUrl(overrideUrl);
  if (normalizedOverride) return normalizedOverride;
  return getCloudBuzzerUrl();
}
