# PROJECT_STATE

Last updated: 2026-04-01

## Real Project Overview

Quiz-Game is a browser-based realtime quiz board built with vanilla JavaScript and Vite. It has three user-facing surfaces:

- Host board at `index.html`
- Standalone leaderboard at `leaderboard.html`
- Mobile player controller at `player.html`

The host signs in with Google, creates or opens a game, edits board content, opens question modals, and controls answer adjudication. Players join the game through a QR flow, claim a controller slot, can rename themselves, can manually adjust their own score from the phone UI, and can race to press during an open question. Scores and player identity live in Supabase tables, while board content lives as JSON in the `games` table.

The app is realtime, but not purely realtime. It mixes:

- Supabase auth events
- Supabase `postgres_changes` subscriptions
- explicit polling fallbacks
- optimistic local UI state
- DOM-first rendering without a framework

## Real Architecture (From Code)

### Entry Points

- `index.html` -> `src/index.js` -> `src/bootstrap.js`
- `leaderboard.html` -> `src/leaderboard.js`
- `player.html` -> `src/player.js`

### Main Host Stack

- `bootstrap.js`
  - checks auth session
  - syncs current profile
  - restores last opened game from `localStorage`
  - creates repository/services/controller stack
- `AppController.js`
  - binds `GameService` state to `AppView`
  - routes cell clicks into `ModalService`
  - avoids full grid rerender while modal is open
- `views/AppView.js`
  - renders header, game grid, footer leaderboard
  - directly subscribes to `game_players` for footer updates
- `services/ModalService.js`
  - owns question modal lifecycle
  - updates board cells
  - resets and observes press runtime
  - adjusts score on correct/incorrect actions

### Data / Service Layer

- `services/GameRepository.js`
  - thin adapter around `gameApi` and `mediaApi`
- `services/GameService.js`
  - owns in-memory `GameModel`
  - owns local host UI state such as active round
  - performs optimistic board updates and rollback on failure
- `services/MediaService.js`
  - view/media mapping and upload/delete orchestration
- `services/RoundNavigationService.js`
  - round picker state helper

### API Layer

- `api/gameApi.js`
  - compatibility barrel that re-exports focused API modules
- `api/gameApi.shared.js`
  - shared constants, normalization, default game builders, row fetch helpers
- `api/lobbyApi.js`
  - game list, create, rename, delete
- `api/boardApi.js`
  - board CRUD, board subscriptions, board-level audio/reset helpers
- `api/playersApi.js`
  - player CRUD, score mutation, player subscriptions
- `api/runtimeApi.js`
  - press race reads/writes and runtime subscriptions
- `api/authApi.js`
  - Google sign-in and auth session helpers
- `api/profileApi.js`
  - profile upsert and lookup
- `api/mediaApi.js`
  - Supabase storage upload/delete/list helpers
- `api/supabaseClient.js`
  - creates raw Supabase client from env vars

### View Layer

- `views/GameGridView.js`
  - board grid and topic editing
- `views/HeaderView.js`
  - host header with lobby/back and round switcher
- `views/LeaderboardGridView.js`
  - shared leaderboard renderer for page and embedded footer
- `views/LeaderboardDrawerView.js`
  - old QR drawer for standalone leaderboard opening; no longer primary in host flow
- `views/QuestionModalView.js`
  - modal UI
- `views/LobbyView.js`
  - game list, rename, create, delete
- `views/LoginView.js`
  - sign-in screen

### Persistence / Backend

- `games` table
  - board JSON in `data`
- `game_players` table
  - player name, points, controller binding
- `game_runtime` table
  - press-enabled flag and winner player id
- `profiles` table
  - user profile cache
- Supabase storage bucket `media`
  - board media and audio files

## Game / App Flow

### Host Flow

1. `bootstrap.js` checks session and either renders login or lobby.
2. Lobby loads games from Supabase and groups them by creator profile.
3. Opening a game creates:
   - `GameRepository`
   - `GameService`
   - `MediaService`
   - `RoundNavigationService`
   - `ModalService`
   - `AppController`
