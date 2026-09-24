create table public.games (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    data jsonb not null default '{}'::jsonb,
    created_by uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint games_name_not_blank check (length(btrim(name)) between 1 and 120),
    constraint games_data_is_object check (jsonb_typeof(data) = 'object')
);

create index games_created_by_updated_idx
on public.games (created_by, updated_at desc);

create trigger games_touch_updated_at
before update on public.games
for each row execute function private.touch_updated_at();

create function private.can_manage_game(p_game_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select
        (select auth.role()) = 'service_role'
        or exists (
            select 1
            from public.games game
            where game.id = p_game_id
              and game.created_by = (select auth.uid())
        )
        or private.is_admin();
$$;

alter table public.games enable row level security;

create policy "enabled hosts can create games"
on public.games
for insert
to authenticated
with check (
    created_by = (select auth.uid())
    and private.is_enabled_host()
);

create policy "owners and admins can read games"
on public.games
for select
to authenticated
using (created_by = (select auth.uid()) or private.is_admin());

create policy "owners and admins can update games"
on public.games
for update
to authenticated
using (created_by = (select auth.uid()) or private.is_admin())
with check (created_by = (select auth.uid()) or private.is_admin());

create policy "owners and admins can delete games"
on public.games
for delete
to authenticated
using (created_by = (select auth.uid()) or private.is_admin());

revoke all on public.games from public, anon, authenticated;
grant select, insert, update, delete on public.games to authenticated;
grant all on public.games to service_role;

revoke execute on function private.can_manage_game(uuid) from public, anon, authenticated;
grant execute on function private.can_manage_game(uuid) to authenticated, service_role;
