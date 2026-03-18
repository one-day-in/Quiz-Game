alter table public.games enable row level security;

drop policy if exists "owners can delete games" on public.games;
drop policy if exists "admin can delete games" on public.games;
drop policy if exists "admins can delete games" on public.games;

create policy "admin can delete games"
on public.games
for delete
to authenticated
using (
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'skabullartem@gmail.com'
);
