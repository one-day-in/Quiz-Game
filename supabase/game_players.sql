create table if not exists public.game_players (
    id uuid primary key default gen_random_uuid(),
    game_id uuid not null references public.games(id) on delete cascade,
    name text not null,
    points integer not null default 0,
    controller_id text not null,
    joined_at timestamptz not null default timezone('utc', now()),
    updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists game_players_game_controller_idx
    on public.game_players (game_id, controller_id);

create index if not exists game_players_game_joined_idx
    on public.game_players (game_id, joined_at);

alter table public.game_players enable row level security;

drop policy if exists "public can read game players" on public.game_players;
drop policy if exists "owners can manage game players" on public.game_players;

create policy "public can read game players"
on public.game_players
for select
to anon, authenticated
using (true);

create policy "owners can manage game players"
on public.game_players
for all
to authenticated
using (
    exists (
        select 1
        from public.games
        where games.id = game_players.game_id
          and games.created_by = auth.uid()
    )
)
with check (
    exists (
        select 1
        from public.games
        where games.id = game_players.game_id
          and games.created_by = auth.uid()
    )
);

create or replace function public.claim_game_player(
    p_game_id uuid,
    p_name text,
    p_controller_id text
)
returns table (
    id uuid,
    game_id uuid,
    name text,
    points integer,
    joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text := left(trim(coalesce(p_name, '')), 24);
    v_controller_id text := trim(coalesce(p_controller_id, ''));
    v_existing public.game_players%rowtype;
    v_slots integer;
begin
    if v_name = '' then
        raise exception 'Player name is required';
    end if;

    if v_controller_id = '' then
        raise exception 'Controller ID is required';
    end if;

    select *
    into v_existing
    from public.game_players
    where game_players.game_id = p_game_id
      and game_players.controller_id = v_controller_id
    limit 1;

    if found then
        update public.game_players
        set name = v_name,
            updated_at = timezone('utc', now())
        where public.game_players.id = v_existing.id;

        return query
        select gp.id, gp.game_id, gp.name, gp.points, gp.joined_at
        from public.game_players gp
        where gp.id = v_existing.id;
        return;
    end if;

    select count(*)
    into v_slots
    from public.game_players
    where game_players.game_id = p_game_id;

    if v_slots >= 8 then
        raise exception 'No free player slots';
    end if;

    insert into public.game_players (game_id, name, points, controller_id)
    values (p_game_id, v_name, 0, v_controller_id)
    returning game_players.id, game_players.game_id, game_players.name, game_players.points, game_players.joined_at
    into id, game_id, name, points, joined_at;

    return next;
end;
$$;

create or replace function public.rename_game_player(
    p_game_id uuid,
    p_controller_id text,
    p_name text
)
returns table (
    id uuid,
    game_id uuid,
    name text,
    points integer,
    joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_name text := left(trim(coalesce(p_name, '')), 24);
begin
    if v_name = '' then
        raise exception 'Player name is required';
    end if;

    update public.game_players
    set name = v_name,
        updated_at = timezone('utc', now())
    where game_players.game_id = p_game_id
      and game_players.controller_id = trim(coalesce(p_controller_id, ''))
    returning game_players.id, game_players.game_id, game_players.name, game_players.points, game_players.joined_at
    into id, game_id, name, points, joined_at;

    if not found then
        raise exception 'Player not found';
    end if;

    return next;
end;
$$;

create or replace function public.adjust_game_player_score(
    p_game_id uuid,
    p_controller_id text,
    p_delta integer
)
returns table (
    id uuid,
    game_id uuid,
    name text,
    points integer,
    joined_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.game_players
    set points = coalesce(points, 0) + coalesce(p_delta, 0),
        updated_at = timezone('utc', now())
    where game_players.game_id = p_game_id
      and game_players.controller_id = trim(coalesce(p_controller_id, ''))
    returning game_players.id, game_players.game_id, game_players.name, game_players.points, game_players.joined_at
    into id, game_id, name, points, joined_at;

    if not found then
        raise exception 'Player not found';
    end if;

    return next;
end;
$$;

create or replace function public.leave_game_player(
    p_game_id uuid,
    p_controller_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.game_players
    where game_players.game_id = p_game_id
      and game_players.controller_id = trim(coalesce(p_controller_id, ''));

    if not found then
        raise exception 'Player not found';
    end if;
end;
$$;

grant execute on function public.claim_game_player(uuid, text, text) to anon, authenticated;
grant execute on function public.rename_game_player(uuid, text, text) to anon, authenticated;
grant execute on function public.adjust_game_player_score(uuid, text, integer) to anon, authenticated;
grant execute on function public.leave_game_player(uuid, text) to anon, authenticated;
