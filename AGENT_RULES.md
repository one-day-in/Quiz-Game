# AGENT_RULES

These rules are the operating baseline for future agent work in this repository.

## Product Context

- This is a realtime browser-based quiz game with three surfaces:
  - host board at `index.html`
  - standalone leaderboard at `leaderboard.html`
  - player controller at `player.html`
- Backend is Supabase:
  - `games` stores board JSON
  - `game_players` stores players and scores
  - `game_runtime` stores press race state
  - storage bucket `media` stores uploaded assets

## Core Engineering Rules

- Prefer small, local changes over broad rewrites.
- Keep behavior stable unless the user explicitly requests a product change.
- Do not silently remove fallback paths. This app relies on both realtime and polling in some places.
- Preserve standalone page support for `leaderboard.html` and `player.html` unless explicitly asked to remove them.
- Never assume the in-memory `model.players` is canonical. Player truth lives in `game_players`.
- Never assume direct table writes are safe. Prefer existing `security definer` RPCs when player/controller ownership is involved.

## Rendering Discipline

- Avoid full app rerenders when a targeted patch already exists.
- `AppController` intentionally skips heavy grid rerenders while the modal is open. Preserve that unless replacing it with a better measured approach.
- Keep grid rendering and leaderboard rendering decoupled. Grid changes should not require rebuilding the leaderboard, and player list changes should not require rebuilding the grid.
- Reuse existing DOM nodes when practical. Do not introduce render churn for frequent realtime updates.
- For footer leaderboard work, keep collapsed and expanded states explicit and persistent.

## State Management Rules

- Distinguish these state domains:
  - board state in `games.data`
  - player/score state in `game_players`
  - press race state in `game_runtime`
  - local UI state in `GameService.uiState` and `localStorage`
- Do not merge these domains casually.
- If a feature touches player scores, verify both host flow and player controller flow.
- If a feature touches press handling, verify both realtime subscription and polling fallback behavior.
- Any new persistent UI state must use a namespaced `localStorage` key.

## Realtime Rules

- Realtime handlers should be idempotent and safe to call repeatedly.
- When adding subscriptions, always define cleanup at the same time.
- When realtime is incomplete, prefer an explicit fallback timer over silent failure.
- Avoid duplicate subscriptions to the same data source in the same view unless there is a clear reason.

## Refactoring Control

- Before changing architecture, document the real current flow in `PROJECT_STATE.md`.
- Do not delete legacy components only because they are no longer primary. First confirm they are unused.
- When replacing an older interaction model, prefer disabling call sites before deleting shared code.
- Keep write scopes narrow. Do not mix UI redesign, backend contract changes, and unrelated cleanup in one change unless the task requires it.

## Code Quality Expectations

- Use existing naming patterns and file structure unless there is strong evidence they are the problem.
- Add comments only where behavior is surprising or non-obvious.
- Prefer explicit data flow over hidden side effects.
- Preserve optimistic UI only when rollback behavior exists or failure is acceptable.
- For Supabase schema changes, update both JS call sites and SQL migration files together.

## Verification Expectations

- For UI changes, run at least `npm test` and `npm run build` when feasible.
- For score/leaderboard changes, verify:
  - host correct/incorrect flow
  - player controller score updates
  - leaderboard refresh behavior
- For Supabase-related changes, note if SQL still needs to be applied remotely.

## Documentation Maintenance

- Keep `PROJECT_STATE.md` updated when architecture or data flow materially changes.
- Add decisions to the decisions log with absolute dates.
- If a previous assumption in `PROJECT_STATE.md` becomes false, replace it rather than layering conflicting notes on top.

## Response Format

- Do the work first.
- Be concise.
- Reply in Ukrainian.
- Default final replies to only:
  - changed files
  - commands run
  - blockers
  - next step
- Do not explain code unless explicitly asked.
- Keep final replies under 8 lines.
