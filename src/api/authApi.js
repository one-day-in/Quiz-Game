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

export async function isAuthorized(user) {
    const email = user?.email?.trim().toLowerCase();
    const userId = user?.id;

    if (userId) {
        const { data: userIdMatch } = await supabase
            .from('authorized_users')
            .select('user_id')
            .eq('user_id', userId)
            .maybeSingle();

        if (userIdMatch) return true;
    }

    if (!email) return false;

    const { data: emailMatch } = await supabase
        .from('authorized_emails')
        .select('email')
        .eq('email', email)
        .maybeSingle();

    if (emailMatch) return true;

    const { data: legacyEmailMatch } = await supabase
        .from('authorized_users')
        .select('email')
        .eq('email', email)
        .maybeSingle();

    return !!legacyEmailMatch;
}

export function onAuthStateChange(callback) {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
    return () => subscription.unsubscribe();
}
