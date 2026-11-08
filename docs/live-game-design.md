# Live game in Supabase — design (prepared, not yet wired in)

Status: **wired in — one driver, other view-only (Robin's choice),
login-required.** `app.js` shows a login screen first when Supabase
is configured; after sign-in it loads the roster from `team_roster`,
creates the `live_games` row on Start game, syncs it debounced on
driver actions, subscribes via Realtime, blocks edits on the
view-only phone, and offers Take over with confirmation. RLS is
authenticated-only. History design is in
`docs/backend-history-design.md`; all three tables are in
`supabase/schema.sql` (and `team_roster` alone in
`supabase/add-team-roster.sql` for existing projects). The source was
pushed to the (still private) GitHub repo, but an earlier commit
there still contains the real player names in Git history — the repo
must be recreated clean from the scrubbed files before it goes
public for GitHub Pages.

## Why this is now possible

The current private Muse app preserves state nicely because it is a
fullstack app: TypeScript + a tiny server, SQLite `app.db` via Drizzle,
one table, one row, whole state as a single saved snapshot. The shared
Muse app is a static page with no server, so it is in-memory only.

The portable app is also static, but it is not stuck in Muse — it can
talk to Supabase directly from the browser. So the live game can use
the same one-snapshot idea as the private app, with Supabase as the
server instead of Muse's SQLite file.

## Table: `live_games`

One row per active game. Schema in `supabase/schema.sql`.

- `game_code` — short code (e.g. `K7Q2`), generated at Start game,
  shared via the game link (`?game=K7Q2`). This is the sharing key.
- `phase` — `setup` | `live` | `halftime` | `finished`
- `version` — optimistic concurrency counter, +1 per write
- `last_writer_id` / `last_writer_label` — random per-tab id generated
  in memory on page load (never stored in the browser), so a tab can
  ignore its own realtime echo and the UI can say who changed it last
- `state` (jsonb) — the whole live snapshot: team, settings, roster,
  lineup, bench, queue, swap staging, score, goals, tired/present,
  minutes and stints, halftime plan, notes
- `updated_at` — last write time

## Clock (no per-second writes)

The clock is an anchor, not a ticking value:

- `state.clock = { elapsed_seconds_at_anchor, anchor_started_at, running }`
- While running: displayed elapsed = anchor elapsed + (now − anchor time)
- Pause / +2:00 / halftime snap / resume all just move the anchor
- Writes happen on actions (Apply, score, pause, queue change), debounced
  ~1–2s, never once a second

## Realtime flow

1. Start game → insert one `live_games` row with the game code.
2. Both phones subscribe (Supabase Realtime, `postgres_changes` on
   `live_games`) filtered to that code.
3. An action on phone A writes version N+1; phone B receives it and
   re-renders field, bench, queue, score, and clock from the snapshot.
4. End game → insert one `game_history` row, mark the live row
   `finished`. The texted `#g=` snapshot links keep working as a
   frozen fallback — they are not removed.

## Conflicts (two writers)

- Last-write-wins per action, guarded by `version`: a writer that last
  saw version N writes N+1. If the row is already past N+1 when it
  writes, the app shows "Updated by the other coach" and offers
  Reload (take theirs) or Keep mine (re-apply my change on top).
- Queued subs and swaps are part of the same snapshot, so a sub queued
  on one phone cannot be silently overwritten by a swap on the other
  without the version check firing.
- Undo stays local to the tab that made the change (same as today).

## Offline (sideline signal)

- The app always works in-memory first. If Supabase is unreachable,
  actions still apply locally and the UI shows "Offline — changes
  will sync when signal returns".
- On reconnect, the tab re-fetches the live row: if the remote version
  is newer and the tab has unsynced local actions, it shows the same
  conflict choice as above instead of overwriting.

## Edit mode (Robin's choice: one driver, other view-only)

- **One driver, other view-only** — implemented: the second phone
  subscribes read-only, sees everything live, and uses Take over to
  become the driver (with confirmation, as today's `#g=` takeover does).
  The driver writes with optimistic versioning; the conflict banner
  (Reload / Keep mine) still applies if the row moved under the driver.
- Both coaches editing was considered and not chosen; history-only was
  the earlier scope and is superseded by this live mode.

## Security note — login-required (Robin's choice, 2026-11-07)

RLS on `live_games` (and `game_history`) is authenticated-only: the
anon key alone gets nothing — no select, insert, update, or delete.
A coach must sign in (Supabase Auth, email + password, account
created by Robin in Authentication → Users) before the app loads
history or joins a live game. The game code is a sharing key, not
the access control: the code alone gets nothing.

The auth session is stored by the Supabase client in localStorage
by default and cleared on Sign out — that is what lets a coach stay
signed in across reloads. Game/history data is never stored in
browser storage. The driver / view-only split is enforced in the app
(the view-only phone never issues writes; Take over makes it the
driver); RLS is the gate that keeps anyone without a coach login out
entirely. Do not put the `service_role` key in the app — only the
project URL and anon key.
