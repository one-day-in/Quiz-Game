create table if not exists public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    email text,
    full_name text,
    avatar_url text,
    updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles enable row level security;

drop policy if exists "public can read profiles" on public.profiles;
drop policy if exists "users can upsert own profile" on public.profiles;
drop policy if exists "users can update own profile" on public.profiles;
drop policy if exists "users can insert own profile" on public.profiles;

create policy "public can read profiles"
on public.profiles
for select
to anon, authenticated
using (true);

create policy "users can insert own profile"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

create policy "users can update own profile"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);
