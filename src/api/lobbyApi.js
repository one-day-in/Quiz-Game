import { supabase } from './supabaseClient.js';
import { getProfilesByIds } from './profileApi.js';
import { makeDefaultGame } from './gameApi.shared.js';

export async function listGames() {
    const { data, error } = await supabase
        .from('games')
        .select('id, name, created_at, updated_at, created_by')
        .order('updated_at', { ascending: false });

    if (error) throw new Error(`[Game] listGames failed: ${error.message}`);
    const games = data ?? [];
    const profiles = await getProfilesByIds(games.map((game) => game.created_by));
    const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));

    return games.map((game) => ({
        ...game,
        creatorProfile: profilesById.get(game.created_by) || null,
    }));
}

export async function createGame(name) {
    const { data: { user } } = await supabase.auth.getUser();

    const { data, error } = await supabase
        .from('games')
        .insert({
            name: (name || 'Untitled').trim(),
            data: makeDefaultGame(),
            created_by: user?.id ?? null
        })
        .select('id, name')
        .single();

    if (error) throw new Error(`[Game] createGame failed: ${error.message}`);
    return data;
}

export async function renameGame(gameId, name) {
    const { data, error } = await supabase
        .from('games')
        .update({
            name: name.trim(),
            updated_at: new Date().toISOString(),
        })
        .eq('id', gameId)
        .select('id, name, updated_at')
        .maybeSingle();

    if (error) throw new Error(`[Game] renameGame failed: ${error.message}`);
    if (!data) {
        throw new Error('[Game] renameGame failed: no game row was updated. Check games table RLS policies for owner updates.');
    }
    return data;
}

export async function deleteGame(gameId) {
    const { error } = await supabase
        .from('games')
        .delete()
        .eq('id', gameId);

    if (error) throw new Error(`[Game] deleteGame failed: ${error.message}`);
    return { ok: true };
}
