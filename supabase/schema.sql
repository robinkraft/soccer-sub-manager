-- Sub Manager (shared) — history + live-game + roster backend schema (Supabase / Postgres)
-- LOGIN-REQUIRED for coaches; WATCHING goes through a checked code.
-- Run this once in the Supabase SQL Editor for a new project.
-- History: one row per finished game in game_history (End game writes it).
-- Live game: one row per active game in live_games (see below).
-- Team roster: one row in team_roster holding the team name and the
-- player list (players jsonb: [{ "name", "prefs": ["ST", ...] }]).
-- The roster lives here, in Supabase — never hardcoded in the app.
-- The code contains only a fictional sample roster as a fallback.
-- Row Level Security is authenticated-only on all three tables: the
-- anon (publishable) key alone gets nothing — no select, insert,
-- update, or delete. A coach must sign in (Supabase Auth, email +
-- password) before the app loads the roster, history, or drives a
-- game. Anonymous viewing is NOT an open table read: it goes through
-- the SECURITY DEFINER function viewer_access(code) (see the
-- viewer-access section at the end of this file), which returns the
-- live game (if one is running) and the history ONLY when the
-- supplied code matches an active row in viewer_codes — otherwise
-- it returns nothing. The coach generates the code in the app
-- (Settings → Share a view link); generating a new one deactivates
-- the old one, so a shared link can be killed. Coach accounts are
-- created by Robin in the Supabase dashboard (Authentication →
-- Users → Add user); never use the service_role key in the app or
-- to create users from here.
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

-- History: login-required. Only signed-in coaches can read history,
-- add a finished game, or update one (Edit goals on a past game).
-- The anon role gets nothing on this table — no select, insert,
-- update, or delete. Anonymous viewing goes through the
-- SECURITY DEFINER function viewer_access() (see the viewer-access
-- section at the end of this file), never through direct table reads.
-- No deletes through the app for any role except the authenticated
-- discard below.
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
  -- Short sharing code, e.g. 'K7Q2' — generated at Start game and
  -- shown as plain text on the driver's live screen. The OTHER coach
  -- types it into "Join a live game" on setup (signed in, view-only,
  -- can Take over). This game code is NOT the viewer share code:
  -- anonymous viewing uses a separate code from viewer_codes, checked
  -- server-side by viewer_access(). Writing the game still requires
  -- a signed-in coach.
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
  --   stints: [{start, pos} | null] per roster index, halftime_plan, notes }
  -- The clock is an anchor, NOT a ticking value: elapsed = anchor
  -- elapsed + (now - anchor_started_at) while running, so the app
  -- does not write to Supabase every second. The anchor is the
  -- running stretch's start, never re-based on sync. Player minutes
  -- work the same way: displayed minutes = banked minutesSec/gkSec/
  -- posSec + (now - stint start) for the open stint, so a second
  -- browser derives the same minutes with no sync mid-stint.
  state jsonb not null default '{}'::jsonb
);

create index if not exists live_games_game_code_idx
  on public.live_games (game_code);

alter table public.live_games enable row level security;

-- Live game: login-required, same as history. Only signed-in coaches
-- can read, start, update, or shut down a live game. The anon role
-- gets nothing on this table. Anonymous viewing goes through the
-- SECURITY DEFINER function viewer_access() (see the viewer-access
-- section at the end of this file), never through direct table reads.
-- The driver / view-only split is enforced in the app (the view-only
-- phone never issues writes; Take over makes it the driver) — RLS is
-- the gate that keeps anyone without a coach login out entirely.
-- Deletes are coach-only: Shut down game removes a live row without
-- saving history (different from End game, which finishes and saves).
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

create policy "Signed-in coaches can shut down a live game"
  on public.live_games for delete
  to authenticated
  using (true);

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

