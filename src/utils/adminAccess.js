const GAME_DELETE_ADMIN_EMAILS = ['skabullartem@gmail.com'];

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isGameDeleteAdminEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized ? GAME_DELETE_ADMIN_EMAILS.includes(normalized) : false;
}

export function isGameDeleteAdminUser(user) {
  return isGameDeleteAdminEmail(user?.email);
}
