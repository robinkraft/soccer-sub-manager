# Soccer Substitution Manager — portable source

A clean implementation of Robin's **private** Soccer Substitution
Manager app as plain files — not the shared version. (The first portable
build was based on the shared app; this one was rebuilt from the private
app Robin actually used for the game, with the private app's screens,
labels, controls and business rules, verified against its screenshots.)
Vanilla HTML/CSS/JS — **no build step, no Muse runtime**. The only
external script is the Supabase JS client (CDN), used only when Supabase
is configured — see below. When Supabase is configured, **sign-in is
required**: coaches sign in with email + password (Supabase Auth) before
history or a live game will load at all.

## Files

- `index.html` — shell; loads the Supabase client (CDN), `supabase-config.js`, `styles.css`, and `app.js`
- `app.js` — the whole app: state, clock/minutes, lineup generation,
  queue + swap, scorer picker, halftime planner, CSV export,
  Supabase history + live sync
- `supabase-config.js` — Supabase project URL + anon key (empty by default; fill in to turn the backend on)
- `supabase/schema.sql` — the three tables (`game_history`, `live_games`, `team_roster`) + RLS policies; run once in Supabase for a new project
- `supabase/add-team-roster.sql` — adds only `team_roster` to a project that already has the other two tables; run once, safe to re-run
- `supabase/add-private-parity.sql` — adds `team_roster.preferred_lineup` (preferred lineup persists server-side), `game_history.elapsed_seconds` (actual played time, shown as "52:02 played"), and an authenticated-only DELETE policy on `game_history` for "Discard this game"; run once, safe to re-run
- `docs/history-import.md` — how the private app's 10 past games get into Supabase `game_history` (import script lives outside this repo — see that doc)
- `docs/backend-history-design.md` — history design
- `docs/live-game-design.md` — live-game design (driver / view-only, realtime, conflicts, offline)
- `styles.css` — phone-first (390×844), high-contrast styling
- `README.md` — this file

## Run locally

```sh
cd soccer-sub-manager-portable
python3 -m http.server 8000
# open http://localhost:8000/
```

Any static server works (`npx serve`, `python -m http.server`, drag the
folder into a static host, etc.). Opening `index.html` directly from disk
also works for most things, but a static server is recommended.

## Host on GitHub Pages

1. Create a repo (e.g. `soccer-sub-manager`) and push these files to
   its default branch.
2. Repo → Settings → Pages → Source: **Deploy from a branch**, branch:
   default, folder: `/ (root)`.
3. Open the Pages URL on your phone. Add to Home Screen if you want a
   full-screen icon (it is still just a web page — no background audio or
   native-app behaviour).

**Do NOT push these rebuilt files to GitHub (or enable Pages) until
they have been reviewed.** The repo history was already cleaned (an
earlier pushed commit that contained the real player names was removed
by rebase + force-push). The code in this folder now contains only the
fictional sample roster (see "Roster" below); real player names live
only in Supabase, behind coach login. Review first, then push.

## Supabase backend — roster + history + live game (optional, recommended)

With no config, the app is in-memory only (see below). With Supabase
configured, the team roster, finished games, and the live game all
live in Supabase — **but only after a coach signs in**.
Row Level Security on all three tables is authenticated-only: the anon /
publishable key alone gets nothing (no select, insert, update, or
delete). Setup, once, in your Supabase account:

1. Create a new project at supabase.com (free tier is plenty).
2. SQL Editor → paste and run `supabase/schema.sql` (creates
   `game_history`, `live_games`, and `team_roster`, with
   authenticated-only Row Level Security). If the old anon policies
   were already run in this project, the same file removes them — the
   migration `DROP POLICY IF EXISTS` statements at the end of
   `schema.sql` run as part of the file, so one run works on a fresh
   project and on a project that already has the old policies. (Do not
   re-run the whole file a second time: the `CREATE POLICY` lines
   will error as duplicates.) **If `game_history` and `live_games`
   already exist, run `supabase/add-team-roster.sql` instead** — it
   adds only `team_roster` and is safe to re-run.