4. `GameService.initialize()` loads board JSON plus players through `getGame()`.
5. `AppController` renders `AppView`.
6. `AppView` shows:
   - header
   - game grid
   - embedded footer leaderboard
7. Clicking a cell opens the question modal through `ModalService`.
8. Opening a question:
   - stores active cell
   - marks unanswered cells as answered immediately
   - resets press runtime
   - subscribes to `game_runtime`
9. Player presses are claimed through `claim_game_press(...)`.
10. Host clicks:
   - `Correct` -> adds cell value to winner score
   - `Not Correct` -> subtracts cell value and reopens press race

### Player Flow

1. Player opens `player.html?gameId=...`.
2. Controller id is read or created in `localStorage`.
3. App loads current player by `controller_id`.
4. If no player exists, join form is shown.
5. Joining calls RPC `claim_game_player(...)`.
6. Controller screen then allows:
   - rename via RPC `rename_game_player(...)`
   - manual score delta buttons via RPC `adjust_game_player_score(...)`
   - press race participation via RPC `claim_game_press(...)`
   - leave game via RPC `leave_game_player(...)`
7. Controller also uses realtime plus polling fallback.

### Standalone Leaderboard Flow

1. `leaderboard.html?gameId=...` loads `src/leaderboard.js`.
2. It fetches players, renders `LeaderboardGridView`, subscribes to `game_players`, and also polls every 1.5s.
3. It still supports:
   - QR drawer for joining from phone
   - delete player action

## State Management Reality

### Canonical State Stores

- Board content truth: `games.data`
- Player/score truth: `game_players`
- Press race truth: `game_runtime`
- Host local UI truth: `GameService.uiState` and some view-local state
- Player local controller identity truth: `localStorage`

### Important Reality Checks

- `GameModel.players` exists, but it is not the long-term source of truth.
  - `getGame()` hydrates players into the model.
  - `saveGame()` explicitly strips players back out of `games.data`.
  - `AppView` now separately subscribes to `game_players` for footer leaderboard updates.
- Board updates are optimistic in `GameService`.
- Player updates are mostly direct RPC calls in `player.js`.
- Press runtime is handled separately from board state and separately from players.
- Modal correctness flow does not go through `GameService`; it calls player score API directly.

### Realtime Reality

- `gameApi.subscribeToGame()` listens to both `games` and `game_players`.
- `AppView` also independently uses `subscribeToPlayers()`.
- `player.js` uses `subscribeToPlayers()` and `subscribeToGameRuntime()` and also polls every second.
- `ModalService` uses `subscribeToGameRuntime()` and also polls every 800ms while open.
- The app currently relies on overlapping subscriptions and fallback timers rather than a single coherent event model.

### Local Storage Reality

- `lastGameId` and `lastGameName` in `bootstrap.js`
- `activeRoundId` in `GameService`
- `quiz-game:player-controller:<gameId>` for player/controller binding
- `quiz-game:ui-language` in `i18n.js`
- `quiz-game:leaderboard-footer:<gameId>` in `AppView`

## Code Smells and Structural Problems

### 1. API split is complete, but ownership is still shallow

The old `src/api/gameApi.js` monolith was split into focused modules:

- `lobbyApi.js`
- `boardApi.js`
- `playersApi.js`
- `runtimeApi.js`
- `gameApi.shared.js`

This removes the single-file bottleneck, but the split is still mostly mechanical. Shared helpers and service boundaries still need further cleanup.

### 2. Realtime and polling are duplicated across surfaces

The codebase uses overlapping subscription strategies:

- host view
- standalone leaderboard
- player controller
- modal runtime handling

This makes correctness harder to reason about and increases redundant network work.

### 3. State ownership is fragmented

Player state is represented in several places:

- `game_players` table
- `GameModel.players`
- `leaderboardPlayers` in `AppView`
- `player` object in `player.js`

