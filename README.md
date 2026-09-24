# Quiz-Game

Browser-based quiz board with three surfaces:

- `index.html`: host game board and question modal
- `leaderboard.html`: public leaderboard and player join QR
- `player.html`: mobile player controller
- `host-controller.html`: host controller mirror (tablet/desktop) with remote commands

The app is built with Vite and uses Supabase for auth, storage, realtime, and game data.
Board/player persistence stays in Supabase, while low-latency buzzer transport is now handled by a dedicated WebSocket coordinator in `server/buzzerServer.js`.

## Features

- Google sign-in for hosts
- owner-scoped game creation and editing
- separate player state in `game_players`
- separate runtime press state in `game_runtime`
- mobile player controller with batched score updates
- leaderboard sorted by score descending
- question modal winner flow driven by first `PRESS`
- scrollable lobby game list for large game collections
- directed-bet cell modifier:
  - host selects which non-active player must answer
  - selected player gets a custom stake from `100..500`
  - selected player gets a dedicated 40-second timer while question stays visible
  - on timeout/incorrect, flow returns to normal `PRESS` with the base cell value
- press opening in modal now retries automatically on transient runtime failures
- host controller QR in the footer panel:
  - separate QR for player controller
  - separate QR for host controller
  - host controller can open cells on the main host screen
  - controller modal shows question + answer together
  - media in controller modal is controlled via `Play/Stop` commands sent to the main screen

## Local Development

Requirements:

- Node.js 20+
- Docker Desktop (for the local Supabase stack)
- a new Supabase project only when you are ready for remote deployment

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example` and fill in your Supabase values.

Run locally:

```bash
npm run dev
```

Run the dedicated buzzer server locally in a second terminal:

```bash
npm run buzzer:dev
```

Build for production:

```bash
npm run build
```

Run tests:

```bash
npm test
```

## Supabase Setup

Timestamped files in [supabase/migrations](/Users/oneday_in/Desktop/Quiz-Game/supabase/migrations) are the only deployable schema source. The older root-level `supabase/*.sql` files are historical reference and must not be applied to a new project.

Start the local stack and recreate the database entirely from Git:

```bash
npm run supabase:start
npm run db:reset
npm run db:test
npm run db:test:concurrency
```

For a local browser smoke test against that stack, create the disposable local-only host, then run the frontend and buzzer in separate terminals:

```bash
npm run smoke:user:setup
npm run dev:local
npm run buzzer:local
```

When finished, remove the disposable host and stop Supabase:

```bash
npm run smoke:user:cleanup
npm run supabase:stop
```

`dev:local`, `buzzer:local`, and the smoke-user scripts read credentials from the local Supabase CLI. They are for the disposable local stack only and do not modify `.env`.

The migrations create the access model, profiles, games, controller-token hashes, player/runtime/score RPCs, RLS policies, `media` bucket policies, and required Realtime publications. [supabase/seed.sql](/Users/oneday_in/Desktop/Quiz-Game/supabase/seed.sql) intentionally contains no users or secrets.

To provision the first admin after that user has signed in once, run this only from a trusted shell with a server-side service-role key:

```bash
SUPABASE_URL=https://your-project.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
npm run admin:grant -- <auth-user-uuid>
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` through a `VITE_` variable, browser bundle, committed file, or public CI log.

## Buzzer Server

The buzzer server is a separate runtime from GitHub Pages. It is responsible for:

- low-latency `PRESS` activation
- first-press arbitration
- broadcasting winner state to all connected controllers
- persisting winner state back to Supabase

Required environment variables:

- `VITE_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `BUZZER_PORT`
- `VITE_BUZZER_WS_URL` for the frontend build

The repository includes:

- [server/buzzerServer.js](/Users/oneday_in/Desktop/Quiz-Game/server/buzzerServer.js)
- [Dockerfile](/Users/oneday_in/Desktop/Quiz-Game/Dockerfile)

Example production run:

```bash
npm run buzzer:start
```

## Main Flow

1. Host signs in and creates a game.
2. Host opens `Leaderboard` and shows the QR drawer.
3. Players join from `player.html?gameId=...`.
4. Host opens a question modal.
5. `PRESS` becomes active after 2 seconds.
6. The first player to press becomes the modal winner.
7. Audio-only question/answer sections now show a larger custom modal player instead of browser-native controls.
8. `✕ Not Correct` atomically resolves the winner, subtracts the cell value, and re-opens the press race.
9. `✓ Correct` atomically resolves the winner, adds the cell value, and closes the modal.
10. For the directed-bet modifier, host first chooses a non-active player and stake (`100..500`), then starts a 40-second answer window for that player.
11. If directed-bet times out or is incorrect, normal `PRESS` opens for other players using the base cell value.

## Project Structure

- [src/bootstrap.js](/Users/oneday_in/Desktop/Quiz-Game/src/bootstrap.js): app startup and routing
- [src/api/gameApi.js](/Users/oneday_in/Desktop/Quiz-Game/src/api/gameApi.js): Supabase reads, writes, realtime, RPC
- [src/services/ModalService.js](/Users/oneday_in/Desktop/Quiz-Game/src/services/ModalService.js): host modal behavior
- [src/player.js](/Users/oneday_in/Desktop/Quiz-Game/src/player.js): mobile controller
- [src/leaderboard.js](/Users/oneday_in/Desktop/Quiz-Game/src/leaderboard.js): leaderboard page
- [src/views](/Users/oneday_in/Desktop/Quiz-Game/src/views): UI view layer
- [public/css](/Users/oneday_in/Desktop/Quiz-Game/public/css): styles

## Verification

Current repository checks:

- `npm run build`
- `npm test`
- `npm run db:reset`
- `npm run db:test`
- `npm run db:test:concurrency`

Manual smoke test before release:

1. create a game
2. join at least two players
3. open a question modal
4. verify `PRESS` is disabled for 2 seconds
5. verify first press shows winner name in modal
6. verify `Not Correct` resets the race
7. verify `Correct` updates score and closes the modal

## Server Press Timer (Authoritative)

The press response timer is server-authoritative. Frontend countdown is only a UI mirror based on `game_runtime.press_expires_at`.

### Required RPC functions

The migration-owned runtime exposes:

- `claim_game_press(uuid, text)`:
  - atomically claims winner
  - sets `press_status = 'claimed'`
  - sets `press_expires_at = now() + interval '30 seconds'`
  - clears `resolved_at/resolved_by`
- `resolve_game_press(uuid, uuid, boolean)`:
  - requires the expected winner and owner/admin access
  - clears claim fields and either closes or reopens the race
- `resolve_game_press_timeout(uuid, uuid, timestamptz)`:
  - resolves only if the same winner is still active and deadline has passed
  - prevents duplicate or stale timeout penalties

### Frontend fallback env (optional)

`VITE_PRESS_RESPONSE_SECONDS` is a fallback UI duration if `press_expires_at` is missing.  
Recommended value: `30`.

### Verification checklist

1. Open modal and wait for `PRESS` opening delay.
2. Player presses: winner appears, timer starts from server deadline.
3. Press `Показать ответ` and keep answer view open past 30s:
   - score must NOT auto-decrease while answer is visible.
4. Return to question view:
   - if deadline already passed, timeout resolves once.
5. `Not Correct`:
   - subtracts exactly cell value once
   - reopens race correctly.
6. `Correct`:
   - adds exactly cell value once
   - closes modal and clears runtime claim/timer.
