-- Sub Manager (shared) — history + live-game + roster backend schema (Supabase / Postgres)
-- LOGIN-REQUIRED. Run this once in the Supabase SQL Editor for a new project.
-- History: one row per finished game in game_history (End game writes it).
-- Live game: one row per active game in live_games (see below).
-- Team roster: one row in team_roster holding the team name and the
-- player list (players jsonb: [{ "name", "prefs": ["ST", ...] }]).
-- The roster lives here, in Supabase — never hardcoded in the app.
-- The code contains only a fictional sample roster as a fallback.
-- Row Level Security is authenticated-only on all three tables: the anon
-- (publishable) key alone gets nothing — no select, insert, update, or
-- delete. A coach must sign in (Supabase Auth, email + password) before
-- the app loads the roster, history, or joins a live game. Coach accounts
-- are created by Robin in the Supabase dashboard
-- (Authentication → Users → Add user); never use the service_role key
-- in the app or to create users from here.
-- Already have game_history / live_games? Run supabase/add-team-roster.sql
-- instead — it adds only team_roster to an existing project.
-- Game/history data is never stored in browser storage by the app; the
-- only browser storage is the Supabase Auth session itself, stored by
-- the Supabase client in localStorage by default and cleared on Sign out.

create table if not exists public.game_history (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Date the game was played (not the timestamp it was saved).
  game_date date not null,
  team_name text not null default 'Sample Team',
  match_minutes int not null default 50,
  -- Actual elapsed seconds when the game ended (clock may run past
  -- full time; History shows this as "52:02 played").
  elapsed_seconds int not null default 0,
  our_score int not null default 0,
  their_score int not null default 0,
  -- Per-player totals, one entry per present player, in roster order.
  -- [{ "name": "Maya", "roster_index": 8, "present": true,
  --    "total_minutes": 32.5, "goalie_minutes": 0, "goals": 1,
  --    "minutes_by_position": {"ST": 20, "RM": 12.5} }]
  -- total_minutes follows the "Count goalie time" setting: when OFF it
  -- counts only non-goalie minutes; goalie_minutes is tracked separately.
  players jsonb not null default '[]'::jsonb,
  -- Goals in chronological order.
  -- [{ "player_index": 8, "player_name": "Maya", "seconds": 1380 }]
  -- player_index -1 = own goal; seconds may be null (backfilled, no time).
  goals jsonb not null default '[]'::jsonb,
  -- Starting lineup at kickoff, roster indices in position order
  -- GK, RB, LB, RM, CM, LM, ST. Null entries = empty / removed slot.
  starting_lineup jsonb not null default '[]'::jsonb
);

-- History reads are newest-first; this index keeps that fast.
create index if not exists game_history_game_date_idx
  on public.game_history (game_date desc, created_at desc);

alter table public.game_history enable row level security;

-- Login-required: only signed-in coaches can read history, add a
-- finished game, or update one (Edit goals on a past game). The anon
-- role gets nothing on this table — no select, insert, update, or
-- delete. No deletes through the app for any role.
create policy "History is readable by signed-in coaches"
  on public.game_history for select
  to authenticated
  using (true);

create policy "Signed-in coaches can save a finished game"
  on public.game_history for insert
  to authenticated
  with check (true);

create policy "Signed-in coaches can edit a saved game (goals/minutes)"
  on public.game_history for update
  to authenticated
  using (true)
  with check (true);

-- Discard (private finished screen: "Discard this game" removes the
-- finished game from History). Authenticated coaches only; the anon
-- role gets nothing, same as the other policies.
create policy "Signed-in coaches can discard a saved game"
  on public.game_history for delete
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Live game (optional, same project — see docs/live-game-design.md)
-- Mirrors the private Muse app's approach: one row holding the whole
-- live state as a single snapshot (its SQLite app.db was one table,
-- one row, whole state). Here that snapshot lives in Supabase so both
-- coaches' phones can share it, instead of frozen texted #g= links.
-- ---------------------------------------------------------------------------