Board state and player state are partially stitched together rather than cleanly separated.

### 4. View modules perform their own data fetching

`AppView` now fetches and subscribes to players directly. `leaderboard.js` also fetches and subscribes directly. This works, but it weakens the service/controller boundary and makes view reuse more fragile.

### 5. Legacy leaderboard drawer still exists

`LeaderboardDrawerView` and its CSS remain in the repo, but the host flow has shifted toward embedded footer leaderboard. The old drawer is now partial legacy code, not fully removed and not fully primary.

### 6. `GameService` does not own remote game subscriptions

`GameService` exposes `subscribeToRemoteGameChanges()`, but host flow currently depends more on local state emission and direct view subscriptions than on a single synchronized service-driven remote model.

### 7. Some contracts are stale or only partially enforced

- `game.contract.js` is documentation-style validation, not central runtime enforcement.
- It still describes `filename` as filename-only, while storage paths are now namespaced by `gameId/filename`.

### 8. Page language and metadata are inconsistent

- `index.html` was recently normalized to English.
- `leaderboard.html` and `player.html` still declare `lang="uk"`.
- UI strings are multilingual, but document-level metadata is inconsistent.

### 9. UI rendering is DOM-first and imperative

That is not inherently wrong, but it raises the cost of:

- cross-view state synchronization
- repeated rerender safety
- cleanup correctness
- large UX changes

### 10. Test coverage is narrow

Current tests cover:

- admin access helper
- leaderboard sort
- modal service scoring calls
- question modal view

Missing coverage includes:

- host board render/update cycle
- realtime subscription behavior
- player controller flow
- leaderboard/footer collapse behavior
- Supabase integration contracts

## TODO For Agent

Ordered refactor and improvement steps. Do not treat all items as immediate.

1. Decide one owner for live player state on the host side.
   - either service-level ownership
   - or explicit dedicated players controller/store
2. Unify realtime and polling strategy for players and runtime.
   - keep fallbacks
   - remove duplicate subscriptions where they are redundant
3. Clarify lifecycle of embedded footer leaderboard versus standalone leaderboard page.
   - keep shared renderer
   - remove dead trigger paths
4. Add targeted tests for:
   - `AppView` footer leaderboard behavior
   - player controller score sync
   - press race flow
   - modal correct/incorrect score application
5. Move document metadata and page-level language handling to a consistent approach across all HTML entry points.
6. Revisit `GameModel.players`.
   - either formalize it as read-only snapshot data
   - or remove it from the model layer to reduce confusion
7. Audit view modules for direct data fetching and decide which fetches belong in controller/service instead.
8. Retire or formally re-home `LeaderboardDrawerView` if it is no longer part of the primary host UX.
9. Add a small architecture test checklist to the repo so future UI changes do not regress multiplayer flow.

## Improvement Proposals

### 1. Introduce a dedicated host-side players store

- Problem description:
  Host player state is currently split across `GameModel.players`, `AppView` local state, and direct player subscriptions in views.
- Why it matters:
  This makes leaderboard correctness harder to reason about and encourages more view-level data fetching over time.
- Suggested solution:
  Add a small `PlayersStore` or `PlayersService` that owns:
  - initial fetch
  - realtime subscription
  - fallback refresh policy
  - current players snapshot for the host surface
  Then inject that into `AppController`/`AppView` instead of fetching in the view.
- Expected impact:
  Cleaner ownership, easier testing, fewer duplicate subscriptions, simpler future leaderboard work.
- Estimated complexity:
  Medium

### 2. Introduce a dedicated runtime/press store

- Problem description:
  Press runtime logic is duplicated across `ModalService`, `player.js`, and raw API helpers, with each surface deciding its own polling and subscription behavior.
- Why it matters:
  Press-race correctness is gameplay-critical. Duplication increases the risk of race-condition fixes landing in one surface but not the others.
