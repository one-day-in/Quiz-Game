insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', true, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

create policy "public can read media"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'media');

create policy "owners and admins can upload media"
on storage.objects
for insert
to authenticated
with check (
    bucket_id = 'media'
    and exists (
        select 1
        from public.games game
        where game.id::text = (storage.foldername(storage.objects.name))[1]
          and private.can_manage_game(game.id)
    )
);

create policy "owners and admins can update media"
on storage.objects
for update
to authenticated
using (
    bucket_id = 'media'
    and exists (
        select 1
        from public.games game
        where game.id::text = (storage.foldername(storage.objects.name))[1]
          and private.can_manage_game(game.id)
    )
)
with check (
    bucket_id = 'media'
    and exists (
        select 1
        from public.games game
        where game.id::text = (storage.foldername(storage.objects.name))[1]
          and private.can_manage_game(game.id)
    )
);

create policy "owners and admins can delete media"
on storage.objects
for delete
to authenticated
using (
    bucket_id = 'media'
    and exists (
        select 1
        from public.games game
        where game.id::text = (storage.foldername(storage.objects.name))[1]
          and private.can_manage_game(game.id)
    )
);

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
    ) then
        alter publication supabase_realtime add table public.games;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_players'
    ) then
        alter publication supabase_realtime add table public.game_players;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_runtime'
    ) then
        alter publication supabase_realtime add table public.game_runtime;
    end if;
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'score_logs'
    ) then
        alter publication supabase_realtime add table public.score_logs;
    end if;
end;
$$;
