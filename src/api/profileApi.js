import { supabase } from './supabaseClient.js';

function mapProfile(user) {
  const fullName = user?.user_metadata?.full_name || user?.user_metadata?.name || '';
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture || '';
  const email = user?.email || '';

  return {
    id: user?.id,
    email,
    full_name: fullName,
    avatar_url: avatarUrl,
  };
}

export async function syncCurrentUserProfile(user) {
  if (!user?.id) return null;

  const profile = mapProfile(user);
  const { error } = await supabase
    .from('profiles')
    .upsert(profile, { onConflict: 'id' });

  if (error) {
    throw new Error(`[Profile] syncCurrentUserProfile failed: ${error.message}`);
  }

  return profile;
}

export async function getProfilesByIds(userIds = []) {
  const ids = Array.from(new Set((Array.isArray(userIds) ? userIds : []).filter(Boolean)));
  if (!ids.length) return [];

  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url')
    .in('id', ids);

  if (error) {
    throw new Error(`[Profile] getProfilesByIds failed: ${error.message}`);
  }

  return data ?? [];
}
