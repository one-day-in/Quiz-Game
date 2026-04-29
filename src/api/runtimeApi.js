import { supabase } from './supabaseClient.js';
import { GAME_RUNTIME_COLUMNS } from './gameApi.shared.js';

const winnerNameCache = new Map();

function mapRuntimeRow(gameId, row, winnerName = null) {
    return {
        gameId: row?.game_id || gameId,
        pressEnabled: !!row?.press_enabled,
        winnerPlayerId: row?.winner_player_id || null,
        winnerName: winnerName || null,
        pressedAt: row?.pressed_at || null,
        pressExpiresAt: row?.press_expires_at || null,
        pressStatus: row?.press_status || null,
        resolvedAt: row?.resolved_at || null,
        updatedAt: row?.updated_at || null,
    };
}

async function fetchWinnerName(winnerPlayerId) {
    if (!winnerPlayerId) return null;
    if (winnerNameCache.has(winnerPlayerId)) return winnerNameCache.get(winnerPlayerId);

    const { data, error } = await supabase
        .from('game_players')
        .select('name')
        .eq('id', winnerPlayerId)
        .maybeSingle();

    if (error) throw new Error(`[Game] getGameRuntime winner failed: ${error.message}`);
    const winnerName = data?.name || null;
    winnerNameCache.set(winnerPlayerId, winnerName);
    return winnerName;
}

export async function getGameRuntime(gameId) {
    const { data, error } = await supabase
        .from('game_runtime')
        .select(GAME_RUNTIME_COLUMNS)
        .eq('game_id', gameId)
        .maybeSingle();

    if (error) throw new Error(`[Game] getGameRuntime failed: ${error.message}`);
    const winnerName = await fetchWinnerName(data?.winner_player_id);
    return mapRuntimeRow(gameId, data, winnerName);
}

export async function setPressEnabled(gameId, enabled) {
    const { data, error } = await supabase
        .from('game_runtime')
        .upsert({
            game_id: gameId,
            press_enabled: !!enabled,
            winner_player_id: null,
            pressed_at: null,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'game_id' })
        .select(GAME_RUNTIME_COLUMNS)
        .single();

    if (error) throw new Error(`[Game] setPressEnabled failed: ${error.message}`);
    return mapRuntimeRow(gameId, data, null);
}

export async function claimGamePress(gameId, controllerId) {
    const { data, error } = await supabase.rpc('claim_game_press', {
        p_game_id: gameId,
        p_controller_id: controllerId,
    });

    if (error) throw new Error(`[Game] claimGamePress failed: ${error.message}`);

    const row = Array.isArray(data) ? data[0] : data;
    return {
        gameId: row?.game_id || gameId,
        winnerPlayerId: row?.winner_player_id || null,
        winnerName: row?.winner_name || null,
        pressedAt: row?.pressed_at || null,
        pressEnabled: !!row?.press_enabled,
    };
}

export async function resolveGamePress(gameId, expectedWinnerPlayerId, { pressEnabled = false } = {}) {
    const { data, error } = await supabase.rpc('resolve_game_press', {
        p_game_id: gameId,
        p_expected_winner_player_id: expectedWinnerPlayerId,
        p_press_enabled: !!pressEnabled,
    });

    if (error) throw new Error(`[Game] resolveGamePress failed: ${error.message}`);

    const row = Array.isArray(data) ? data[0] : data;
    return {
        gameId: row?.game_id || gameId,
        winnerPlayerId: row?.winner_player_id || null,
        winnerName: null,
        pressedAt: row?.pressed_at || null,
        pressExpiresAt: row?.press_expires_at || null,
        pressStatus: row?.press_status || null,
        resolvedAt: row?.resolved_at || null,
        pressEnabled: !!row?.press_enabled,
        updatedAt: row?.updated_at || null,
    };
}

export async function resolveGamePressTimeout(gameId, expectedWinnerPlayerId, expectedPressExpiresAt = null) {
    try {
        const { data, error } = await supabase.rpc('resolve_game_press_timeout', {
            p_game_id: gameId,
            p_expected_winner_player_id: expectedWinnerPlayerId,
            p_expected_press_expires_at: expectedPressExpiresAt,
        });

        if (error) throw new Error(error.message);

        const row = Array.isArray(data) ? data[0] : data;
        return {
            gameId: row?.game_id || gameId,
            winnerPlayerId: row?.winner_player_id || null,
            winnerName: null,
            pressedAt: row?.pressed_at || null,
            pressExpiresAt: row?.press_expires_at || null,
            pressStatus: row?.press_status || null,
            resolvedAt: row?.resolved_at || null,
            pressEnabled: !!row?.press_enabled,
            updatedAt: row?.updated_at || null,
        };
    } catch (error) {
        const message = String(error?.message || '');
        // Compatibility fallback before RPC migration is applied.
        if (message.includes('resolve_game_press_timeout')) {
            return resolveGamePress(gameId, expectedWinnerPlayerId, { pressEnabled: true });
        }
        throw new Error(`[Game] resolveGamePressTimeout failed: ${message}`);
    }
}

export function subscribeToGameRuntime(gameId, onRuntimeChange) {
    let disposed = false;
    let lastWinnerPlayerId = null;

    async function emitRuntime() {
        if (disposed) return;
        try {
            const runtime = await getGameRuntime(gameId);
            lastWinnerPlayerId = runtime?.winnerPlayerId || null;
            if (!disposed) onRuntimeChange(runtime);
        } catch (error) {
            console.error('[Game] subscribeToGameRuntime refresh failed:', error);
        }
    }

    const channel = supabase
        .channel(`game-runtime:${gameId}`)
        .on(
            'postgres_changes',
            {
                event: '*',
                schema: 'public',
                table: 'game_runtime',
                filter: `game_id=eq.${gameId}`,
            },
            (payload) => {
                const runtime = mapRuntimeRow(gameId, payload?.new || null, null);
                const nextWinnerPlayerId = runtime?.winnerPlayerId || null;

                if (!disposed) onRuntimeChange(runtime);

                if (nextWinnerPlayerId && nextWinnerPlayerId !== lastWinnerPlayerId) {
                    void fetchWinnerName(nextWinnerPlayerId)
                        .then((winnerName) => {
                            if (disposed) return;
                            onRuntimeChange({ ...runtime, winnerName });
                        })
                        .catch((error) => {
                            console.error('[Game] subscribeToGameRuntime winner refresh failed:', error);
                        });
                }

                lastWinnerPlayerId = nextWinnerPlayerId;
            }
        )
        .subscribe();

    return () => {
        disposed = true;
        supabase.removeChannel(channel);
    };
}
