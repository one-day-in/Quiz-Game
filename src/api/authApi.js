import { supabase } from './supabaseClient.js';

export async function signInWithGoogle() {
    return supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
}

export async function signOut() {
    return supabase.auth.signOut();
}

export async function getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
}

export async function isAuthorized(userId) {
    const { data } = await supabase
        .from('authorized_users')
        .select('user_id')
        .eq('user_id', userId)
        .single();
    return !!data;
}

export function onAuthStateChange(callback) {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
    return () => subscription.unsubscribe();
}
