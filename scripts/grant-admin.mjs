import { createClient } from '@supabase/supabase-js';

const userId = process.argv[2]?.trim();
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
  console.error('Usage: npm run admin:grant -- <auth-user-uuid>');
  process.exit(1);
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error('SUPABASE_URL (or VITE_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const { data, error } = await supabase
  .from('app_user_roles')
  .upsert({ user_id: userId, role: 'admin', enabled: true }, { onConflict: 'user_id' })
  .select('user_id, role, enabled')
  .single();

if (error) {
  console.error(`Failed to grant admin access: ${error.message}`);
  process.exit(1);
}

console.log(`Admin access granted to ${data.user_id}.`);
