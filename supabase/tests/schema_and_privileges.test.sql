begin;

create extension if not exists pgtap with schema extensions;

select plan(29);

select has_table('public', 'profiles', 'profiles table exists');
select has_table('public', 'app_user_roles', 'app_user_roles table exists');
select has_table('public', 'games', 'games table exists');
select has_table('public', 'game_players', 'game_players table exists');
select has_table('public', 'game_runtime', 'game_runtime table exists');
select has_table('public', 'score_logs', 'score_logs table exists');

select has_column('public', 'game_players', 'controller_token_hash', 'controller tokens are stored as hashes');
select has_column('public', 'game_runtime', 'press_expires_at', 'runtime has server deadline');
select has_column('public', 'game_runtime', 'press_status', 'runtime has status');
select has_column('public', 'game_runtime', 'resolved_at', 'runtime tracks resolution time');
select has_column('public', 'game_runtime', 'resolved_by', 'runtime tracks resolver');

select ok(
    exists (
        select 1 from pg_constraint
        where conrelid = 'public.game_runtime'::regclass
          and conname = 'game_runtime_winner_belongs_to_game'
          and contype = 'f'
    ),
    'runtime winner must belong to the same game'
);
select ok(
    exists (
        select 1 from pg_constraint
        where conrelid = 'public.game_runtime'::regclass
          and conname = 'game_runtime_status_enabled_consistent'
          and contype = 'c'
    ),
    'runtime status and enabled state are constrained'
);

select has_function('public', 'get_current_user_access', array[]::text[], 'access RPC exists');
select has_function('public', 'get_game_player_by_controller', array['uuid', 'text'], 'controller lookup RPC exists');
select has_function('public', 'claim_game_player', array['uuid', 'text', 'text'], 'player claim RPC exists');
select has_function('public', 'claim_game_press', array['uuid', 'text'], 'press claim RPC exists');
select has_function('public', 'resolve_game_press', array['uuid', 'uuid', 'boolean'], 'press resolution RPC exists');
select has_function('public', 'resolve_game_press_timeout', array['uuid', 'uuid', 'timestamp with time zone'], 'timeout RPC exists');
select has_function('public', 'adjust_game_player_score_with_log', array['uuid', 'uuid', 'integer', 'text', 'text', 'text', 'text', 'timestamp with time zone'], 'atomic score RPC exists');
select has_function('public', 'transfer_game_player_score_with_logs', array['uuid', 'uuid', 'uuid', 'integer', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'timestamp with time zone'], 'atomic transfer RPC exists');

select ok(
    not has_column_privilege('anon', 'public.game_players', 'controller_token_hash', 'select'),
    'anon cannot read controller token hashes'
);
select ok(
    not has_function_privilege('anon', 'public.adjust_game_player_score_by_id(uuid,uuid,integer)', 'execute'),
    'anon cannot mutate scores'
);
select ok(
    not has_function_privilege('anon', 'public.clear_score_logs(uuid)', 'execute'),
    'anon cannot clear score logs'
);

select is((select count(*) from storage.buckets where id = 'media'), 1::bigint, 'media bucket exists');
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'), 1::bigint, 'games is in Realtime publication');
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_players'), 1::bigint, 'game_players is in Realtime publication');
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_runtime'), 1::bigint, 'game_runtime is in Realtime publication');
select is((select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'score_logs'), 1::bigint, 'score_logs is in Realtime publication');

select * from finish();
rollback;
