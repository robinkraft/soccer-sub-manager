# Live game in Supabase — design (prepared, not yet wired in)

Status: **wired in. Any signed-in coach can drive (Robin's call,
Nov 2026 — no Take over, no view-only between coaches); anyone with
a viewer code can watch live and see history without signing in.**
`app.js` shows an entry screen first when Supabase is configured:
join a shared view with a viewer code (no account, view-only) or
sign in as a coach. After sign-in it loads the roster from
`team_roster`, creates the `live_games` row on Start game, syncs it
debounced on driver actions, and subscribes via Realtime. Any coach
who joins a live game by its game code drives it immediately — same
person on two devices is just two sessions of the same coach.
Remote updates apply immediately with a small floating "Updated"
note, never a banner or reload tap. RLS is authenticated-only on
every table; anonymous viewing goes through the SECURITY DEFINER
function `viewer_access(code)` only (see the security note).
History design is in `docs/backend-history-design.md`; all tables
are in `supabase/schema.sql` (and `team_roster` alone in
`supabase/add-team-roster.sql` for existing projects); the viewer
access pieces alone are in `supabase/add-viewer-access.sql` for
existing projects. The source was pushed to the (still private)
GitHub repo, but an earlier commit there still contains the real
player names in Git history — the repo must be recreated clean from
the scrubbed files before it goes public for GitHub Pages.

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
  shown as plain text on the driver's live screen. The other coach
  types it into **Join a live game** on setup and drives immediately
  — there is no Take over. This is the sharing key for coaches;
  there is no link. It is NOT the viewer code: anonymous watching
  uses a separate code from `viewer_codes`, checked server-side by
  `viewer_access()` (see the security note).
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

The clock is an anchor, not a ticking value — and the anchor is the
stretch start, never re-based on sync (Nov 2026: re-basing it at sync
time was the bug that froze the clock when the driver's tab was
backgrounded, because the banked value came from the throttled local
tick):

- `state.clock = { elapsed_seconds_at_anchor, anchor_started_at, running }`
  — `elapsed_seconds_at_anchor` is the banked base, `anchor_started_at`
  is the wall-clock ms the current running stretch began.
- While running: displayed elapsed = base + (now − anchor start).
  While paused: displayed elapsed = base.
- Pause banks the elapsed and the open stints, clears the anchor;
  resume sets a fresh anchor at now; +2:00 adds 120s to the base;
  halftime snap re-bases the running stretch to the half boundary.
- Writes happen on actions (Apply, score, pause, queue change), debounced
  ~1–2s, never once a second. A reader needs no write at all to show
  the true clock — it derives it from the anchor.
- The 1-second timer is display-only: it re-derives the clock and the
  live minute displays from the anchor/stints. It never increments a
  counter. A backgrounded tab re-derives on `visibilitychange`/`focus`
  and catches up the instant it returns.

## Player minutes (stints, same wall-clock design)

Per-player minutes had the same tick problem (players at 0m while the
clock read 04:39), so they are derived the same way:

- `state.stints` — one entry per roster index: `{start, pos}` while the
  player is on the field and the clock is running, `null` otherwise.
  Displayed minutes = banked `minutesSec`/`gkSec`/`posSec` + (now − start).
- Stints are banked and closed at every transition (pause, halftime,
  end, sub applied, swap, a player leaving the field, Edit lineup) and
  re-opened on resume, kickoff, second half, and after any lineup
  change. The goalie-time split and the per-position breakdown come
  from the same stints, so they stay correct too.
- Rows written by older builds have no `stints`: a reader falls back
  to the banked totals and, if the clock is running, opens a stint at
  join time so minutes accrue instead of sitting at 0. No new columns
  were needed — stints live inside the `state` jsonb, so there is no
  migration file for this change.

## Reloading a game link (no setup flash)

Reloading `?view=CODE&game=XXXX` (or `?game=XXXX`) never renders the
setup screen: while the route resolves the page shows a neutral
"Loading game…" screen — no roster selector, no Join card, no buttons
— then renders the game directly. A genuinely missing/ended game shows
the plain in-app message, never setup. A plain URL still opens setup.

## Parent read-only view (Game / History)

