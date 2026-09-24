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

export async function getCurrentUserAccess(user) {
    if (!user?.id) return { authorized: false, role: null };

    const { data, error } = await supabase.rpc('get_current_user_access');
    if (error) {
        throw new Error(`[Auth] access check failed: ${error.message}`);
    }

    const access = Array.isArray(data) ? data[0] : data;
    return {
        authorized: access?.authorized === true,
        role: access?.authorized === true && ['host', 'admin'].includes(access?.role)
            ? access.role
            : null,
    };
}

export async function isAuthorized(user) {
    const access = await getCurrentUserAccess(user);
    return access.authorized;
}

export function onAuthStateChange(callback) {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        callback(event, session);
    });
    return () => subscription.unsubscribe();
}
