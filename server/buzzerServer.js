import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { createClient } from '@supabase/supabase-js';

const port = Number(process.env.BUZZER_PORT || 8787);
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('[buzzer] Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

const rooms = new Map();

function normalizeRuntime(gameId, row, winnerName = null) {
  return {
    gameId: row?.game_id || gameId,
    pressEnabled: !!row?.press_enabled,
    winnerPlayerId: row?.winner_player_id || null,
    winnerName: winnerName || null,
    pressedAt: row?.pressed_at || null,
    updatedAt: row?.updated_at || null,
  };
}

async function fetchWinnerName(winnerPlayerId) {
  if (!winnerPlayerId) return null;
  const { data, error } = await supabase
    .from('game_players')
    .select('name')
    .eq('id', winnerPlayerId)
    .maybeSingle();

  if (error) throw new Error(`[buzzer] fetch winner failed: ${error.message}`);
  return data?.name || null;
}

async function loadRuntime(gameId) {
  const { data, error } = await supabase
    .from('game_runtime')
    .select('game_id, press_enabled, winner_player_id, pressed_at, updated_at')
    .eq('game_id', gameId)
    .maybeSingle();

  if (error) throw new Error(`[buzzer] load runtime failed: ${error.message}`);
  const winnerName = await fetchWinnerName(data?.winner_player_id);
  return normalizeRuntime(gameId, data, winnerName);
}

async function setPressState(gameId, enabled) {
  const { data, error } = await supabase
    .from('game_runtime')
    .upsert({
      game_id: gameId,
      press_enabled: !!enabled,
      winner_player_id: null,
      pressed_at: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'game_id' })
    .select('game_id, press_enabled, winner_player_id, pressed_at, updated_at')
    .single();

  if (error) throw new Error(`[buzzer] set press state failed: ${error.message}`);
  return normalizeRuntime(gameId, data, null);
}

async function claimPress(gameId, controllerId) {
  const { data, error } = await supabase.rpc('claim_game_press', {
    p_game_id: gameId,
    p_controller_id: controllerId,
  });

  if (error) throw new Error(error.message || 'Press is closed');

  const row = Array.isArray(data) ? data[0] : data;
  return {
    gameId: row?.game_id || gameId,
    pressEnabled: !!row?.press_enabled,
    winnerPlayerId: row?.winner_player_id || null,
    winnerName: row?.winner_name || null,
    pressedAt: row?.pressed_at || null,
    updatedAt: new Date().toISOString(),
  };
}

async function assertHostAccess(gameId, accessToken) {
  if (!accessToken) throw new Error('Host session is required');

  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error) throw new Error(`Host auth failed: ${error.message}`);

  const userId = data?.user?.id;
  if (!userId) throw new Error('Host user not found');

  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('created_by')
    .eq('id', gameId)
    .maybeSingle();

  if (gameError) throw new Error(`Host game lookup failed: ${gameError.message}`);
  if (!game || game.created_by !== userId) throw new Error('Host access denied');

  return userId;
}

async function getRoom(gameId) {
  let room = rooms.get(gameId);
  if (room) return room;

  room = {
    gameId,
    clients: new Set(),
    state: await loadRuntime(gameId),
    claimInFlight: false,
  };
  rooms.set(gameId, room);
  return room;
}

function broadcast(room, payload) {
  const message = JSON.stringify(payload);
  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

async function handleHello(ws, message) {
  const gameId = String(message?.gameId || '').trim();
  const role = message?.role === 'host' ? 'host' : 'player';
  if (!gameId) throw new Error('gameId is required');

  if (role === 'host') {
    await assertHostAccess(gameId, message?.accessToken || null);
  }

  const room = await getRoom(gameId);
  ws.gameId = gameId;
  ws.role = role;
  ws.controllerId = message?.controllerId || null;
  room.clients.add(ws);

  send(ws, {
    type: 'snapshot',
    state: room.state,
  });
}

async function handleRequest(ws, message) {
  const requestId = message?.requestId || null;
  const room = ws.gameId ? rooms.get(ws.gameId) : null;

  if (!room) throw new Error('Room is not ready');

  if (message.type === 'host_open_press') {
    if (ws.role !== 'host') throw new Error('Host access required');
    room.state = await setPressState(room.gameId, true);
    broadcast(room, { type: 'runtime', state: room.state });
    send(ws, { type: 'response', requestId, ok: true, data: { state: room.state } });
    return;
  }

  if (message.type === 'host_close_press') {
    if (ws.role !== 'host') throw new Error('Host access required');
    room.state = await setPressState(room.gameId, false);
    broadcast(room, { type: 'runtime', state: room.state });
    send(ws, { type: 'response', requestId, ok: true, data: { state: room.state } });
    return;
  }

  if (message.type === 'player_claim_press') {
    if (room.claimInFlight || !room.state.pressEnabled || room.state.winnerPlayerId) {
      throw new Error('Press is closed');
    }

    room.claimInFlight = true;
    try {
      room.state = await claimPress(room.gameId, message?.controllerId || ws.controllerId || null);
      broadcast(room, { type: 'runtime', state: room.state });
      send(ws, { type: 'response', requestId, ok: true, data: { state: room.state } });
    } finally {
      room.claimInFlight = false;
    }
    return;
  }

  throw new Error(`Unsupported message type: ${message?.type || 'unknown'}`);
}

const server = createServer((_, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ ok: true, service: 'quiz-game-buzzer' }));
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', async (raw) => {
    try {
      const message = JSON.parse(String(raw));
      if (message?.type === 'hello') {
        await handleHello(ws, message);
        return;
      }

      await handleRequest(ws, message);
    } catch (error) {
      let requestId = null;
      try {
        const parsed = JSON.parse(String(raw));
        requestId = parsed?.requestId || null;
      } catch {}

      if (requestId) {
        send(ws, {
          type: 'response',
          requestId,
          ok: false,
          error: error.message || 'Buzzer request failed',
        });
      } else {
        send(ws, {
          type: 'error',
          error: error.message || 'Buzzer request failed',
        });
        ws.close();
      }
    }
  });

  ws.on('close', () => {
    const room = ws.gameId ? rooms.get(ws.gameId) : null;
    if (!room) return;
    room.clients.delete(ws);
    if (room.clients.size === 0) {
      rooms.delete(ws.gameId);
    }
  });
});

server.listen(port, () => {
  console.log(`[buzzer] listening on ws://localhost:${port}`);
});