create table if not exists public.live_games (
  id uuid primary key default gen_random_uuid(),
  -- Short sharing code, e.g. 'K7Q2' — generated at Start game and shared
  -- via the game link (?game=K7Q2). The code is a sharing key, not the
  -- access control: reading or writing this game still requires a
  -- signed-in coach (see RLS below). The code alone gets nothing.
  game_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Optimistic concurrency: increment on every write. A writer that
  -- last saw version N writes version N+1; if the row is already past
  -- N+1, the app shows "updated by the other coach" instead of
  -- silently overwriting.
  version int not null default 1,
  -- 'setup' | 'live' | 'halftime' | 'finished'
  phase text not null default 'setup',
  -- Random per-tab writer id (generated in memory on page load, never
  -- stored in the browser). Lets the UI say who made the last change
  -- and lets a tab ignore its own realtime echo.
  last_writer_id text,
  last_writer_label text,
  -- Whole live state as one JSON snapshot:
  -- { team_name, settings, roster, lineup, bench, queue, swap_staging,
  --   score: {us, them}, goals, tired, present, minutes/stints,
  --   clock: { elapsed_seconds_at_anchor, anchor_started_at, running },
  --   halftime_plan, notes }
  -- The clock is an anchor, NOT a ticking value: elapsed = anchor
  -- elapsed + (now - anchor_started_at) while running, so the app
  -- does not write to Supabase every second.
  state jsonb not null default '{}'::jsonb
);

create index if not exists live_games_game_code_idx
  on public.live_games (game_code);

alter table public.live_games enable row level security;

-- Login-required, same as history: only signed-in coaches can read,
-- start, or update a live game. The anon role gets nothing. The
-- driver / view-only split is enforced in the app (the view-only phone
-- never issues writes; Take over makes it the driver) — RLS is the
-- gate that keeps anyone without a coach login out entirely.
-- No deletes through the app for any role.
create policy "Live game is readable by signed-in coaches"
  on public.live_games for select
  to authenticated
  using (true);

create policy "Signed-in coaches can start a live game"
  on public.live_games for insert
  to authenticated
  with check (true);

create policy "Signed-in coaches can update a live game"
  on public.live_games for update
  to authenticated
  using (true)
  with check (true);

-- Realtime: both phones subscribe to changes on live_games so a sub
-- applied on one phone appears on the other without a texted link.
-- In the Supabase dashboard: Database → Replication → enable
-- Realtime for the live_games table (or run the publication SQL
-- Supabase generates for it).

-- ---------------------------------------------------------------------------
-- Team roster (see docs: roster lives in Supabase, not in the code)
-- One row for the team: team name + players [{ "name", "prefs" }].
-- The app loads it after sign-in and falls back to the fictional
-- sample roster in the code when no row exists yet. Roster edits in
-- the app (rename / add / remove / position prefs) save back here;
-- a roster imported from a texted link is NOT written here unless
-- the coach taps "Save roster to Supabase" in the app. No Realtime
-- needed — the roster is read once per sign-in.
-- ---------------------------------------------------------------------------

create table if not exists public.team_roster (
  id uuid primary key default gen_random_uuid(),
  team_name text not null default 'Sample Team',
  -- Player list, in roster order.
  -- [{ "name": "Maya", "prefs": ["ST", "RM", "LM"], "note": "" }]
  -- Notes persist with the roster (private app) but are never
  -- included in texted links.
  players jsonb not null default '[]'::jsonb,
  -- Preferred starting lineup, roster indices in position order
  -- GK, RB, LB, RM, CM, LM, ST (null = empty spot). The private app
  -- persists the preferred lineup server-side; here it lives in this
  -- row so it survives reloads.
  preferred_lineup jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.team_roster enable row level security;

-- Login-required, same as history and live game: only signed-in
-- coaches can read or save the roster. The anon role gets nothing.
-- No deletes through the app for any role.
create policy "Team roster is readable by signed-in coaches"
  on public.team_roster for select
  to authenticated
  using (true);

create policy "Signed-in coaches can save the team roster"
  on public.team_roster for insert
  to authenticated
  with check (true);

create policy "Signed-in coaches can update the team roster"
  on public.team_roster for update
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------------------
-- Migration: if the old anon policies were already run in this project,
-- the statements below remove them. They run as part of this file, so
-- one run works on both a fresh project (the drops are no-ops) and a
-- project that already has the old anon policies (they are removed,
-- leaving only the authenticated-only policies created above).
-- Note: re-running this whole file a second time will error on the
-- CREATE POLICY lines above, because those policies already exist.
-- That is expected — run the file once; to re-apply, drop the
-- authenticated policies first, or run only the DROP statements below.
-- ---------------------------------------------------------------------------
drop policy if exists "History is readable by anyone" on public.game_history;
drop policy if exists "Anyone can save a finished game" on public.game_history;
drop policy if exists "Anyone can edit a saved game (goals/minutes)" on public.game_history;
drop policy if exists "Live game is readable by anyone with the code" on public.live_games;
drop policy if exists "Anyone can start a live game" on public.live_games;
drop policy if exists "Anyone can update a live game" on public.live_games;
