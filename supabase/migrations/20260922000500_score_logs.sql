create table public.score_logs (
    id text primary key,
    game_id uuid not null references public.games(id) on delete cascade,
    player_id uuid references public.game_players(id) on delete set null,
    player_name text not null,
    cell_label text not null default '',
    outcome text,
    delta integer not null default 0,
    score_before integer,
    score_after integer,
    kind text not null default 'manual',
    happened_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    constraint score_logs_id_not_blank check (length(btrim(id)) between 1 and 200),
    constraint score_logs_player_name_not_blank check (length(btrim(player_name)) between 1 and 120),
    constraint score_logs_kind_not_blank check (length(btrim(kind)) between 1 and 80)
);

create index score_logs_game_happened_idx
on public.score_logs (game_id, happened_at desc);

alter table public.score_logs enable row level security;

create policy "owners and admins can read score logs"
on public.score_logs
for select
to authenticated
using (private.can_manage_game(game_id));

create function public.append_score_log(
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
set search_path = ''
as $$
declare
    v_id text := coalesce(nullif(btrim(p_id), ''), extensions.gen_random_uuid()::text);
    v_log public.score_logs%rowtype;
    v_player_name text := coalesce(nullif(btrim(p_player_name), ''), 'Player');
    v_cell_label text := coalesce(p_cell_label, '');
    v_delta integer := coalesce(p_delta, 0);
    v_kind text := coalesce(nullif(btrim(p_kind), ''), 'manual');
begin
    if not private.can_manage_game(p_game_id) then
        raise exception 'Host access denied';
    end if;

    select log.* into v_log
    from public.score_logs log
    where log.id = v_id;

    if found then
        if v_log.game_id <> p_game_id
            or v_log.player_id is distinct from p_player_id
            or v_log.player_name <> v_player_name
            or v_log.cell_label <> v_cell_label
            or v_log.outcome is distinct from p_outcome
            or v_log.delta <> v_delta
            or v_log.score_before is distinct from p_score_before
            or v_log.score_after is distinct from p_score_after
            or v_log.kind <> v_kind then
            raise exception 'Score log id conflict';
        end if;
    else
        insert into public.score_logs (
            id, game_id, player_id, player_name, cell_label, outcome, delta,
            score_before, score_after, kind, happened_at
        ) values (
            v_id,
            p_game_id,
            p_player_id,
            v_player_name,
            v_cell_label,
            p_outcome,
            v_delta,
            p_score_before,
            p_score_after,
            v_kind,
            coalesce(p_happened_at, now())
        )
        returning * into v_log;
    end if;

    return query select
        v_log.id, v_log.game_id, v_log.player_id, v_log.player_name,
        v_log.cell_label, v_log.outcome, v_log.delta, v_log.score_before,
        v_log.score_after, v_log.kind, v_log.happened_at, v_log.created_at;
end;
$$;

create function public.clear_score_logs(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not private.can_manage_game(p_game_id) then
        raise exception 'Host access denied';
    end if;

    delete from public.score_logs log where log.game_id = p_game_id;
end;
$$;

create function public.adjust_game_player_score_with_log(
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
set search_path = ''
as $$
declare
    v_player public.game_players%rowtype;
    v_log public.score_logs%rowtype;
    v_log_id text := coalesce(nullif(btrim(p_log_id), ''), extensions.gen_random_uuid()::text);
    v_delta integer := coalesce(p_delta, 0);
    v_cell_label text := coalesce(p_cell_label, '');
    v_kind text := coalesce(nullif(btrim(p_kind), ''), 'manual');
    v_before integer;
    v_after integer;
begin
    if not private.can_manage_game(p_game_id) then
        raise exception 'Host access denied';
    end if;

    select player.* into v_player
    from public.game_players player
    where player.game_id = p_game_id and player.id = p_player_id
    for update;
    if not found then
        raise exception 'Player not found';
    end if;

    select log.* into v_log
    from public.score_logs log
    where log.id = v_log_id;

    if found then
        if v_log.game_id <> p_game_id
            or v_log.player_id is distinct from p_player_id
            or v_log.cell_label <> v_cell_label
            or v_log.outcome is distinct from p_outcome
            or v_log.delta <> v_delta
            or v_log.kind <> v_kind then
            raise exception 'Score log id conflict';
        end if;
    else
        v_before := v_player.points;
        v_after := v_before + v_delta;

        insert into public.score_logs (
            id, game_id, player_id, player_name, cell_label, outcome, delta,
            score_before, score_after, kind, happened_at
        ) values (
            v_log_id, p_game_id, p_player_id, v_player.name,
            v_cell_label, p_outcome, v_delta, v_before, v_after,
            v_kind,
            coalesce(p_happened_at, now())
        ) returning * into v_log;

        update public.game_players player
        set points = v_after
        where player.id = p_player_id
        returning player.* into v_player;
    end if;

    return query select
        v_player.id, v_player.game_id, v_player.name, v_player.points, v_player.joined_at,
        v_log.id, v_log.game_id, v_log.player_id, v_log.player_name, v_log.cell_label,
        v_log.outcome, v_log.delta, v_log.score_before, v_log.score_after, v_log.kind,
        v_log.happened_at, v_log.created_at;
end;
$$;

create function public.transfer_game_player_score_with_logs(
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
set search_path = ''
as $$
declare
    v_from public.game_players%rowtype;
    v_to public.game_players%rowtype;
    v_from_log public.score_logs%rowtype;
    v_to_log public.score_logs%rowtype;
    v_amount integer := abs(coalesce(p_amount, 0));
    v_from_log_id text := coalesce(nullif(btrim(p_from_log_id), ''), extensions.gen_random_uuid()::text);
    v_to_log_id text := coalesce(nullif(btrim(p_to_log_id), ''), extensions.gen_random_uuid()::text);
    v_existing_count integer;
    v_happened_at timestamptz := coalesce(p_happened_at, now());
    v_from_cell_label text := coalesce(p_from_cell_label, '');
    v_to_cell_label text := coalesce(p_to_cell_label, '');
    v_from_kind text := coalesce(nullif(btrim(p_from_kind), ''), 'cell_resolution');
    v_to_kind text := coalesce(nullif(btrim(p_to_kind), ''), 'cell_resolution');
begin
    if not private.can_manage_game(p_game_id) then
        raise exception 'Host access denied';
    end if;
    if p_from_player_id is null or p_to_player_id is null or p_from_player_id = p_to_player_id then
        raise exception 'Players must be different';
    end if;
    if v_amount <= 0 then
        raise exception 'Amount must be greater than 0';
    end if;
    if v_from_log_id = v_to_log_id then
        raise exception 'Transfer log ids must be different';
    end if;

    perform 1
    from public.game_players player
    where player.game_id = p_game_id
      and player.id in (p_from_player_id, p_to_player_id)
    order by player.id
    for update;

    select player.* into v_from from public.game_players player
    where player.game_id = p_game_id and player.id = p_from_player_id;
    if not found then raise exception 'Source player not found'; end if;

    select player.* into v_to from public.game_players player
    where player.game_id = p_game_id and player.id = p_to_player_id;
    if not found then raise exception 'Target player not found'; end if;

    select count(*) into v_existing_count
    from public.score_logs log
    where log.id in (v_from_log_id, v_to_log_id);

    if v_existing_count = 1 then
        raise exception 'Partial transfer log id conflict';
    elsif v_existing_count = 2 then
        select log.* into v_from_log from public.score_logs log where log.id = v_from_log_id;
        select log.* into v_to_log from public.score_logs log where log.id = v_to_log_id;
        if v_from_log.game_id <> p_game_id
            or v_to_log.game_id <> p_game_id
            or v_from_log.player_id is distinct from p_from_player_id
            or v_to_log.player_id is distinct from p_to_player_id
            or v_from_log.cell_label <> v_from_cell_label
            or v_to_log.cell_label <> v_to_cell_label
            or v_from_log.outcome is distinct from p_from_outcome
            or v_to_log.outcome is distinct from p_to_outcome
            or v_from_log.delta <> -v_amount
            or v_to_log.delta <> v_amount
            or v_from_log.kind <> v_from_kind
            or v_to_log.kind <> v_to_kind then
            raise exception 'Transfer log id conflict';
        end if;
    else
        insert into public.score_logs (
            id, game_id, player_id, player_name, cell_label, outcome, delta,
            score_before, score_after, kind, happened_at
        ) values (
            v_from_log_id, p_game_id, v_from.id, v_from.name,
            v_from_cell_label, p_from_outcome, -v_amount,
            v_from.points, v_from.points - v_amount,
            v_from_kind, v_happened_at
        ) returning * into v_from_log;

        insert into public.score_logs (
            id, game_id, player_id, player_name, cell_label, outcome, delta,
            score_before, score_after, kind, happened_at
        ) values (
            v_to_log_id, p_game_id, v_to.id, v_to.name,
            v_to_cell_label, p_to_outcome, v_amount,
            v_to.points, v_to.points + v_amount,
            v_to_kind, v_happened_at
        ) returning * into v_to_log;

        update public.game_players player set points = v_from.points - v_amount
        where player.id = v_from.id returning player.* into v_from;

        update public.game_players player set points = v_to.points + v_amount
        where player.id = v_to.id returning player.* into v_to;
    end if;

    return query select
        v_from.id, v_from.game_id, v_from.name, v_from.points, v_from.joined_at,
        v_to.id, v_to.game_id, v_to.name, v_to.points, v_to.joined_at,
        v_from_log.id, v_from_log.game_id, v_from_log.player_id, v_from_log.player_name,
        v_from_log.cell_label, v_from_log.outcome, v_from_log.delta,
        v_from_log.score_before, v_from_log.score_after, v_from_log.kind,
        v_from_log.happened_at, v_from_log.created_at,
        v_to_log.id, v_to_log.game_id, v_to_log.player_id, v_to_log.player_name,
        v_to_log.cell_label, v_to_log.outcome, v_to_log.delta,
        v_to_log.score_before, v_to_log.score_after, v_to_log.kind,
        v_to_log.happened_at, v_to_log.created_at;
end;
$$;

revoke all on public.score_logs from public, anon, authenticated;
grant select on public.score_logs to authenticated;
grant all on public.score_logs to service_role;

revoke execute on function public.append_score_log(text, uuid, uuid, text, text, text, integer, integer, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function public.append_score_log(text, uuid, uuid, text, text, text, integer, integer, integer, text, timestamptz) to authenticated, service_role;

revoke execute on function public.clear_score_logs(uuid) from public, anon, authenticated;
grant execute on function public.clear_score_logs(uuid) to authenticated, service_role;

revoke execute on function public.adjust_game_player_score_with_log(uuid, uuid, integer, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.adjust_game_player_score_with_log(uuid, uuid, integer, text, text, text, text, timestamptz) to authenticated, service_role;

revoke execute on function public.transfer_game_player_score_with_logs(uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.transfer_game_player_score_with_logs(uuid, uuid, uuid, integer, text, text, text, text, text, text, text, text, timestamptz) to authenticated, service_role;