3. Database → Replication → enable **Realtime** for the `live_games`
   table (the schema file notes this; history and roster do not need it).
4. **Create the coach accounts** — Supabase dashboard →
   **Authentication → Users → Add user**, one per coach, email +
   password. The app never creates users, and it never needs the
   `service_role` (secret) key — do not put that key anywhere in the
   app or the repo.
5. Project Settings → API → copy the **Project URL** and the **anon /
   publishable key** (the public client key — never the `service_role`
   secret key).
6. Put those two values in `supabase-config.js` (`url` and `anonKey`)
   and push / redeploy. That is the only config the app needs.

Sign in on the phone with one of the coach accounts from step 4.
The login screen appears before any roster, history, or live game
loads, and the match UI is not rendered behind it. After sign-in the
saved roster loads from `team_roster` (see "Roster" below); if no
roster is saved yet, the fictional sample roster is shown instead.

### History

- After sign-in, page load loads `game_history` newest-first into the
  History tab, with season totals (games, total / average minutes per
  player) and season CSV export. Before sign-in, history does not load
  at all — the login screen is all there is.
- Confirmed End game inserts one row: date, score, per-player totals
  (goalie-adjusted per the "Count goalie time" setting, goalie minutes
  separately, minutes by position), goals (player, or own goal), and
  the starting lineup.
- Edit goals on a past game updates that row (goals + per-player goal
  counts).
- If Supabase is unreachable, the finished game is kept in-memory for
  the session and the app says so, with the CSV download as a backup.

### Live game — one driver, other view-only

- The phone that taps **Start game** is the **driver**. It creates one
  `live_games` row with a 4-character game code (e.g. `K7Q2`) and the
  whole live state as a single snapshot — the same one-snapshot idea
  as the private Muse app's SQLite `app.db`, with Supabase as the
  server instead.
- The other coach signs in, opens Setup → Lineup, and enters the
  4-letter game code in **Join a live game**. That phone is **view-only**: it sees the
  field, bench, queue, score, clock, and minutes live via Supabase
  Realtime, all edit controls are blocked with a clear banner, and it
  can **Take over** (with confirmation) to become the driver — the
  first phone then becomes view-only.
- The clock is stored as an anchor (elapsed at anchor + anchor start
  time + running), never written every second. Driver writes are
  debounced ~1–2s and only on actions (Apply, score, pause, queue
  change, …). The view-only phone's clock advances from the anchor;
  its minutes update when the driver syncs.
- Conflicts: each write bumps a version number. If the row moved past
  the version the driver last saw, the app shows "Updated by the other
  coach" and offers **Reload their version** / **Keep mine** — it never
  silently overwrites.
- Offline: the app always works in-memory first and shows "Offline —
  changes will sync when signal returns". On reconnect it re-fetches
  and offers the same conflict choice if needed.
- There are no links to text: the other coach joins by typing the
  game code — nothing is copied or texted.

### No config / offline

- `supabase-config.js` empty, the Supabase CDN blocked, or the project
  unreachable → the app falls back to exactly today's in-memory
  behaviour, with a clear "Backend not configured" note on the History
  tab instead of crashing. The live game and History both work for the
  session; nothing is saved between reloads.

## Browser storage — the rule, and its one exception

Robin's rule: **game and history data are never stored in browser
storage**. No `sessionStorage`, no `localStorage`, no IndexedDB, no
cookies for game state, history, roster, or the preferred starting
lineup — that data lives in Supabase (when configured) or in memory
only. The rule is about game/history data, not about the auth token.

The **one exception is the Supabase Auth session itself**: the
Supabase client stores its session token in `localStorage` by default,
and **Sign out clears it**. That is what lets a coach stay signed in
across reloads instead of signing in again every time. Do not switch
the client back to in-memory session storage — that would force a
sign-in on every reload.

