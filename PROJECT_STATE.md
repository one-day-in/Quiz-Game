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
  - binds `PlayersService` state to `AppView`
  - routes cell clicks into `ModalService`
  - avoids full grid rerender while modal is open
- `views/AppView.js`
  - renders header, game grid, and the host leaderboard panel
  - keeps leaderboard anchored to the footer slot while allowing it to expand upward as an overlay
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
- `services/PlayersService.js`
  - owns host-side live player state
  - performs initial fetch, realtime subscription, and fallback refresh
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
  - wraps the board in a centered inner container with a `1600px` max width
- `views/HeaderView.js`
  - host header with lobby/back and round switcher
- `views/LeaderboardGridView.js`
  - shared leaderboard renderer for page, compact preview, and full editable list
  - footer preview now renders compact one-line player cards
- `views/LeaderboardPanelView.js`
  - single host leaderboard surface anchored to the footer slot
  - owns collapsed and expanded host states with one shared toggle button
  - renders QR and edit controls only in expanded mode
- `views/QuestionModalView.js`
  - modal UI
- `utils/overlayDismiss.js`
  - shared close-on-overlay and close-on-Escape wiring for dismissable layers
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
   - `PlayersService`
   - `MediaService`
   - `RoundNavigationService`
   - `ModalService`
   - `AppController`
4. `GameService.initialize()` loads board JSON.
5. `PlayersService.initialize()` hydrates live host-side player state from `game_players`.
5. `AppController` renders `AppView`.
6. `AppView` shows:
   - header
   - game grid
   - one footer-anchored leaderboard panel
   - the same panel stays compact by default and expands upward as an overlay from the footer slot
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
- Host leaderboard state is now owned by `PlayersService`, not by `AppView`.
- Host leaderboard UI is now one footer-anchored panel, not separate footer-preview and host-drawer surfaces.
- The compact state is read-only.
- The expanded state is the editing surface for score changes, player deletion, and QR-based joins.
- Dismissable overlays now follow one shared rule:
  - click on the backdrop closes
  - `Escape` closes
  - exceptions stay explicit at the call site, such as fullscreen media in the question modal
- Expanded host leaderboard delete action is intentionally hidden until swipe reveal.
- Swipe gestures in the expanded host leaderboard must not start from inline score-control buttons.
- Host board width is capped by a centered `game-grid__inner` container instead of letting the raw grid stretch to the full viewport width.
- Board updates are optimistic in `GameService`.
- Player updates are mostly direct RPC calls in `player.js`.
- Press runtime is handled separately from board state and separately from players.
- Modal correctness flow does not go through `GameService`; it calls player score API directly.
- Host score mutations by `playerId` depend on remote Supabase function `adjust_game_player_score_by_id(...)`.

### Realtime Reality

- `gameApi.subscribeToGame()` listens to both `games` and `game_players`.
- `PlayersService` uses `subscribeToPlayers()` plus a 1.5s fallback refresh loop for the host surface.
- `player.js` uses `subscribeToPlayers()` and `subscribeToGameRuntime()` and also polls every second.
- `ModalService` uses `subscribeToGameRuntime()` and also polls every 800ms while open.
- The app currently relies on overlapping subscriptions and fallback timers rather than a single coherent event model.
- Remote verification on April 1, 2026 showed that `adjust_game_player_score_by_id(...)` was still missing from the active Supabase schema cache, while `adjust_game_player_score(...)` existed.

### Local Storage Reality

- `lastGameId` and `lastGameName` in `bootstrap.js`
- `activeRoundId` in `GameService`
- `quiz-game:player-controller:<gameId>` for player/controller binding
- `quiz-game:ui-language` in `i18n.js`

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
- `PlayersService` host snapshot
- `player` object in `player.js`

Board state and player state are partially stitched together rather than cleanly separated.

### 4. Standalone leaderboard still performs its own data fetching

`leaderboard.js` still fetches and subscribes directly. Host flow is cleaner now because `AppView` no longer owns player transport concerns, but standalone leaderboard still does.

### 5. Host leaderboard still renders two internal list surfaces

Host UX now uses one panel shell, which is cleaner than the earlier `preview + drawer` split. However, the panel still mounts:

- a compact preview list
- a full editable list

inside the same feature. That is acceptable for now, but it means host leaderboard rendering still has two internal DOM surfaces to keep aligned.

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

### 11. Overlay dismissal rules were previously duplicated

- old host leaderboard close handling
- `QuestionModalView`
- `leaderboard.js` add-player drawer
- `utils/confirm.js`

