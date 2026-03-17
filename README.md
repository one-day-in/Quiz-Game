# Quiz Game

Browser-based quiz board with three surfaces:

- `index.html`: host game board and question modal
- `leaderboard.html`: public leaderboard and player join QR
- `player.html`: mobile player controller

The app is built with Vite and uses Supabase for auth, storage, realtime, and game data.

## Features

- Google sign-in for hosts
- owner-scoped game creation and editing
- separate player state in `game_players`
- separate runtime press state in `game_runtime`
- mobile player controller with batched score updates
- leaderboard sorted by score descending
- question modal winner flow driven by first `PRESS`

## Local Development

Requirements:

- Node.js 20+
- a Supabase project

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example` and fill in your Supabase values.

Run locally:

```bash
npm run dev
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

The project expects:

- a `games` table for board data
- a `game_players` table and RPC functions for player join/rename/score/leave
- a `game_runtime` table and `claim_game_press(...)` for press winner state
- a `media` storage bucket

Apply the SQL files in [/Users/oneday_in/Desktop/project/supabase](/Users/oneday_in/Desktop/project/supabase):

- [game_players.sql](/Users/oneday_in/Desktop/project/supabase/game_players.sql)
- [game_runtime.sql](/Users/oneday_in/Desktop/project/supabase/game_runtime.sql)

Recommended `games` RLS:

- `SELECT`: authenticated users can read
- `INSERT`: authenticated users can create with `created_by = auth.uid()`
- `UPDATE`/`DELETE`: only the owner can modify

## Main Flow

1. Host signs in and creates a game.
2. Host opens `Leaderboard` and shows the QR drawer.
3. Players join from `player.html?gameId=...`.
4. Host opens a question modal.
5. `PRESS` becomes active after 2 seconds.
6. The first player to press becomes the modal winner.
7. `✕ Not Correct` subtracts the cell value and re-opens the press race.
8. `✓ Correct` adds the cell value and closes the modal.

## Project Structure

- [src/bootstrap.js](/Users/oneday_in/Desktop/project/src/bootstrap.js): app startup and routing
- [src/api/gameApi.js](/Users/oneday_in/Desktop/project/src/api/gameApi.js): Supabase reads, writes, realtime, RPC
- [src/services/ModalService.js](/Users/oneday_in/Desktop/project/src/services/ModalService.js): host modal behavior
- [src/player.js](/Users/oneday_in/Desktop/project/src/player.js): mobile controller
- [src/leaderboard.js](/Users/oneday_in/Desktop/project/src/leaderboard.js): leaderboard page
- [src/views](/Users/oneday_in/Desktop/project/src/views): UI view layer
- [public/css](/Users/oneday_in/Desktop/project/public/css): styles

## Verification

Current repository checks:

- `npm run build`
- `npm test`

Manual smoke test before release:

1. create a game
2. join at least two players
3. open a question modal
4. verify `PRESS` is disabled for 2 seconds
5. verify first press shows winner name in modal
6. verify `Not Correct` resets the race
7. verify `Correct` updates score and closes the modal
