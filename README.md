# Sub Manager (shared) — portable source

A faithful, working rebuild of Robin's Sub Manager (shared) app as plain
files. Vanilla HTML/CSS/JS — **no build step, no Muse runtime**. The only
external script is the Supabase JS client (CDN), used only when Supabase
is configured — see below. When Supabase is configured, **sign-in is
required**: coaches sign in with email + password (Supabase Auth) before
history or a live game will load at all.

## Files

- `index.html` — shell; loads the Supabase client (CDN), `supabase-config.js`, `styles.css`, and `app.js`
- `app.js` — the whole app: state, clock/minutes, lineup generation,
  queue + swap, scorer picker, halftime planner, CSV export, v5 links,
  Supabase history + live sync
- `supabase-config.js` — Supabase project URL + anon key (empty by default; fill in to turn the backend on)
- `supabase/schema.sql` — the three tables (`game_history`, `live_games`, `team_roster`) + RLS policies; run once in Supabase for a new project
- `supabase/add-team-roster.sql` — adds only `team_roster` to a project that already has the other two tables; run once, safe to re-run
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
also works for most things, but a static server is recommended — the link
encoder uses the page URL, and `sms:` / clipboard behave better over HTTP.

## Host on GitHub Pages

1. Create a repo (e.g. `soccer-sub-manager`) and push these files to
   its default branch.
2. Repo → Settings → Pages → Source: **Deploy from a branch**, branch:
   default, folder: `/ (root)`.
3. Open the Pages URL on your phone. Add to Home Screen if you want a
   full-screen icon (it is still just a web page — no background audio or
   native-app behaviour).

**Do NOT make the repo public (or enable Pages) until it has been
recreated clean.** An earlier pushed commit still contains the real
player names in Git history, so a commit that removes them is not
enough — the old commit would still be visible once the repo is
public. Recreate the repo from only these scrubbed files, then make
that one public. The code in this folder now contains only the
fictional sample roster (see "Roster" below); real player names live
only in Supabase, behind coach login.

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
- The other coach opens the live link (`?game=K7Q2`, from the Live
  screen's "Copy live link"). That phone is **view-only**: it sees the
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
- The frozen `#g=` texted snapshot links still work as a fallback —
  they were not removed.

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
3. Or: import a setup link carrying the real roster (Setup → "Import
   texted setup or game"), then tap **Save roster to Supabase** under
   Team & positions. A link-imported roster is adopted for that
   session only and is never auto-saved — the explicit save is what
   writes it to `team_roster`.

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
  finished screens all render the same field. Chips show just the name,
  centred; empty spots show just the position label; full names are never
  truncated.
- **Live screen.** Field pinned at the top, bench above the queue, tabs
  under the scoreboard (Field / Minutes / Team / History), Text coach as
  a compact action at the bottom. No Add button — tapping the field is
  the entry point. No Positions button.
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
  **never included** in texted links. Lineup pickers show a player's
  already-assigned position next to their name (display only).
- **History & CSV.** Finished games list score, scorers and minutes,
  with season totals; each exports a CSV with player, attendance,
  actual minutes, GK minutes, goals and per-position minutes. With
  Supabase configured, history comes from the backend and survives
  reloads; without it, it is this session only.

## Texted setup / game links (v5)

Same wire format as the original apps, so links interoperate with them:

- Payload = `v5` + base64url(deflate-raw(UTF-8 JSON)), no padding.
- Setup: `["ssm",4,"s",teamName,settings,roster,lineup]`
- Game snapshot: `["ssm",4,"g",teamName,settings,roster,lineup,matchMinutes,elapsedSeconds,ourScore,theirScore,minutesTenths,presentMask,tiredMask,plannedLineup,rotation,goals]`
- Settings are `[matchMinutes, cadence, subsPerRotation, fairTimeThreshold]`
  with an optional 5th element (1/0) for the goalie-time setting; older
  4-element links import with goalie time defaulting to off.
- Goals are `[[playerIndex, secondsOrNull]]`; `-1` is an own goal.
- **No backward compatibility** with older link formats — only this
  schema imports. Anything else shows: "This link looks broken or is
  from an older version — ask for a fresh link."

Use **Copy setup link / Copy game link** (or the SMS buttons) on the
Setup / Live screens, and **Import texted setup or game** to paste a link
the other coach sent. Import adopts the link's roster. A `#g=` snapshot
opens read-only ("Snapshot · as of MM:SS — not live"); **Take over**
opens the halftime planner for review before the clock resumes.

Link encoding uses `CompressionStream` / `DecompressionStream`
(deflate-raw), available in current Chrome/Safari/Firefox. If a browser
lacks them, link creation/import shows an error instead of silently
producing a bad link.

## Deliberately left out

- **Multi-user sync beyond driver / view-only.** Login is now required
  (Supabase Auth, authenticated-only RLS), and the live game is one
  driver with the other coach view-only. Full multi-user sync — both
  coaches editing at once, per-coach roles, presence — is a future
  step, not built here.
- **The private app's real roster and server history.** This copy is the
  shared app only.
- **Anything else that needs a backend** (push, background audio).
