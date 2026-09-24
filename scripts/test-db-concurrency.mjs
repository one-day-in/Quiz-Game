import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { getLocalSupabaseCredentials } from './local-supabase-env.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const {
  url: supabaseUrl,
  anonKey,
  serviceRoleKey,
} = getLocalSupabaseCredentials();

const clientOptions = {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
};
const anon = createClient(supabaseUrl, anonKey, clientOptions);
const service = createClient(supabaseUrl, serviceRoleKey, clientOptions);

const runId = randomUUID();
const gameId = randomUUID();
const email = `concurrency-${runId}@example.test`;
const password = `Test-${randomUUID()}-Aa1!`;
let userId = null;

try {
  const { data: createdUser, error: createUserError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createUserError) throw createUserError;
  userId = createdUser.user.id;

  const { error: accessError } = await service
    .from('app_user_roles')
    .insert({ user_id: userId, role: 'host', enabled: true });
  if (accessError) throw accessError;

  const { error: gameError } = await service
    .from('games')
    .insert({ id: gameId, name: `Concurrency ${runId}`, data: {}, created_by: userId });
  if (gameError) throw gameError;

  const controllerTokens = Array.from(
    { length: 12 },
    (_, index) => `controller-${runId}-${String(index + 1).padStart(2, '0')}`
  );
  const joinResults = await Promise.all(
    controllerTokens.map((controllerId, index) => anon.rpc('claim_game_player', {
      p_game_id: gameId,
      p_name: `Player ${index + 1}`,
      p_controller_id: controllerId,
    }))
  );
  const joined = joinResults.filter((result) => !result.error);
  const rejected = joinResults.filter((result) => result.error);
  assert(joined.length === 8, `Expected 8 successful joins, received ${joined.length}`);
  assert(rejected.length === 4, `Expected 4 rejected joins, received ${rejected.length}`);
  assert(
    rejected.every((result) => result.error.message.includes('No free player slots')),
    'Concurrent join failures must be caused by the eight-player limit'
  );

  const acceptedTokens = controllerTokens.filter((_, index) => !joinResults[index].error);
  const { data: players, error: playersError } = await service
    .from('game_players')
    .select('id, points')
    .eq('game_id', gameId);
  if (playersError) throw playersError;
  assert(players.length === 8, `Expected 8 persisted players, received ${players.length}`);

  const { error: runtimeError } = await service
    .from('game_runtime')
    .insert({ game_id: gameId, press_enabled: true, press_status: 'open' });
  if (runtimeError) throw runtimeError;

  const pressResults = await Promise.all(
    acceptedTokens.map((controllerId) => anon.rpc('claim_game_press', {
      p_game_id: gameId,
      p_controller_id: controllerId,
    }))
  );
  const pressWinners = pressResults.filter((result) => !result.error);
  const pressLosers = pressResults.filter((result) => result.error);
  assert(pressWinners.length === 1, `Expected one press winner, received ${pressWinners.length}`);
  assert(pressLosers.length === 7, `Expected seven rejected presses, received ${pressLosers.length}`);
  assert(
    pressLosers.every((result) => result.error.message.includes('Press is closed')),
    'Concurrent losing presses must observe the closed race'
  );

  const playerId = players[0].id;
  const logId = `concurrency-score-${runId}`;
  const scoreResults = await Promise.all(
    Array.from({ length: 12 }, () => service.rpc('adjust_game_player_score_with_log', {
      p_game_id: gameId,
      p_player_id: playerId,
      p_delta: 100,
      p_log_id: logId,
      p_cell_label: 'concurrency',
      p_outcome: 'correct',
      p_kind: 'test',
      p_happened_at: '2026-09-23T00:00:00Z',
    }))
  );
  assert(
    scoreResults.every((result) => !result.error),
    'Identical concurrent score requests must all resolve idempotently'
  );

  const { data: scoredPlayer, error: scoredPlayerError } = await service
    .from('game_players')
    .select('points')
    .eq('id', playerId)
    .single();
  if (scoredPlayerError) throw scoredPlayerError;
  assert(scoredPlayer.points === 100, `Expected one score application, received ${scoredPlayer.points}`);

  const { count: logCount, error: logCountError } = await service
    .from('score_logs')
    .select('id', { count: 'exact', head: true })
    .eq('id', logId);
  if (logCountError) throw logCountError;
  assert(logCount === 1, `Expected one score log, received ${logCount}`);

  const { error: conflictError } = await service.rpc('adjust_game_player_score_with_log', {
    p_game_id: gameId,
    p_player_id: playerId,
    p_delta: 200,
    p_log_id: logId,
    p_cell_label: 'concurrency',
    p_outcome: 'correct',
    p_kind: 'test',
    p_happened_at: '2026-09-23T00:00:00Z',
  });
  assert(conflictError?.message.includes('Score log id conflict'), 'Changed duplicate payload must conflict');

  console.log('Concurrency checks passed: joins=8/12, press_winners=1/8, score_applications=1/12.');
} finally {
  if (userId) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) console.error(`Concurrency cleanup failed: ${error.message}`);
  }
}
