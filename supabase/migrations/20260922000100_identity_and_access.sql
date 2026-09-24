create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create type public.app_role as enum ('host', 'admin');

create table public.app_user_roles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    role public.app_role not null default 'host',
    enabled boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    full_name text not null default '',
    avatar_url text not null default '',
    updated_at timestamptz not null default now()
);

create function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger app_user_roles_touch_updated_at
before update on public.app_user_roles
for each row execute function private.touch_updated_at();

create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function private.touch_updated_at();

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.app_user_roles access
        where access.user_id = (select auth.uid())
          and access.role = 'admin'::public.app_role
          and access.enabled
    );
$$;

create function private.is_enabled_host()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.app_user_roles access
        where access.user_id = (select auth.uid())
          and access.enabled
          and access.role in ('host'::public.app_role, 'admin'::public.app_role)
    );
$$;

create function public.get_current_user_access()
returns table (
    authorized boolean,
    role text
)
language sql
stable
security definer
set search_path = ''
as $$
    select
        coalesce(access.enabled, false) as authorized,
        case when access.enabled then access.role::text else null end as role
    from (select (select auth.uid()) as user_id) caller
    left join public.app_user_roles access on access.user_id = caller.user_id;
$$;

alter table public.app_user_roles enable row level security;
alter table public.profiles enable row level security;

create policy "authenticated users can read profiles"
on public.profiles
for select
to authenticated
using (true);

create policy "users can insert their profile"
on public.profiles
for insert
to authenticated
with check (id = (select auth.uid()));

create policy "users can update their profile"
on public.profiles
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

revoke all on public.app_user_roles from public, anon, authenticated;
revoke all on public.profiles from public, anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant all on public.app_user_roles, public.profiles to service_role;

revoke execute on function private.touch_updated_at() from public, anon, authenticated;
revoke execute on function private.is_admin() from public, anon, authenticated;
revoke execute on function private.is_enabled_host() from public, anon, authenticated;
grant execute on function private.is_admin() to authenticated, service_role;
grant execute on function private.is_enabled_host() to authenticated, service_role;

revoke execute on function public.get_current_user_access() from public, anon, authenticated;
grant execute on function public.get_current_user_access() to authenticated;

alter default privileges for role postgres in schema public revoke execute on functions from public;
