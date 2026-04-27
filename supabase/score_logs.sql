create table if not exists public.score_logs (
    id text primary key,
    game_id uuid not null references public.games(id) on delete cascade,
    player_id uuid null references public.game_players(id) on delete set null,
    player_name text not null,
    cell_label text not null default '',
    outcome text null,
    delta integer not null default 0,
    kind text not null default 'manual',
    happened_at timestamptz not null default timezone('utc', now()),
    created_at timestamptz not null default timezone('utc', now())
);

create index if not exists score_logs_game_happened_idx
    on public.score_logs (game_id, happened_at desc);

alter table public.score_logs enable row level security;

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

