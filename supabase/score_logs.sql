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

grant execute on function public.append_score_log(
    text, uuid, uuid, text, text, text, integer, integer, integer, text, timestamptz
) to anon, authenticated;

grant execute on function public.clear_score_logs(uuid) to anon, authenticated;
