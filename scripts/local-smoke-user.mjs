import { createClient } from '@supabase/supabase-js';
import { getLocalSupabaseCredentials } from './local-supabase-env.mjs';

const email = 'smoke-host@example.test';
const password = 'Local-Smoke-Quiz-Game-2026!';
const cleanupOnly = process.argv.includes('--cleanup');
const { url, serviceRoleKey } = getLocalSupabaseCredentials();
const service = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: usersPage, error: listError } = await service.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
if (listError) throw listError;

for (const user of usersPage.users.filter((candidate) => candidate.email === email)) {
  const { error } = await service.auth.admin.deleteUser(user.id);
  if (error) throw error;
}

if (cleanupOnly) {
  console.log('Local smoke user removed.');
  process.exit(0);
}

const { data, error: createError } = await service.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
if (createError) throw createError;

const { error: accessError } = await service
  .from('app_user_roles')
  .insert({ user_id: data.user.id, role: 'admin', enabled: true });
if (accessError) throw accessError;

console.log(`Local smoke user ready: ${email}`);