- Suggested solution:
  Create a small `RuntimeStore` or `PressRuntimeService` that standardizes:
  - current runtime snapshot
  - realtime subscription
  - optional polling fallback
  - reset/open/claim operations
- Expected impact:
  Better consistency between host and player controller behavior; easier reasoning about winner state.
- Estimated complexity:
  Medium

### 3. Move view-level data fetching back into controller/service boundaries

- Problem description:
  `AppView` and `leaderboard.js` fetch and subscribe to data directly.
- Why it matters:
  It weakens architecture boundaries and makes rendering code responsible for transport concerns.
- Suggested solution:
  Keep views render-only wherever practical. Let controllers/services pass snapshots and callbacks into views.
- Expected impact:
  Better separation of concerns, simpler tests, lower accidental coupling.
- Estimated complexity:
  Medium

### 4. Standardize on one realtime strategy with one fallback policy per domain

- Problem description:
  Players and runtime both use overlapping realtime subscriptions and polling loops in multiple places.
- Why it matters:
  This increases redundant work, complicates cleanup, and makes performance tuning harder.
- Suggested solution:
  Define one canonical strategy per domain:
  - board: realtime only unless proven unreliable
  - players: realtime + one controlled fallback refresh
  - runtime: realtime + one controlled fallback refresh
  Put the fallback interval and enablement policy in one place.
- Expected impact:
  Lower network churn, clearer behavior, fewer latent memory-leak risks.
- Estimated complexity:
  Medium

### 5. Replace repeated full board fetches for granular board updates

- Problem description:
  `updateCell`, `updateTopic`, audio mutations, and resets repeatedly call `getGame()` and then rewrite board JSON.
- Why it matters:
  Full-document roundtrips increase latency and create more opportunities for overwrite conflicts.
- Suggested solution:
  Introduce a more explicit board patch pipeline:
  - either JSON path patch RPCs in Supabase
  - or a versioned save strategy with conflict detection
  If that is too large right now, at least centralize fetch-modify-save logic in one helper.
- Expected impact:
  Better write discipline, easier conflict handling, less duplication.
- Estimated complexity:
  High

### 6. Formalize `GameModel.players` as snapshot-only or remove it

- Problem description:
  `GameModel.players` exists, but canonical player truth lives in `game_players`, and `saveGame()` strips players from stored board JSON.
- Why it matters:
  This creates conceptual confusion and invites stale reads.
- Suggested solution:
  Pick one:
  - keep `GameModel.players` and document it as a transient snapshot only
  - or remove it from the model and keep players completely separate from board model state
- Expected impact:
  Simpler mental model, less accidental cross-domain leakage.
- Estimated complexity:
  Low to Medium

### 7. Remove or isolate legacy leaderboard drawer code

- Problem description:
  `LeaderboardDrawerView` and its CSS still exist, but the host now uses embedded footer leaderboard as the primary experience.
- Why it matters:
  Partial legacy code adds maintenance cost and makes future UI work less clear.
- Suggested solution:
  Either:
  - fully retire the drawer after confirming no active usage
  - or move it into an explicit `legacy` or `secondary` path with clear ownership notes
- Expected impact:
  Less UI ambiguity and less dead-weight CSS/view code.
- Estimated complexity:
  Low

### 8. Add a minimal render-layer abstraction for repeated DOM patterns

- Problem description:
  The codebase is intentionally imperative, but repeated DOM creation patterns exist across views and page entrypoints.
- Why it matters:
  Repeated direct DOM assembly raises maintenance cost and makes small UI changes verbose.
- Suggested solution:
  Add a tiny internal helper layer only where it reduces repetition:
  - element factory helpers
  - small view composition helpers
  Avoid a full framework migration.
- Expected impact:
  Cleaner view code without changing the architectural style of the app.
- Estimated complexity:
  Medium

### 9. Tighten cleanup discipline around subscriptions and timers

- Problem description:
  Multiple views and services create timers and subscriptions, with cleanup spread across custom disposer patterns and ad hoc teardown.