Each of these had local `click` and `keydown` dismissal wiring. That made a simple UX rule easy to apply inconsistently.

## TODO For Agent

Ordered refactor and improvement steps. Do not treat all items as immediate.

1. Unify realtime and polling strategy for players and runtime.
   - keep fallbacks
   - remove duplicate subscriptions where they are redundant
2. Revisit standalone leaderboard page vs host leaderboard panel responsibilities.
   - keep the host panel as the primary host UX
   - avoid unnecessary divergence in QR and player-management affordances
3. Add targeted tests for:
   - `AppView` footer leaderboard behavior
   - player controller score sync
   - press race flow
   - modal correct/incorrect score application
4. Move document metadata and page-level language handling to a consistent approach across all HTML entry points.
5. Revisit `GameModel.players`.
   - either formalize it as read-only snapshot data
   - or remove it from the model layer to reduce confusion
6. Audit view modules for direct data fetching and decide which fetches belong in controller/service instead.
7. Add focused tests for the single host leaderboard panel.
   - compact state
   - expanded state
   - overlay close behavior
   - edit controls
8. Add a small architecture test checklist to the repo so future UI changes do not regress multiplayer flow.
9. Add targeted tests for shared overlay dismissal behavior.
   - Escape closes
   - backdrop click closes
   - fullscreen question modal remains exempt from Escape

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

### 7. Consolidate leaderboard presentation wiring

- Problem description:
  The app still has multiple leaderboard entry points:
  - host footer-anchored panel
  - standalone `leaderboard.html`
- Why it matters:
  Without explicit ownership, QR, sorting, and player-list layout can drift between these surfaces.
- Suggested solution:
  Keep `LeaderboardGridView` as the shared list/preview renderer and `LeaderboardPanelView` as the host-only shell. Reuse the same QR-generation helper if another leaderboard entry point needs controller QR later.
- Expected impact:
  Clearer UI ownership and less duplication when evolving leaderboard UX.
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
  - `AppView` footer leaderboard preview updates
  - host leaderboard panel compact/expanded behavior
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

- Host leaderboard UX was refined again after the accordion-style footer proved too awkward.
- The host surface now uses:
  - a stable footer preview with player cards and scores
  - a dedicated drawer for the full leaderboard
  - a controller QR inside that drawer for `player.html`
- This host-specific drawer-based step was later replaced on 2026-04-02 by a single footer-anchored panel.
- No leaderboard UI persistence key is currently used in `localStorage`.

### 2026-04-01

- The first host-side leaderboard TODO was executed.
- Live host player state now has a single owner: `PlayersService`.
- `AppView` no longer fetches or subscribes to `game_players` directly.
- `AppController` now binds board state and player state separately into the same host view.

### 2026-04-01

- Host drawer editing was restored:
  - inline `-100` / `+100` score controls
  - swipe-to-reveal delete action
  - QR-based player join affordance only
- Footer leaderboard preview stayed read-only and was reduced to compact one-line `name + score` rows.
- Remote Supabase verification confirmed:
  - `adjust_game_player_score(...)` exists
  - `adjust_game_player_score_by_id(...)` is still missing remotely and must be applied manually in Supabase SQL Editor for host-side score controls and modal adjudication to work in production.

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

### 2026-04-01

- Dismissable overlay behavior was standardized through `src/utils/overlayDismiss.js`.
- Host leaderboard interactions, question modal, standalone leaderboard add-player drawer, and custom confirm dialogs now share the same close-on-backdrop and close-on-`Escape` rule where applicable.
- The question modal keeps an explicit fullscreen exception so `Escape` does not close the modal while the browser is handling fullscreen media.

### 2026-04-01

- Host leaderboard drawer swipe-delete behavior was tightened:
  - the delete action stays visually hidden until the row is actually swiped open
  - swipe gestures no longer start from score-control buttons
- This prevents row jitter in the expanded leaderboard and removes the visible delete strip under closed rows.

### 2026-04-01

- Host board layout now uses a dedicated centered inner container inside `GameGridView`.
- The board/grid width is capped at `1600px` so very wide screens do not over-stretch the game field while the surrounding layout still fills the viewport.

### 2026-04-02

- Host leaderboard was refactored from `footer preview + separate drawer view` into one `LeaderboardPanelView` anchored to the footer slot.
- The same toggle button now controls compact and expanded states.
- Expanded mode grows upward as an overlay without resizing the grid or header areas.
- `LeaderboardDrawerView.js` was removed after the host surface stopped referencing it.
