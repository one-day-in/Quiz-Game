create table if not exists public.game_runtime (
    game_id uuid primary key references public.games(id) on delete cascade,
    press_enabled boolean not null default false,
    updated_at timestamptz not null default timezone('utc', now())
);

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
