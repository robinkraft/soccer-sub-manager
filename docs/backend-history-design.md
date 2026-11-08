# History backend — design (prepared, not yet wired in)

Status: **wired in — Supabase (Robin's choice; Firebase was the
alternative), login-required.** `app.js` shows a login screen first
when Supabase is configured; after sign-in it loads the roster from
`team_roster` (see README, "Roster"), history from `game_history`,
inserts on End game, and updates on Edit goals.
RLS is authenticated-only — the anon key alone gets nothing. Live
game is in `live_games` — see `docs/live-game-design.md`. The source
was pushed to the (still private) GitHub repo, but an earlier commit
there still contains the real player names in Git history — the repo
must be recreated clean from the scrubbed files before it goes
public for GitHub Pages (a scrub commit alone is not enough). No
browser storage (localStorage / sessionStorage / IndexedDB / cookies)
is used for history data; the only browser storage is the Supabase
Auth session token, stored by the client in localStorage by default
and cleared on Sign out.

## What history is

On confirmed End game, one finished-game record is saved:

- date, team name, match length, final score (us / them)
- per present player: total minutes, goalie minutes, goals,
  minutes by position (GK/RB/LB/RM/CM/LM/ST)
- goals in chronological order: player (or own goal, index -1),
  elapsed seconds or null when no time was recorded
- starting lineup at kickoff (roster indices, GK first)

The History tab shows expandable past games, season totals
(games, total / average minutes per player, per-position breakdown),
and season CSV export. Starting a new game preserves history.
Edit goals on a past game updates that game's record.

Totals follow the "Count goalie time toward total game time" setting
(default OFF): totals count only non-goalie minutes; goalie minutes
are still tracked and shown in the per-position breakdown.

## Recommended: Supabase

- One Postgres table: `public.game_history` — see `supabase/schema.sql`
  (run once in the Supabase SQL Editor).
- Client: the Supabase JS client loaded from the Supabase CDN, or plain
  `fetch` against the PostgREST endpoint — no server of ours needed.
- Config the app needs (public, safe to ship in the page — these are
  *not* secret keys): `SUPABASE_URL` and the anon (publishable) key.
  Never put the `service_role` key in the app.
- Flow: sign in → page load → `select * from game_history order by game_date desc`
  → render History tab. End game → `insert` one row. Edit goals →
  `update` that row's `goals` (and player goal counts). Before sign-in
  nothing is loaded and the match UI is not rendered.
- If Supabase is unreachable, History shows an error and the live game
  still works; the finished game is kept in-memory for that session and
  the app offers a CSV download as a fallback.
- Free tier is plenty for a season of games. Data is plain SQL — easy
  to inspect, export, and dump.

Setup steps for Robin (about 5 minutes, in his Supabase account):
1. Create a new project at supabase.com.
2. SQL Editor → paste and run `supabase/schema.sql`. If the old anon
   policies were already run in this project, the same file removes
   them (migration `DROP POLICY IF EXISTS` at the end of the file).
3. Database → Replication → enable Realtime for the `live_games` table.
4. Authentication → Users → Add user, one per coach (email +
   password). The app never creates users and never needs the
   `service_role` key.
5. Project Settings → API → copy the Project URL and the anon key.
6. Give those two values to Borbet; they go into a `supabase-config.js`
   (URL + anon key only) that the app loads at startup.

## Alternative: Firebase (Firestore)

- One collection, e.g. `gameHistory`, one document per finished game,
  same fields as above (document fields instead of JSONB columns).
- Client: Firebase JS SDK from `www.gstatic.com`, Firestore rules
  allowing read / create / update, no delete.
- Pick this instead if live sync between the two coaches' phones
  becomes a goal later — Firestore's realtime listeners are the
  simpler path there. For history-only, it is more setup for the
  same result, and the data is harder to export than Postgres.

## What this does NOT change

- Live game, queue, swap, clock, and halftime planner are in-memory
  first and sync via `live_games` — see `docs/live-game-design.md`.
- Login is required (Supabase Auth, email + password) before history
  or a live game loads; RLS is authenticated-only. No push, no
  background sync.
- The roster lives in Supabase (`team_roster`, authenticated-only),
  loaded after sign-in; the code contains only the fictional
  13-player sample roster as a fallback. A roster from a live game
  is adopted for that session only and is not written to
  `team_roster` unless the coach taps "Save roster to Supabase".
  Real player names are gated behind coach login + authenticated
  RLS, which is the tightening that was previously listed as a
  precondition for going live with them.
