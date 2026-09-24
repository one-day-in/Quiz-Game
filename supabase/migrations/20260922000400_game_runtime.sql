create table public.game_runtime (
    game_id uuid primary key references public.games(id) on delete cascade,
    press_enabled boolean not null default false,
    winner_player_id uuid,
    pressed_at timestamptz,
    press_expires_at timestamptz,
    press_status text not null default 'idle',
    resolved_at timestamptz,
    resolved_by text,
    updated_at timestamptz not null default now(),
    constraint game_runtime_press_status_valid
        check (press_status in ('idle', 'open', 'claimed', 'resolved')),
    constraint game_runtime_winner_belongs_to_game
        foreign key (game_id, winner_player_id)
        references public.game_players(game_id, id),
    constraint game_runtime_claim_consistent
        check (
            (
                press_status = 'claimed'
                and press_enabled
                and winner_player_id is not null
                and pressed_at is not null
                and press_expires_at is not null
            )
            or (
                press_status <> 'claimed'
                and winner_player_id is null
                and pressed_at is null
                and press_expires_at is null
            )
        ),
    constraint game_runtime_status_enabled_consistent
        check (
            (press_status in ('open', 'claimed') and press_enabled)
            or (press_status in ('idle', 'resolved') and not press_enabled)
        )
);

create trigger game_runtime_touch_updated_at
before update on public.game_runtime
for each row execute function private.touch_updated_at();

alter table public.game_runtime enable row level security;

create policy "public can read game runtime"
on public.game_runtime
for select
to anon, authenticated
using (true);

create policy "owners and admins can insert game runtime"
on public.game_runtime
for insert
to authenticated
with check (private.can_manage_game(game_id));

create policy "owners and admins can update game runtime"
on public.game_runtime
for update
to authenticated
using (private.can_manage_game(game_id))
with check (private.can_manage_game(game_id));

create function public.claim_game_press(
    p_game_id uuid,
    p_controller_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_player public.game_players%rowtype;
    v_runtime public.game_runtime%rowtype;
begin
    select player.*
    into v_player
    from public.game_players player
    where player.game_id = p_game_id
      and player.controller_token_hash = private.hash_controller_token(btrim(p_controller_id))
    limit 1;

    if not found then
        raise exception 'Player not found';
    end if;

    update public.game_runtime runtime
    set winner_player_id = v_player.id,
        pressed_at = now(),
        press_expires_at = now() + interval '30 seconds',
        press_status = 'claimed',
        resolved_at = null,
        resolved_by = null
    where runtime.game_id = p_game_id
      and runtime.press_enabled
      and runtime.press_status = 'open'
      and runtime.winner_player_id is null
    returning runtime.* into v_runtime;

    if not found then
        raise exception 'Press is closed';
    end if;

    return jsonb_build_object(
        'game_id', v_runtime.game_id,
        'press_enabled', v_runtime.press_enabled,
        'winner_player_id', v_runtime.winner_player_id,
        'winner_name', v_player.name,
        'pressed_at', v_runtime.pressed_at,
        'press_expires_at', v_runtime.press_expires_at,
        'press_status', v_runtime.press_status,
        'resolved_at', v_runtime.resolved_at,
        'resolved_by', v_runtime.resolved_by,
        'updated_at', v_runtime.updated_at
    );
end;
$$;

create function public.resolve_game_press(
    p_game_id uuid,
    p_expected_winner_player_id uuid,
    p_press_enabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_runtime public.game_runtime%rowtype;
begin
    if not private.can_manage_game(p_game_id) then
        raise exception 'Host access denied';
    end if;

    update public.game_runtime runtime
    set press_enabled = coalesce(p_press_enabled, false),
        winner_player_id = null,
        pressed_at = null,
        press_expires_at = null,
        press_status = case when coalesce(p_press_enabled, false) then 'open' else 'resolved' end,
        resolved_at = now(),
        resolved_by = 'host'
    where runtime.game_id = p_game_id
      and runtime.winner_player_id = p_expected_winner_player_id
      and runtime.press_status = 'claimed'
    returning runtime.* into v_runtime;

    if not found then
        raise exception 'Press already resolved';
    end if;

    return to_jsonb(v_runtime);
end;
$$;

create function public.resolve_game_press_timeout(
    p_game_id uuid,
    p_expected_winner_player_id uuid,
    p_expected_press_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_runtime public.game_runtime%rowtype;
begin
    if not private.can_manage_game(p_game_id) then
        raise exception 'Host access denied';
    end if;

    update public.game_runtime runtime
    set press_enabled = true,
        winner_player_id = null,
        pressed_at = null,
        press_expires_at = null,
        press_status = 'open',
        resolved_at = now(),
        resolved_by = 'timeout'
    where runtime.game_id = p_game_id
      and runtime.winner_player_id = p_expected_winner_player_id
      and runtime.press_status = 'claimed'
      and runtime.press_expires_at = p_expected_press_expires_at
      and runtime.press_expires_at <= now()
    returning runtime.* into v_runtime;

    if not found then
        raise exception 'Timeout is stale or not due';
    end if;

    return to_jsonb(v_runtime);
end;
$$;

revoke all on public.game_runtime from public, anon, authenticated;
grant select (
    game_id,
    press_enabled,
    winner_player_id,
    pressed_at,
    press_expires_at,
    press_status,
    resolved_at,
    resolved_by,
    updated_at
) on public.game_runtime to anon, authenticated;
grant insert, update on public.game_runtime to authenticated;
grant all on public.game_runtime to service_role;

revoke execute on function public.claim_game_press(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_game_press(uuid, text) to anon, authenticated, service_role;

revoke execute on function public.resolve_game_press(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.resolve_game_press(uuid, uuid, boolean) to authenticated, service_role;

revoke execute on function public.resolve_game_press_timeout(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.resolve_game_press_timeout(uuid, uuid, timestamptz) to authenticated, service_role;
