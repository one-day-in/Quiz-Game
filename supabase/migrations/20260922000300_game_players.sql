create table public.game_players (
    id uuid primary key default gen_random_uuid(),
    game_id uuid not null references public.games(id) on delete cascade,
    name text not null,
    points integer not null default 0,
    controller_token_hash text not null,
    joined_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint game_players_name_not_blank check (length(btrim(name)) between 1 and 24),
    constraint game_players_controller_hash_not_blank check (length(controller_token_hash) = 64),
    constraint game_players_game_id_id_unique unique (game_id, id)
);

create unique index game_players_game_controller_hash_idx
on public.game_players (game_id, controller_token_hash);

create index game_players_game_joined_idx
on public.game_players (game_id, joined_at);

create trigger game_players_touch_updated_at
before update on public.game_players
for each row execute function private.touch_updated_at();

create function private.hash_controller_token(p_token text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
    select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

alter table public.game_players enable row level security;

create policy "public can read safe player rows"
on public.game_players
for select
to anon, authenticated
using (true);

create policy "owners and admins can update players"
on public.game_players
for update
to authenticated
using (private.can_manage_game(game_id))
with check (private.can_manage_game(game_id));

create policy "owners and admins can delete players"
on public.game_players
for delete
to authenticated
using (private.can_manage_game(game_id));

create function public.get_game_player_by_controller(
    p_game_id uuid,
    p_controller_id text
)
returns table (
    id uuid,
    game_id uuid,
    name text,
    points integer,
    joined_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
    select player.id, player.game_id, player.name, player.points, player.joined_at
    from public.game_players player
    where player.game_id = p_game_id
      and player.controller_token_hash = private.hash_controller_token(btrim(p_controller_id))
    limit 1;
$$;

create function public.claim_game_player(
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
set search_path = ''
as $$
declare
    v_name text := left(btrim(coalesce(p_name, '')), 24);
    v_token text := btrim(coalesce(p_controller_id, ''));
    v_token_hash text;
    v_player public.game_players%rowtype;
begin
    if v_name = '' then
        raise exception 'Player name is required';
    end if;
    if length(v_token) < 20 then
        raise exception 'Controller token is invalid';
    end if;

    v_token_hash := private.hash_controller_token(v_token);

    perform 1
    from public.games game
    where game.id = p_game_id
    for update;
    if not found then
        raise exception 'Game not found';
    end if;

    select player.*
    into v_player
    from public.game_players player
    where player.game_id = p_game_id
      and player.controller_token_hash = v_token_hash
    limit 1;

    if found then
        update public.game_players player
        set name = v_name
        where player.id = v_player.id
        returning player.* into v_player;
    else
        if (
            select count(*)
            from public.game_players player
            where player.game_id = p_game_id
        ) >= 8 then
            raise exception 'No free player slots';
        end if;

        insert into public.game_players (game_id, name, controller_token_hash)
        values (p_game_id, v_name, v_token_hash)
        returning * into v_player;
    end if;

    return query
    select v_player.id, v_player.game_id, v_player.name, v_player.points, v_player.joined_at;
end;
$$;

create function public.rename_game_player(
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
set search_path = ''
as $$
declare
    v_name text := left(btrim(coalesce(p_name, '')), 24);
begin
    if v_name = '' then
        raise exception 'Player name is required';
    end if;

    return query
    update public.game_players player
    set name = v_name
    where player.game_id = p_game_id
      and player.controller_token_hash = private.hash_controller_token(btrim(p_controller_id))
    returning player.id, player.game_id, player.name, player.points, player.joined_at;

    if not found then
        raise exception 'Player not found';
    end if;
end;
$$;

create function public.leave_game_player(
    p_game_id uuid,
    p_controller_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from public.game_players player
    where player.game_id = p_game_id
      and player.controller_token_hash = private.hash_controller_token(btrim(p_controller_id));

    if not found then
        raise exception 'Player not found';
    end if;
end;
$$;

create function public.adjust_game_player_score_by_id(
    p_game_id uuid,
    p_player_id uuid,
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
set search_path = ''
as $$
begin
    if not private.can_manage_game(p_game_id) then
        raise exception 'Host access denied';
    end if;

    return query
    update public.game_players player
    set points = player.points + coalesce(p_delta, 0)
    where player.game_id = p_game_id
      and player.id = p_player_id
    returning player.id, player.game_id, player.name, player.points, player.joined_at;

    if not found then
        raise exception 'Player not found';
    end if;
end;
$$;

create function public.delete_game_player(
    p_game_id uuid,
    p_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not private.can_manage_game(p_game_id) then
        raise exception 'Host access denied';
    end if;

    delete from public.game_players player
    where player.game_id = p_game_id
      and player.id = p_player_id;

    if not found then
        raise exception 'Player not found';
    end if;
end;
$$;

revoke all on public.game_players from public, anon, authenticated;
grant select (id, game_id, name, points, joined_at, updated_at) on public.game_players to anon, authenticated;
grant update (name, points, updated_at), delete on public.game_players to authenticated;
grant all on public.game_players to service_role;

revoke execute on function private.hash_controller_token(text) from public, anon, authenticated;

revoke execute on function public.get_game_player_by_controller(uuid, text) from public, anon, authenticated;
grant execute on function public.get_game_player_by_controller(uuid, text) to anon, authenticated;

revoke execute on function public.claim_game_player(uuid, text, text) from public, anon, authenticated;
grant execute on function public.claim_game_player(uuid, text, text) to anon, authenticated;

revoke execute on function public.rename_game_player(uuid, text, text) from public, anon, authenticated;
grant execute on function public.rename_game_player(uuid, text, text) to anon, authenticated;

revoke execute on function public.leave_game_player(uuid, text) from public, anon, authenticated;
grant execute on function public.leave_game_player(uuid, text) to anon, authenticated;

revoke execute on function public.adjust_game_player_score_by_id(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.adjust_game_player_score_by_id(uuid, uuid, integer) to authenticated, service_role;

revoke execute on function public.delete_game_player(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_game_player(uuid, uuid) to authenticated, service_role;