- Without Supabase configured, reloading the page starts fresh: no
  game, no roster edits, no history, no preferred lineup.
- The **preferred starting lineup** ("Save as preferred" / "Use
  preferred lineup") is in-memory only for the current page session,
  even with Supabase on. Closing or reloading the tab clears it.
- There is no "saved" indicator.

That matches the original shared app (the private app is the one with
server persistence; this portable copy recreates that persistence in
Supabase instead of in Muse).

## Roster — lives in Supabase, not in the code

The team roster is stored in the Supabase `team_roster` table (one
row: team name + players `[{name, prefs}]`, authenticated-only RLS).
After sign-in the app loads it and uses it instead of the fallback
below. Roster edits in the app — Rename, Add player, Remove, and
position-prefs changes on the Team tab — save back to `team_roster`
automatically when signed in. The team name saves with the roster.

The code contains only a **fictional 13-player sample roster** as
the fallback, shown when no saved roster exists yet (or Supabase is
not configured):

Mia, Liam, Sofia, Noah, Ava, Mateo, Chloe, Ethan, Maya, Lucas, Zoe,
Oliver, Grace.

7v7, 1-2-3-1 (GK/RB/LB/RM/CM/LM/ST), 50 minutes by default. Position
preferences guide the auto-generator but never block a manual pick.
The sample roster is labelled as a sample in the app ("Roster: sample
roster…") on the Setup screen.

### Seeding the real roster (first time, after running the migration)

There is no seed file with real names — seed from the app instead:

1. Sign in. The app shows the fictional sample roster.
2. On the Setup screen, open **Team & positions** and tap **Rename**
   on each sample player, typing the real name. Each rename saves to
   Supabase automatically. Fix position prefs the same way, and set
   the team name under Match settings.
3. There is no seed file and no link import — rename from the app
   (above) is the only way the real roster gets in.

Either way, after seeding, every sign-in loads the saved roster from
Supabase and the sample names are gone from the screen.

## Key behaviours (as in the original)

- **Substitutions queue.** Nothing touches the field until you tap
  **Apply**. Start a sub from either side: field player first then bench,
  or bench player first then field. Queue several, then Apply once.
  Queued chips show the pairing (`→ Maya` on the field chip,
  `for Lucas` on the bench chip) with a small `↓ RB` / `↑ RB` badge
  offset above the chip so the name stays fully legible.
- **Swap exception.** Tap two field players to stage a swap; the Swap
  button appears only while a swap is pending, and tapping it executes
  the swap **immediately** — no Apply. Undo is offered after. No swap
  can start while substitution queue items are pending.
- **Field is one component.** Setup, kickoff review, live, halftime and
  finished screens all render the same field — our half only, no
  halfway line or centre circle. Chips show just the name,
  centred; empty spots show just the position label; full names are never
  truncated.
- **Live screen.** Field pinned at the top, bench above the queue, tabs
  under the scoreboard (Actions / Minutes / Team / Positions). The
  driver sees the game code as plain text under the tabs; the other
  coach joins by typing that code on setup. No Add button — tapping
  the field is the entry point.
- **Goals.** US + / THEM + opens the scorer picker: players A–Z in a
  two-column newspaper-style grid, one line per player, Own goal and
  Skip pinned at the bottom, goal minute with −/+ steppers before
  confirming. US − removes the most recent US goal. Edit goals fixes a
  minute or removes a goal, live and in past-game Details.
- **Clock.** Pause/resume, **+2:00** (credits the players currently on
  the field), halftime planner that favours low-minute players, and a
  **Set clock to 25:00** snap on the halftime screen when the paused
  clock isn't exactly on the half boundary.
- **Play short (6v7).** Removes one slot (your choice), preserves every
  player's minutes, updates fair-share projections; return to full
  strength restores it. A removed slot is tappable to add it back.
- **Attendance.** Marking a bench player absent leaves the starting
  seven untouched; marking a starter absent clears only their spot.
- **Minutes & fair share.** Actual + projected minutes per player, with
  LOW / OK / HIGH flags against a configurable threshold. Setting
  **"Count goalie time toward total game time"** defaults OFF — when
  off, totals count only non-goalie minutes; goalie minutes are still
  tracked and shown in the per-position breakdown.
- **Notes.** Per-player notes on the Team tab are private and are
  **never shared**. Lineup pickers show a player's
  already-assigned position next to their name (display only).
- **History & CSV.** Finished games list score, scorers and minutes,
  with season totals; each game exports its own CSV with player,
  attendance, actual minutes, GK minutes, goals and per-position
  minutes. **Export all history** (History tab, next to Full season
  CSV) is the complete backup: one file with every game — dates,
  scores, match minutes, played time, starting lineups, per-player
  minutes, and every goal with scorer, minute and side. **Export
  roster** (Roster tab) is the roster backup: every player with
  availability, tired flag, all seven preferred positions and note.
  With Supabase configured, history comes from the backend and survives
  reloads; without it, it is this session only.

## Joining a live game (game code)

No links, no texting. The driver starts the game and the app shows a
4-letter game code as plain text on the live screen. The other coach
signs in, opens Setup → Lineup, types the code into **Join a live
game**, and taps **Join live game** — that phone becomes view-only and
sees the game live. Take over (with confirmation) swaps the driver.
The `?game=` URL parameter and the old `#s=` / `#g=` texted links
were removed entirely in Nov 2026; the v5 link format code is gone
with them.

## Deliberately left out

- **Multi-user sync beyond driver / view-only.** Login is now required
  (Supabase Auth, authenticated-only RLS), and the live game is one
  driver with the other coach view-only. Full multi-user sync — both
  coaches editing at once, per-coach roles, presence — is a future
  step, not built here.
- **The private app's real roster and server history.** This copy is the
  shared app only.
- **Anything else that needs a backend** (push, background audio).


## Clean implementation of the private app — what changed

The portable app was rebuilt from the private Soccer Substitution
Manager (screens, labels, controls, rules), not incrementally patched
from the shared version. Gap list — private feature → portable before
→ portable now:

- **Branding** — was "Sub Manager (shared)"; now "Soccer Substitution Manager".
- **Setup tabs** — was one scrolling page of `<details>` sections; now
  top-level tabs **Lineup / Roster / Settings / History**, as in the
  private app. Lineup tab: Join a live game (game code), Preferred
  lineup (Ready / Manage), Use last game's lineup, Refresh lineup +
  Review & start, Clear, field, OPENING BENCH line. Roster tab:
  "Attendance & positions", availability circle, name, "Available ·
  N positions", Rename + More, position chips inline with green
  checkmarks. Settings tab: match settings. History tab: season totals
  + past games.
- **Live tabs** — was Field / Minutes / Team / History; now
  **Actions / Minutes / Team / Positions**. Scoreboard is the private
  layout: US −/+ on the left, clock centre, THEM −/+ on the right,
  +2:00 and an orange PAUSE/RESUME below. Actions tab: field with
  minutes under each name, bench, big orange "Apply N now", "Next
  change / N ready / Clear" with numbered queued pairs.
- **Halftime** — was a plain planner; now the private screen: HALFTIME
  badge, "Reset the balance." headline, two-column first-half minutes,
  "Position preferences", green
  "Refresh lineup" with a "Lineup N" counter, "Second-half 7v7 lineup"
  with "N/7 filled · tap a player to change".
- **History** — was a `<details>` list; now expandable Details/Hide
  cards with date, score, "MM:SS played", "Export this game CSV",
  "Goals / Edit goals", and per-player rows with the counted total
  plus a per-position breakdown (goalie minutes included in the
  breakdown). Season totals are cards per the private screen — see
  below.
- **Preferred lineup** — was in-memory only; now persists in Supabase
  (`team_roster.preferred_lineup`) and survives reloads.
- **Last game's lineup** — was in-session only; now derived from the
  newest `game_history` row after reload.
- **Notes** — were in-memory only; now stored in
  `team_roster.players[].note` and persist across games (still never
  shared).
- **Finished screen** — gained "Close and view history" (opens the
  History tab) and "Discard this game" (deletes the Supabase row —
  needs the authenticated-only DELETE policy in
  `add-private-parity.sql`).
- **Edit lineup mid-game** — now a dedicated editor that returns to
  the live game without resetting clock/score/minutes.
- **Late arrivals / departing players** — now on the live Team tab
  (Leaving / Arrived); a departing player keeps their minutes.
- **Clock** — keeps running past full time; overage shows next to it.
- **Swap** — tapping a selected player deselects just that one.
- **Scorer picker** — one-line rows (name · position).
- **No "7 on field" indicator** on setup; preferred lineup collapsed
  behind Manage; finished screen opens scrolled to the top.

Intentionally different from the private app:

- **Supabase replaces the private app's server persistence** (its
  SQLite snapshot). History, roster and preferred lineup live in
  Supabase tables, not in a Muse server.
- **Login replaces the private app's owner session.** Any signed-in
  coach can read/write; coach accounts are created by Robin in the
  Supabase Auth dashboard. There is no in-app sign-up (an open
  sign-up would let anyone who finds the public Pages site create an
  account and read/write the tables).
- **Live game is driver / view-only**, which the private app doesn't
  have: one phone drives, the other watches live and can Take over.
- **Visual language** follows the private app's screenshots (dark
  navy, dark cards, green field, white chips with dark text, yellow
  selected tab, green primary buttons, orange Apply/PAUSE), but the
  layout is rebuilt in plain CSS, not a copy of the private app's
  markup.