An anonymous viewer opening a shared link gets a read-only game view,
never the coach screen: score + clock only (no score buttons, no
pause, no Apply, no Halftime/End game), the field and bench as plain
read-only rows, and a Game / History switch at the top. History shows
the same games-first history + season totals as the viewer home,
read-only, no CSV downloads. Switching tabs is a render only — the
live state is never re-fetched or reset, and the viewer poll keeps the
game live underneath. The viewer home has the same switch (Game shows
the live-games list). Coaches keep the Actions / Minutes / Team tabs.

## Player chips: one component everywhere

A player chip looks the same whether it is on the setup field, the
live field, or the bench — the only differences are context (setup
spots show just the position label when empty; live chips show
minutes) and background (white chip on the green field vs dark card
on navy):

- 48px field chip / 46px bench button, fixed heights, never shifting.
- The name is the only in-flow content and is vertically (and
  horizontally) centred in every state.
- Minutes and the queued pairing live in one absolutely-positioned
  strip at the bottom, same format everywhere: "0m" clean,
  "0m → Name" queued (the arrow names the counterpart player).
- A queued player uses the same pale-yellow highlight on field and
  bench, with the same brown pill badge on the top edge: "↓ POS"
  for the player going off the field, "↑ POS" for the one coming on.

## Realtime flow

1. Start game → insert one `live_games` row with the game code.
2. Both phones subscribe (Supabase Realtime, `postgres_changes` on
   `live_games`) filtered to that code — UPDATE for live changes,
   DELETE so a shut-down game disappears live on every phone.
3. An action on phone A writes version N+1; phone B receives it and
   re-renders field, bench, queue, score, and clock from the snapshot.
4. End game → insert one `game_history` row, mark the live row `finished`.
5. Shut down game (coach-only) → delete the `live_games` row; nothing
   is saved to history. Other coaches' screens go back to setup with
   the small "Updated" note; viewers see the game disappear on the
   next poll.

## Deep links

- Every live game has its own URL: `?view=CODE&game=GAMECODE`.
  The coach's address bar always carries the view code, so copying
  it shares a link that works for anyone — signed-in coaches get
  edit rights, everyone else watches view-only. Edit rights come
  from sign-in only, never from the URL. If no view code exists when
  a coach opens a game, one is generated on the spot.
- Opening a game pushes its URL; reloading it re-opens the same
  game; going back to setup clears it. A URL naming a game that is
  gone shows a plain not-found message with the way back.

## Starting: no empty spots

