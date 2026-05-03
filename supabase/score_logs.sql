create table if not exists public.score_logs (
    id text primary key,
    game_id uuid not null references public.games(id) on delete cascade,
    player_id uuid null references public.game_players(id) on delete set null,
    player_name text not null,
    cell_label text not null default '',
    outcome text null,
    delta integer not null default 0,
    score_before integer null,
    score_after integer null,
    kind text not null default 'manual',
    happened_at timestamptz not null default timezone('utc', now()),
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists score_logs_game_happened_idx
    on public.score_logs (game_id, happened_at desc);

alter table public.score_logs enable row level security;

alter table public.score_logs add column if not exists score_before integer null;
alter table public.score_logs add column if not exists score_after integer null;

drop policy if exists "public can read score logs" on public.score_logs;
drop policy if exists "owners can insert score logs" on public.score_logs;
drop policy if exists "owners can delete score logs" on public.score_logs;

create policy "public can read score logs"
on public.score_logs
for select
to anon, authenticated
using (true);

create policy "owners can insert score logs"
on public.score_logs
for insert
to authenticated
with check (
    exists (
        select 1
        from public.games
        where games.id = score_logs.game_id
          and games.created_by = auth.uid()
    )
);

create policy "owners can delete score logs"
on public.score_logs
for delete
to authenticated
using (
    exists (
        select 1
        from public.games
        where games.id = score_logs.game_id
          and games.created_by = auth.uid()
    )
);

create or replace function public.append_score_log(
    p_id text,
    p_game_id uuid,
    p_player_id uuid,
    p_player_name text,
    p_cell_label text,
    p_outcome text,
    p_delta integer,
    p_score_before integer,
    p_score_after integer,
    p_kind text,
    p_happened_at timestamptz
)
returns table (
    id text,
    game_id uuid,
    player_id uuid,
    player_name text,
    cell_label text,
    outcome text,
    delta integer,
    score_before integer,
    score_after integer,
    kind text,
    happened_at timestamptz,
    created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_id text := nullif(trim(coalesce(p_id, '')), '');
begin
    if not exists (
        select 1
        from public.games g
        where g.id = p_game_id
    ) then
        raise exception 'Game not found';
    end if;

    insert into public.score_logs (
        id,
        game_id,
        player_id,
        player_name,
        cell_label,
        outcome,
        delta,
        score_before,
        score_after,
        kind,
        happened_at
    )
    values (
        coalesce(v_id, 'log-' || extract(epoch from timezone('utc', now()))::bigint::text || '-' || substr(md5(random()::text), 1, 8)),
        p_game_id,
        p_player_id,
        coalesce(nullif(trim(coalesce(p_player_name, '')), ''), 'Player'),
        coalesce(p_cell_label, ''),
        p_outcome,
        coalesce(p_delta, 0),
        p_score_before,
        p_score_after,
        coalesce(nullif(trim(coalesce(p_kind, '')), ''), 'manual'),
        coalesce(p_happened_at, timezone('utc', now()))
    )
    returning
        score_logs.id,
        score_logs.game_id,
        score_logs.player_id,
        score_logs.player_name,
        score_logs.cell_label,
        score_logs.outcome,
        score_logs.delta,
        score_logs.score_before,
        score_logs.score_after,
        score_logs.kind,
        score_logs.happened_at,
        score_logs.created_at
    into
        id,
        game_id,
        player_id,
        player_name,
        cell_label,
        outcome,
        delta,
        score_before,
        score_after,
        kind,
        happened_at,
        created_at;

    return next;
end;
$$;

create or replace function public.clear_score_logs(
    p_game_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (
        select 1
        from public.games g
        where g.id = p_game_id
    ) then
        raise exception 'Game not found';
    end if;

    delete from public.score_logs
    where score_logs.game_id = p_game_id;
end;
$$;

create or replace function public.adjust_game_player_score_with_log(
    p_game_id uuid,
    p_player_id uuid,
    p_delta integer,
    p_log_id text,
    p_cell_label text,
    p_outcome text,
    p_kind text,
    p_happened_at timestamptz
)
returns table (
    player_id uuid,
    player_game_id uuid,
    player_name text,
    player_points integer,
    player_joined_at timestamptz,
    log_id text,
    log_game_id uuid,
    log_player_id uuid,
    log_player_name text,
    log_cell_label text,
    log_outcome text,
    log_delta integer,
    log_score_before integer,
    log_score_after integer,
    log_kind text,
    log_happened_at timestamptz,
    log_created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_player public.game_players%rowtype;
    v_delta integer := coalesce(p_delta, 0);
    v_score_before integer := 0;
    v_score_after integer := 0;
    v_log_id text := nullif(trim(coalesce(p_log_id, '')), '');
    v_kind text := coalesce(nullif(trim(coalesce(p_kind, '')), ''), 'manual');
    v_happened_at timestamptz := coalesce(p_happened_at, timezone('utc', now()));
begin
    select *
    into v_player
    from public.game_players
    where game_players.game_id = p_game_id
      and game_players.id = p_player_id
    for update;

    if not found then
        raise exception 'Player not found';
    end if;

    v_score_before := coalesce(v_player.points, 0);
    v_score_after := v_score_before + v_delta;

    update public.game_players
    set points = v_score_after,
        updated_at = timezone('utc', now())
    where game_players.game_id = p_game_id
      and game_players.id = p_player_id;

    insert into public.score_logs (
        id,
        game_id,
        player_id,
        player_name,
        cell_label,
        outcome,
        delta,
        score_before,
        score_after,
        kind,
        happened_at
    )
    values (
        coalesce(v_log_id, 'log-' || extract(epoch from timezone('utc', now()))::bigint::text || '-' || substr(md5((random()::text || clock_timestamp()::text)), 1, 8)),
        p_game_id,
        p_player_id,
        coalesce(nullif(trim(coalesce(v_player.name, '')), ''), 'Player'),
        coalesce(p_cell_label, ''),
        p_outcome,
        v_delta,
        v_score_before,
        v_score_after,
        v_kind,
        v_happened_at
    )
    returning
        score_logs.id,
        score_logs.game_id,
        score_logs.player_id,
        score_logs.player_name,
        score_logs.cell_label,
        score_logs.outcome,
        score_logs.delta,
        score_logs.score_before,
        score_logs.score_after,
        score_logs.kind,
        score_logs.happened_at,
        score_logs.created_at
    into
        log_id,
        log_game_id,
        log_player_id,
        log_player_name,
        log_cell_label,
        log_outcome,
        log_delta,
        log_score_before,
        log_score_after,
        log_kind,
        log_happened_at,
        log_created_at;

    player_id := v_player.id;
    player_game_id := v_player.game_id;
    player_name := v_player.name;
    player_points := v_score_after;
    player_joined_at := v_player.joined_at;

    return next;
end;
$$;

create or replace function public.transfer_game_player_score_with_logs(
    p_game_id uuid,
    p_from_player_id uuid,
    p_to_player_id uuid,
    p_amount integer,
    p_from_log_id text,
    p_from_cell_label text,
    p_from_outcome text,
    p_from_kind text,
    p_to_log_id text,
    p_to_cell_label text,
    p_to_outcome text,
    p_to_kind text,
    p_happened_at timestamptz
)
returns table (
    from_player_id uuid,
    from_player_game_id uuid,
    from_player_name text,
    from_player_points integer,
    from_player_joined_at timestamptz,
    to_player_id uuid,
    to_player_game_id uuid,
    to_player_name text,
    to_player_points integer,
    to_player_joined_at timestamptz,
    from_log_id text,
    from_log_game_id uuid,
    from_log_player_id uuid,
    from_log_player_name text,
    from_log_cell_label text,
    from_log_outcome text,
    from_log_delta integer,
    from_log_score_before integer,
    from_log_score_after integer,
    from_log_kind text,
    from_log_happened_at timestamptz,
    from_log_created_at timestamptz,
    to_log_id text,
    to_log_game_id uuid,
    to_log_player_id uuid,
    to_log_player_name text,
    to_log_cell_label text,
    to_log_outcome text,
    to_log_delta integer,
    to_log_score_before integer,
    to_log_score_after integer,
    to_log_kind text,
    to_log_happened_at timestamptz,
    to_log_created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
    v_from public.game_players%rowtype;
    v_to public.game_players%rowtype;
    v_amount integer := abs(coalesce(p_amount, 0));
    v_from_before integer := 0;
    v_from_after integer := 0;
    v_to_before integer := 0;
    v_to_after integer := 0;
    v_from_log_id text := nullif(trim(coalesce(p_from_log_id, '')), '');
    v_to_log_id text := nullif(trim(coalesce(p_to_log_id, '')), '');
    v_from_kind text := coalesce(nullif(trim(coalesce(p_from_kind, '')), ''), 'cell_resolution');
    v_to_kind text := coalesce(nullif(trim(coalesce(p_to_kind, '')), ''), 'cell_resolution');
    v_happened_at timestamptz := coalesce(p_happened_at, timezone('utc', now()));
begin
    if p_from_player_id is null or p_to_player_id is null or p_from_player_id = p_to_player_id then
        raise exception 'Players must be different';
    end if;

    if v_amount <= 0 then
        raise exception 'Amount must be greater than 0';
    end if;

    perform 1
    from public.game_players
    where game_players.game_id = p_game_id
      and game_players.id in (p_from_player_id, p_to_player_id)
    order by game_players.id
    for update;

    select *
    into v_from
    from public.game_players
    where game_players.game_id = p_game_id
      and game_players.id = p_from_player_id;

    if not found then
        raise exception 'Player not found';
    end if;

    select *
    into v_to
    from public.game_players
    where game_players.game_id = p_game_id
      and game_players.id = p_to_player_id;

    if not found then
        raise exception 'Player not found';
    end if;

    v_from_before := coalesce(v_from.points, 0);
    v_to_before := coalesce(v_to.points, 0);
    v_from_after := v_from_before - v_amount;
    v_to_after := v_to_before + v_amount;

    update public.game_players
    set points = v_from_after,
        updated_at = timezone('utc', now())
    where game_players.game_id = p_game_id
      and game_players.id = p_from_player_id;

    update public.game_players
    set points = v_to_after,
        updated_at = timezone('utc', now())
    where game_players.game_id = p_game_id
      and game_players.id = p_to_player_id;

    insert into public.score_logs (
        id,
        game_id,
        player_id,
        player_name,
        cell_label,
        outcome,
        delta,
        score_before,
        score_after,
        kind,
        happened_at
    )
    values (
        coalesce(v_from_log_id, 'log-' || extract(epoch from timezone('utc', now()))::bigint::text || '-' || substr(md5((random()::text || clock_timestamp()::text)), 1, 8)),
        p_game_id,
        p_from_player_id,
        coalesce(nullif(trim(coalesce(v_from.name, '')), ''), 'Player'),
        coalesce(p_from_cell_label, ''),
        p_from_outcome,
        -v_amount,
        v_from_before,
        v_from_after,
        v_from_kind,
        v_happened_at
    )
    returning
        score_logs.id,
        score_logs.game_id,
        score_logs.player_id,
        score_logs.player_name,
        score_logs.cell_label,
        score_logs.outcome,
        score_logs.delta,
        score_logs.score_before,
        score_logs.score_after,
        score_logs.kind,
        score_logs.happened_at,
        score_logs.created_at
    into
        from_log_id,
        from_log_game_id,
        from_log_player_id,
        from_log_player_name,
        from_log_cell_label,
        from_log_outcome,
        from_log_delta,
        from_log_score_before,
        from_log_score_after,
        from_log_kind,
        from_log_happened_at,
        from_log_created_at;

    insert into public.score_logs (
        id,
        game_id,
        player_id,
        player_name,
        cell_label,
        outcome,
        delta,
        score_before,
        score_after,
        kind,
        happened_at
    )
    values (
        coalesce(v_to_log_id, 'log-' || extract(epoch from timezone('utc', now()))::bigint::text || '-' || substr(md5((random()::text || clock_timestamp()::text)), 1, 8)),
        p_game_id,
        p_to_player_id,
        coalesce(nullif(trim(coalesce(v_to.name, '')), ''), 'Player'),
        coalesce(p_to_cell_label, ''),
        p_to_outcome,
        v_amount,
        v_to_before,
        v_to_after,
        v_to_kind,
        v_happened_at
    )
    returning
        score_logs.id,
        score_logs.game_id,
        score_logs.player_id,
        score_logs.player_name,
        score_logs.cell_label,
        score_logs.outcome,
        score_logs.delta,
        score_logs.score_before,
        score_logs.score_after,
        score_logs.kind,
        score_logs.happened_at,
        score_logs.created_at
    into
        to_log_id,
        to_log_game_id,
        to_log_player_id,
        to_log_player_name,
        to_log_cell_label,
        to_log_outcome,
        to_log_delta,
        to_log_score_before,
        to_log_score_after,
        to_log_kind,
        to_log_happened_at,
        to_log_created_at;

    from_player_id := v_from.id;
    from_player_game_id := v_from.game_id;
    from_player_name := v_from.name;
    from_player_points := v_from_after;
    from_player_joined_at := v_from.joined_at;
    to_player_id := v_to.id;
    to_player_game_id := v_to.game_id;
    to_player_name := v_to.name;
    to_player_points := v_to_after;
    to_player_joined_at := v_to.joined_at;

    return next;
end;
$$;

grant execute on function public.append_score_log(
    text, uuid, uuid, text, text, text, integer, integer, integer, text, timestamptz
) to anon, authenticated;

grant execute on function public.clear_score_logs(uuid) to anon, authenticated;
grant execute on function public.adjust_game_player_score_with_log(
    uuid, uuid, integer, text, text, text, text, timestamptz
) to anon, authenticated;
grant execute on function public.transfer_game_player_score_with_logs(
    uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, timestamptz
) to anon, authenticated;
