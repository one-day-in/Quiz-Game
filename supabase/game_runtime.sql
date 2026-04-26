create table if not exists public.game_runtime (
    game_id uuid primary key references public.games(id) on delete cascade,
    press_enabled boolean not null default false,
    winner_player_id uuid references public.game_players(id) on delete set null,
    pressed_at timestamptz null,
    updated_at timestamptz not null default timezone('utc', now())
);

alter table public.game_runtime
    add column if not exists winner_player_id uuid references public.game_players(id) on delete set null;

alter table public.game_runtime
    add column if not exists pressed_at timestamptz null;

alter table public.game_runtime enable row level security;

drop policy if exists "public can read game runtime" on public.game_runtime;
drop policy if exists "owners can manage game runtime" on public.game_runtime;

create policy "public can read game runtime"
on public.game_runtime
for select
to anon, authenticated
using (true);

create policy "owners can manage game runtime"
on public.game_runtime
for all
to authenticated
using (
    exists (
        select 1
        from public.games
        where games.id = game_runtime.game_id
          and games.created_by = auth.uid()
    )
)
with check (
    exists (
        select 1
        from public.games
        where games.id = game_runtime.game_id
          and games.created_by = auth.uid()
    )
);

create or replace function public.claim_game_press(
    p_game_id uuid,
    p_controller_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_controller_id text := trim(coalesce(p_controller_id, ''));
    v_player_id uuid;
    v_player_name text;
    v_runtime_game_id uuid;
    v_runtime_press_enabled boolean;
    v_runtime_winner_player_id uuid;
    v_runtime_pressed_at timestamptz;
begin
    if v_controller_id = '' then
        raise exception 'Controller ID is required';
    end if;

    insert into public.game_runtime (game_id, press_enabled, winner_player_id, pressed_at, updated_at)
    values (p_game_id, false, null, null, timezone('utc', now()))
    on conflict (game_id) do nothing;

    select gp.id, gp.name
    into v_player_id, v_player_name
    from public.game_players gp
    where gp.game_id = p_game_id
      and gp.controller_id = v_controller_id
    limit 1;

    if v_player_id is null then
        raise exception 'Player not found for controller %', v_controller_id;
    end if;

    update public.game_runtime gr
    set winner_player_id = v_player_id,
        pressed_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where gr.game_id = p_game_id
      and gr.press_enabled = true
      and gr.winner_player_id is null;

    if not found then
        raise exception 'Press is closed';
    end if;

    select
        gr.game_id,
        gr.press_enabled,
        gr.winner_player_id,
        gr.pressed_at
    into
        v_runtime_game_id,
        v_runtime_press_enabled,
        v_runtime_winner_player_id,
        v_runtime_pressed_at
    from public.game_runtime gr
    where gr.game_id = p_game_id;

    return jsonb_build_object(
        'game_id', v_runtime_game_id,
        'press_enabled', v_runtime_press_enabled,
        'winner_player_id', v_runtime_winner_player_id,
        'winner_name', v_player_name,
        'pressed_at', v_runtime_pressed_at
    );
end;
$$;

grant execute on function public.claim_game_press(uuid, text) to anon, authenticated;

create or replace function public.resolve_game_press(
    p_game_id uuid,
    p_expected_winner_player_id uuid,
    p_press_enabled boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_runtime_game_id uuid;
    v_runtime_press_enabled boolean;
    v_runtime_winner_player_id uuid;
    v_runtime_pressed_at timestamptz;
    v_runtime_updated_at timestamptz;
    v_can_manage boolean := false;
begin
    if p_game_id is null then
        raise exception 'Game ID is required';
    end if;
    if p_expected_winner_player_id is null then
        raise exception 'Expected winner player ID is required';
    end if;

    -- Allow service role (buzzer backend) and host owner; block everyone else.
    if auth.role() <> 'service_role' then
        select exists (
            select 1
            from public.games g
            where g.id = p_game_id
              and g.created_by = auth.uid()
        )
        into v_can_manage;

        if not v_can_manage then
            raise exception 'Host access denied';
        end if;
    end if;

    update public.game_runtime gr
    set press_enabled = coalesce(p_press_enabled, false),
        winner_player_id = null,
        pressed_at = null,
        updated_at = timezone('utc', now())
    where gr.game_id = p_game_id
      and gr.winner_player_id = p_expected_winner_player_id;

    if not found then
        raise exception 'Press already resolved';
    end if;

    select
        gr.game_id,
        gr.press_enabled,
        gr.winner_player_id,
        gr.pressed_at,
        gr.updated_at
    into
        v_runtime_game_id,
        v_runtime_press_enabled,
        v_runtime_winner_player_id,
        v_runtime_pressed_at,
        v_runtime_updated_at
    from public.game_runtime gr
    where gr.game_id = p_game_id;

    return jsonb_build_object(
        'game_id', v_runtime_game_id,
        'press_enabled', v_runtime_press_enabled,
        'winner_player_id', v_runtime_winner_player_id,
        'pressed_at', v_runtime_pressed_at,
        'updated_at', v_runtime_updated_at
    );
end;
$$;

grant execute on function public.resolve_game_press(uuid, uuid, boolean) to authenticated;