- Why it matters:
  This is a common source of stale callbacks, duplicate updates, and subtle bugs in realtime apps.
- Suggested solution:
  Standardize a cleanup checklist:
  - timer creation and cleanup paired in the same module
  - subscription creation and cleanup paired in the same module
  - one `destroy()` path per long-lived unit
  Consider adding tiny helper wrappers for interval/subscription ownership.
- Expected impact:
  Lower bug risk and easier future refactors.
- Estimated complexity:
  Low to Medium

### 10. Expand tests around multiplayer state transitions

- Problem description:
  Tests are currently narrow and do not cover host/player synchronization or leaderboard update behavior.
- Why it matters:
  The highest-risk code paths are multiplayer and realtime-related, which currently have the least protection.
- Suggested solution:
  Add focused tests for:
  - `AppView` footer leaderboard updates and collapse state
  - player controller score synchronization
  - runtime winner transitions
  - cleanup behavior for subscriptions/timers
- Expected impact:
  Safer iteration speed and easier refactoring of realtime code.
- Estimated complexity:
  Medium

### 11. Normalize document metadata and language bootstrapping across entry pages

- Problem description:
  `index.html`, `leaderboard.html`, and `player.html` do not share a consistent document-language and metadata strategy.
- Why it matters:
  This creates small but recurring UX and maintenance inconsistencies.
- Suggested solution:
  Standardize:
  - `lang`
  - title strategy
  - description/meta policy
  - language initialization rules
  across all entry HTML files.
- Expected impact:
  Cleaner product presentation and less confusion about language defaults.
- Estimated complexity:
  Low

### 12. Reduce duplicated score formatting and UI helpers

- Problem description:
  Score formatting and some view-helper behavior are repeated in multiple files.
- Why it matters:
  Small duplications become drift points during UI polish.
- Suggested solution:
  Move repeated UI-formatting helpers such as score formatting into shared utilities where appropriate.
- Expected impact:
  Less drift and easier visual consistency updates.
- Estimated complexity:
  Low

### 13. Consider a tiny state library only if store count continues to grow

- Problem description:
  The app is still manageable with plain JS, but store-like concerns are emerging for board, players, runtime, and UI preferences.
- Why it matters:
  If more shared state domains appear, custom ad hoc coordination may become harder than using a tiny helper.
- Suggested solution:
  Do not add a library now by default. Re-evaluate only if the planned `PlayersStore` and `RuntimeStore` work reveals repeated boilerplate.
  If needed, consider a very small store library such as `nanostores`.
- Expected impact:
  Potential simplification of subscriptions and state propagation if the app grows further.
- Estimated complexity:
  Low now, Medium if adopted later

## Decisions Log

### 2026-03-31

- Root folder was renamed from `project` to `Quiz-Game`.
- `index.html` metadata was normalized to English.

### 2026-03-31

- Host modal score updates were switched away from direct table update flow to a new RPC path:
  - JS uses `adjust_game_player_score_by_id`
  - SQL function added in `supabase/game_players.sql`
- This was done to align host score updates with Supabase permission-safe server-side score mutation.

### 2026-04-01

- Host leaderboard UX was changed from header-triggered drawer behavior to an embedded footer leaderboard in `AppView`.
- Standalone `leaderboard.html` remains in the repo and still functions as a separate surface.
- `LeaderboardDrawerView` was not deleted; it is now legacy/secondary code until a later cleanup decision.

### 2026-04-01

- The first TODO item was executed: `src/api/gameApi.js` was split into focused modules:
  - `src/api/gameApi.shared.js`
  - `src/api/lobbyApi.js`
  - `src/api/boardApi.js`
  - `src/api/playersApi.js`
  - `src/api/runtimeApi.js`
- `src/api/gameApi.js` now remains as a compatibility barrel so existing imports continue to work.

### 2026-04-01

- `PROJECT_STATE.md` is established as the repository source of truth for future agent work.
- `AGENT_RULES.md` is established as the operating ruleset for future code changes.