- A game never starts with an empty required spot. Kickoff review
  disables Start game and names the empty positions (e.g. "Fill CM
  and RB to start"). Short mode (6v7) needs its 6 remaining spots,
  not 7. The coach fills the spots; the app never auto-fills.

## Conflicts (two writers)

- Last-write-wins per action, guarded by `version`: a writer that last
  saw version N writes N+1. If the row is already past N+1 when it
  writes, the write retries once against the fresh version; if that
  races too, the latest state applies live. Nothing is shown and
  nothing is asked of the coach — remote changes just appear with
  the small floating "Updated" note.
- Queued subs and swaps are part of the same snapshot, so a sub queued
  on one phone and a swap on the other resolve in version order.
- Undo stays local to the tab that made the change (same as today).

## Offline (sideline signal)

- The app always works in-memory first. If Supabase is unreachable,
  actions still apply locally and the UI shows "Offline — changes
  will sync when signal returns".
- On reconnect, the tab re-fetches the live row: if the remote version
  is newer and the tab has unsynced local actions, it shows the same
  conflict choice as above instead of overwriting.

## Edit mode (Robin's choice: any coach can drive)

- **Any signed-in coach can drive** — implemented Nov 2026,
  replacing the old one-driver / other-view-only split (and the
  Take over flow, now removed). A coach who starts a game or joins
  one by its game code edits it immediately; the other coach's
  phone does the same. Concurrent edits resolve last-write-wins
  under the version check (a raced write retries once against the
  fresh version, then the latest state applies live). Remote
  changes appear immediately with the small floating "Updated"
  note; there is no conflict banner and nothing to tap.
- Anonymous code-joined watchers are strictly view-only (see above).
- Undo stays local to the tab that made the change (same as today).

## Security note — coaches sign in and all drive; watching goes through a checked code (Robin's choice, Nov 2026)

RLS is authenticated-only on every table (`live_games`,
`game_history`, `team_roster`, `viewer_codes`): the anon key alone
gets nothing — no select, insert, update, or delete. A coach must
sign in (Supabase Auth, email + password, account created by Robin
in Authentication → Users) before the app loads history, the
roster, or a live game. Anonymous viewing is NOT an open table
read: it goes through the SECURITY DEFINER function
`viewer_access(code)`, which runs as the table owner, checks the
code against `viewer_codes`, and returns the running live games (if
any) and the history ONLY on a match — otherwise `{"ok": false}`
and nothing else. Anon can only EXECUTE that function.

The coach generates the viewer code in the app (Settings → Share a
view link). One active code at a time: generating a new link
deactivates the old one first, so a shared link can be killed by
regenerating. The link is `?view=CODE` on the app's own URL, and
the plain code is shown alongside it for reading out loud. The link
works any time — with no live game running, the viewer still sees
the history.

Tradeoff, stated plainly: the code is the key, and a 4-letter code
is guessable — anyone who guesses the active code sees the live
game (including real player names) and the history until the coach
generates a new code. That is the remaining tradeoff, and it is
revocable by regeneration. The game code (for coaches joining by
code) is a different code from the viewer code.

The auth session is stored by the Supabase client in localStorage
by default and cleared on Sign out — that is what lets a coach stay
signed in across reloads. Game/history data is never stored in
browser storage. Do not put the `service_role` key in the app —
only the project URL and anon key.

## Anonymous viewing — what a watcher can and cannot do

Can (after entering a valid viewer code or opening a `?view=`
link, no account):
- See the live games in progress on the shared-view home screen —
  one card each ("There's a live game in progress", score and
  clock) with a Join button — and watch the one they join: field,
  bench, queue, score, clock, minutes, goals — polled from
  `viewer_access` every few seconds (anon has no Realtime on
  `live_games`). A game that starts after they joined appears in
  the list on the next poll; they tap Join, it never auto-jumps.
- See History: past games, season totals, per-player minutes — on
  the live screen's History tab while a game runs, and on the
  shared-view home screen when none is running.
- Share the view onward: the "Share this view" button (on the home
  screen and on the live screen's view-only banner) copies the same
  viewer link they arrived on — same code, no new code generated.
  Anyone opening that link joins as a viewer too, no sign-in.
- Leave the shared view (back to the entry screen) and sign in as
  a coach mid-game, keeping the live game on screen — signing in
  promotes them to a coach who can drive.

Cannot:
- See the roster tab, settings, or the setup screen at all.
- Download any CSV (season, all-history, per-game, roster).
- Change anything: no Apply, no score buttons, no subs, no swaps,
  no goal edits. Every write is blocked by RLS for anon anyway,
  and the app's edit gate blocks the controls first.
- Generate a new viewer code or revoke the current one: only a
  signed-in coach can do that (Settings → Share a view link).
  Sharing onward only copies the existing link.
- See anything before entering a valid code: the entry screen is
  all there is until then. A wrong code returns nothing; a
  deactivated code (after regeneration) stops working even
  mid-watch — the viewer is sent back to the entry screen.

## Coaches — anyone signed in can drive

There is no driver / view-only split between coaches and no Take
over (removed Nov 2026, Robin: "Coaches should be able to change
stuff"). Any signed-in coach who starts a game or joins one by its
game code drives it immediately; Robin on two devices is just two
sessions of the same coach. Concurrent edits resolve last-write-
wins under the optimistic-concurrency version check: a write that
races a newer version retries once against the fresh version, and
if that races too the latest state applies live. No banner, no
reload tap, nothing for the coach to do — remote changes just
appear, with the small floating "Updated" note (see below).

## Live updates — apply immediately, small floating note

When a new `live_games` version arrives (Realtime for coaches, the
3-second poll for anonymous watchers), it applies to the screen
immediately — no reload button, no tap required. A small pill
saying "Updated" floats near the top of the screen and fades away
on its own after a few seconds. It is `position:fixed`, outside
the page flow, so it never pushes the field, bench, or Apply
button down. It appears on remote updates only, never on the
driver's own actions, and it is worded neutrally — Robin on two
devices is the same person, not "the other coach". A version that
races a local write retries once (see above) instead of ever
showing a conflict banner: there is no "updated by the other
coach" notice anywhere in the app anymore.