## Season totals

The History tab's Season totals are computed from **all** Supabase
`game_history` rows (not just this session), sorted by total minutes
descending, and update whenever a game is added or a past game is
edited (Edit goals re-saves the row). Each card shows: name, avg/game
(one decimal, from exact seconds ÷ games played), bold total minutes,
games played, and a per-position breakdown in whole minutes.

Goalie-time rule (verified end-to-end in code): the setting "Count
goalie time toward total game time" defaults OFF. When OFF, the total
and avg count only non-goalie minutes, while the per-position
breakdown still includes goalie minutes; fair share is computed on
the six non-goalie field slots, and a player standing in goal accrues
no counted projected minutes. When ON, goalie minutes count toward
everything. "↓ Full season CSV" downloads the same totals (one row
per player, with per-position columns).

## History import (private app's 10 past games)

The private app's saved state is not readable by the agent, so the
import goes through its CSV exports. The import script and its docs
live **outside this repo** (they contain the real roster), at
`~/workspace/soccer-sub-manager-history-import/` — see
`docs/history-import.md` in this repo for the steps. The primary input
is the portable app's **Export all history** file (one file, all games
with lineups and goal minutes, no manifest needed); the fallback is
one per-game CSV per game plus a `manifest.json` (dates, scores,
starting lineups, goal minutes when known). Dry-run with
`node import-history.mjs`, paste the generated SQL into the Supabase
SQL Editor. Re-running the SQL is safe (dedupe on game_date + score).
No historical rows have been inserted yet — the import is waiting on
the CSV exports. After it runs, Season totals in this app must match
the private app's Season totals screen; that is the verification
check. Note: the private app needs the same two exports (Export all
history, Export roster) for the migration to work from it.

## Temporary private preview (not the deliverable)

After this rebuild, a **temporary private preview artifact** may be
made from these files so Robin can try the rebuilt app on his phone
in the Muse app (sign in with his coach account, same Supabase
backend) before anything is pushed to GitHub. The preview is only for
trying it out — it is **not** the deliverable, and it is to be deleted
after he approves the GitHub push. The GitHub source in this folder
remains the real app. Do not treat the preview link as a share link:
never publish it or hand it to anyone else.