-- Roster stays login-required on every operation: only signed-in
-- coaches can read or save it. The anon role gets nothing here.
-- There is no delete policy on this table — the roster is never
-- deleted through the app. (Deletes exist on the other tables:
-- authenticated-only, for discarding a saved game and for shutting
-- down a live game.)
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
drop policy if exists "History is readable by anyone (view-only)" on public.game_history;
drop policy if exists "Anyone can save a finished game" on public.game_history;
drop policy if exists "Anyone can edit a saved game (goals/minutes)" on public.game_history;
drop policy if exists "Live game is readable by anyone with the code" on public.live_games;
drop policy if exists "Live game is readable by anyone (view-only)" on public.live_games;
drop policy if exists "Anyone can start a live game" on public.live_games;
drop policy if exists "Anyone can update a live game" on public.live_games;

-- ---------------------------------------------------------------------------
-- Viewer access — anonymous watching through a checked code (Nov 2026)
-- "Lock it down": the tables above stay authenticated-only. Anonymous
-- viewing goes through ONE server-side check, the SECURITY DEFINER
-- function viewer_access(code). Anon gets NO direct SELECT on any
-- table — only EXECUTE on this function. The function runs as the
-- table owner, checks the code against viewer_codes, and returns the
-- live game (if one is running) and the history ONLY on a match;
-- otherwise it returns {"ok": false} and nothing else.
--
-- viewer_codes: share codes the coach generates in the app
-- (Settings → Share a view link). One active code at a time: the
-- partial unique index below allows at most one active row, so
-- generating a new code must deactivate the old one first (the app
-- does that in one go). Regenerating kills the old shared link.
-- RLS on viewer_codes is authenticated-only on every operation.
-- The code is the key, and a 4-letter code is guessable: anyone who
-- guesses the active code sees the live game (including player
-- names) and the history until the coach generates a new code. That
-- is the remaining tradeoff, and it is revocable by regeneration.
-- The viewer link works any time — with no live game running, the
-- viewer still sees the history.
-- ---------------------------------------------------------------------------

create table if not exists public.viewer_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- At most one active code: a unique index on the constant "active"
-- value, applying only to active rows.
create unique index if not exists viewer_codes_one_active_idx
  on public.viewer_codes (active) where active;

alter table public.viewer_codes enable row level security;

create policy "Viewer codes are readable by signed-in coaches"
  on public.viewer_codes for select
  to authenticated
  using (true);

create policy "Signed-in coaches can create a viewer code"
  on public.viewer_codes for insert
  to authenticated
  with check (true);

create policy "Signed-in coaches can update a viewer code"
  on public.viewer_codes for update
  to authenticated
  using (true)
  with check (true);

create policy "Signed-in coaches can delete a viewer code"
  on public.viewer_codes for delete
  to authenticated
  using (true);

create or replace function public.viewer_access(p_code text)
returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_ok boolean;
  v_lives jsonb;
  v_history jsonb;
begin
  -- The code is the whole check: active row in viewer_codes, or nothing.
  select exists(
    select 1 from public.viewer_codes where code = p_code and active
  ) into v_ok;
  if not v_ok then
    return jsonb_build_object('ok', false);
  end if;
  -- The running live games, if any (live or halftime only — a
  -- finished game is covered by the history below, not by a stale
  -- live row). All of them: a viewer picks which one to watch.
  select coalesce(jsonb_agg(row_to_json(l) order by l.updated_at desc), '[]'::jsonb)
    into v_lives
  from (
    select id, game_code, version, phase, state
    from public.live_games
    where phase in ('live', 'halftime')
    order by updated_at desc
  ) l;
  -- The whole history, newest first (capped: a season is tens of games).
  select coalesce(jsonb_agg(row_to_json(h) order by h.game_date desc, h.created_at desc), '[]'::jsonb)
    into v_history
  from (
    select id, game_date, team_name, match_minutes, elapsed_seconds,
      our_score, their_score, players, goals, starting_lineup, created_at
    from public.game_history
    order by game_date desc, created_at desc
    limit 200
  ) h;
  return jsonb_build_object('ok', true, 'live', v_lives->0, 'lives', v_lives, 'history', v_history);
end;
$$;

-- Anon (and signed-in coaches) may ONLY execute this function — no
-- direct table access is granted by it. Revoke from public first so
-- the grants below are the only ones.
revoke all on function public.viewer_access(text) from public;
grant execute on function public.viewer_access(text) to anon, authenticated;
