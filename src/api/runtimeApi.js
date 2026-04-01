import { supabase } from './supabaseClient.js';
import { GAME_RUNTIME_COLUMNS } from './gameApi.shared.js';

export async function getGameRuntime(gameId) {
    const { data, error } = await supabase
        .from('game_runtime')
        .select(GAME_RUNTIME_COLUMNS)
        .eq('game_id', gameId)
        .maybeSingle();

    if (error) throw new Error(`[Game] getGameRuntime failed: ${error.message}`);
    let winnerName = null;
    if (data?.winner_player_id) {
        const { data: winnerRow, error: winnerError } = await supabase
            .from('game_players')
            .select('name')
            .eq('id', data.winner_player_id)
            .maybeSingle();

        if (winnerError) throw new Error(`[Game] getGameRuntime winner failed: ${winnerError.message}`);
        winnerName = winnerRow?.name || null;
    }

    return {
        gameId,
        pressEnabled: !!data?.press_enabled,
        winnerPlayerId: data?.winner_player_id || null,
        winnerName,
        pressedAt: data?.pressed_at || null,
        updatedAt: data?.updated_at || null,
    };
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
    return {
        gameId: data.game_id,
        pressEnabled: !!data.press_enabled,
        winnerPlayerId: data.winner_player_id || null,
        winnerName: null,
        pressedAt: data.pressed_at || null,
        updatedAt: data.updated_at,
    };
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

export function subscribeToGameRuntime(gameId, onRuntimeChange) {
    let disposed = false;

    async function emitRuntime() {
        if (disposed) return;
        try {
            const runtime = await getGameRuntime(gameId);
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
            () => { void emitRuntime(); }
        )
        .subscribe();

    return () => {
        disposed = true;
        supabase.removeChannel(channel);
    };
}
