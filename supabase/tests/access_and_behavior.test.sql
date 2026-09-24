begin;

create extension if not exists pgtap with schema extensions;

select plan(28);

insert into auth.users (
    id, aud, role, email, encrypted_password,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
    ('00000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'owner@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'other@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'admin@example.test', '', '{}'::jsonb, '{}'::jsonb, now(), now());

insert into public.app_user_roles (user_id, role)
values
    ('00000000-0000-4000-8000-000000000001', 'host'),
    ('00000000-0000-4000-8000-000000000002', 'host'),
    ('00000000-0000-4000-8000-000000000003', 'admin');

insert into public.games (id, name, data, created_by)
values
    ('10000000-0000-4000-8000-000000000001', 'Owner game', '{}'::jsonb, '00000000-0000-4000-8000-000000000001'),
    ('10000000-0000-4000-8000-000000000002', 'Other game', '{}'::jsonb, '00000000-0000-4000-8000-000000000002');

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
    (select authorized from public.get_current_user_access()),
    true,
    'enabled host is authorized'
);
select is(
    (select role from public.get_current_user_access()),
    'host',
    'enabled host receives the host role'
);
select is(
    (select count(*) from public.games),
    1::bigint,
    'owner reads only their own games'
);
select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('media', '10000000-0000-4000-8000-000000000001/owner-upload.webp')$$,
    'owner can upload media inside their game folder'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000099', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
    (select authorized from public.get_current_user_access()),
    false,
    'unlisted user is not authorized'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select is(
    (select count(*) from public.games),
    2::bigint,
    'admin reads every game'
);
select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('media', '10000000-0000-4000-8000-000000000001/admin-upload.webp')$$,
    'admin can upload media inside another game folder'
);

reset role;

select ok(
    not has_table_privilege('anon', 'public.games', 'select'),
    'anon cannot read private game board rows'
);

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

select lives_ok(
    $$select * from public.claim_game_player(
        '10000000-0000-4000-8000-000000000001',
        'Alpha',
        'controller-token-alpha-0001'
    )$$,
    'anon can claim a player with a controller capability'
);
select lives_ok(
    $$select * from public.claim_game_player(
        '10000000-0000-4000-8000-000000000001',
        'Beta',
        'controller-token-beta-00002'
    )$$,
    'a second controller can claim another slot'
);
select lives_ok(
    $$select * from public.rename_game_player(
        '10000000-0000-4000-8000-000000000001',
        'controller-token-alpha-0001',
        'Alpha renamed'
    )$$,
    'controller capability can rename only its player'
);
select throws_ok(
    $$select * from public.rename_game_player(
        '10000000-0000-4000-8000-000000000001',
        'controller-token-wrong-00000',
        'Intruder'
    )$$,
    'P0001',
    'Player not found',
    'unknown controller capability cannot rename a player'
);

reset role;

insert into public.game_players (id, game_id, name, controller_token_hash)
select
    ('20000000-0000-4000-8000-' || lpad(slot::text, 12, '0'))::uuid,
    '10000000-0000-4000-8000-000000000001'::uuid,
    'Player ' || slot,
    private.hash_controller_token('controller-token-extra-' || lpad(slot::text, 4, '0'))
from generate_series(3, 8) slot;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

select throws_ok(
    $$select * from public.claim_game_player(
        '10000000-0000-4000-8000-000000000001',
        'Ninth',
        'controller-token-ninth-00009'
    )$$,
    'P0001',
    'No free player slots',
    'ninth player is rejected'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
    $$insert into public.game_runtime (
        game_id, press_enabled, press_status
    ) values (
        '10000000-0000-4000-8000-000000000001', true, 'open'
    )$$,
    'owner can open the press runtime'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'anon', true);
set local role anon;

select lives_ok(
    $$select public.claim_game_press(
        '10000000-0000-4000-8000-000000000001',
        'controller-token-alpha-0001'
    )$$,
    'first controller claims the press'
);
select throws_ok(
    $$select public.claim_game_press(
        '10000000-0000-4000-8000-000000000001',
        'controller-token-beta-00002'
    )$$,
    'P0001',
    'Press is closed',
    'second controller cannot replace the winner'
);
select is(
    (select winner_player_id from public.game_runtime where game_id = '10000000-0000-4000-8000-000000000001'),
    (select id from public.game_players where name = 'Alpha renamed'),
    'runtime keeps the first winner'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
    $$select * from public.adjust_game_player_score_with_log(
        '10000000-0000-4000-8000-000000000001',
        (select id from public.game_players where name = 'Alpha renamed'),
        100,
        'score-request-1',
        'R1C1',
        'correct',
        'cell_resolution',
        '2026-09-22T00:00:00Z'
    )$$,
    'owner can atomically adjust score and log it'
);
select lives_ok(
    $$select * from public.adjust_game_player_score_with_log(
        '10000000-0000-4000-8000-000000000001',
        (select id from public.game_players where name = 'Alpha renamed'),
        100,
        'score-request-1',
        'R1C1',
        'correct',
        'cell_resolution',
        '2026-09-22T00:00:00Z'
    )$$,
    'identical score request is idempotent'
);
select is(
    (select points from public.game_players where name = 'Alpha renamed'),
    100,
    'idempotent retry applies score exactly once'
);
select throws_ok(
    $$select * from public.adjust_game_player_score_with_log(
        '10000000-0000-4000-8000-000000000001',
        (select id from public.game_players where name = 'Alpha renamed'),
        200,
        'score-request-1',
        'R1C1',
        'correct',
        'cell_resolution',
        '2026-09-22T00:00:00Z'
    )$$,
    'P0001',
    'Score log id conflict',
    'same score request id rejects a different payload'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('media', '10000000-0000-4000-8000-000000000001/non-owner-upload.webp')$$,
    '42501',
    'new row violates row-level security policy for table "objects"',
    'non-owner cannot upload media inside another game folder'
);

select throws_ok(
    $$select * from public.adjust_game_player_score_with_log(
        '10000000-0000-4000-8000-000000000001',
        (select id from public.game_players where name = 'Alpha renamed'),
        100,
        'score-request-other',
        'R1C1',
        'correct',
        'cell_resolution',
        '2026-09-22T00:00:00Z'
    )$$,
    'P0001',
    'Host access denied',
    'non-owner cannot mutate another game score'
);

reset role;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;

select lives_ok(
    $$select * from public.adjust_game_player_score_with_log(
        '10000000-0000-4000-8000-000000000001',
        (select id from public.game_players where name = 'Alpha renamed'),
        5,
        'score-request-service',
        'manual',
        null,
        'manual',
        '2026-09-22T00:01:00Z'
    )$$,
    'service role can perform trusted score mutation'
);
select is(
    (select points from public.game_players where name = 'Alpha renamed'),
    105,
    'service-role mutation is persisted'
);

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

select lives_ok(
    $$select public.resolve_game_press(
        '10000000-0000-4000-8000-000000000001',
        (select id from public.game_players where name = 'Alpha renamed'),
        true
    )$$,
    'owner can resolve and reopen the press runtime'
);
select is(
    (select press_status from public.game_runtime where game_id = '10000000-0000-4000-8000-000000000001'),
    'open',
    'resolved runtime is reopened explicitly'
);
select is(
    (select winner_player_id from public.game_runtime where game_id = '10000000-0000-4000-8000-000000000001'),
    null::uuid,
    'resolved runtime clears the winner'
);

select * from finish();
rollback;
