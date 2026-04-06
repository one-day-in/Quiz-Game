alter table public.games enable row level security;

drop policy if exists "public can read games" on public.games;
drop policy if exists "authenticated users can create games" on public.games;
drop policy if exists "owners can update games" on public.games;

create policy "public can read games"
on public.games
for select
to anon, authenticated
using (true);

create policy "authenticated users can create games"
on public.games
for insert
to authenticated
with check (created_by = auth.uid());

create policy "owners can update games"
on public.games
for update
to authenticated
using (created_by = auth.uid())
with check (created_by = auth.uid());
