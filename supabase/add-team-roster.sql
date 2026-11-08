-- Sub Manager (shared) — add the team_roster table to an EXISTING project.
-- Run this once in the Supabase SQL Editor (one run) if game_history and
-- live_games are already created. For a brand-new project, run the full
-- supabase/schema.sql instead — it already includes this table.
-- Safe to re-run: the table is created IF NOT EXISTS and each policy is
-- dropped (IF EXISTS) before it is created, so a second run does not
-- error on duplicates.
--
-- What this adds: one team_roster row holding the team name and the
-- player list (players jsonb: [{ "name", "prefs": ["ST", ...] }]).
-- The roster lives here, in Supabase — never hardcoded in the app.
-- The code contains only a fictional sample roster as a fallback.
-- Row Level Security is authenticated-only: the anon (publishable) key
-- alone gets nothing — no select, insert, update, or delete. A coach
-- must sign in (Supabase Auth, email + password) before the app loads
-- or saves the roster. Do NOT seed this table with player names by
-- hand in SQL: seed it from the app instead (sign in, rename the
-- sample players on the Team tab, or import a setup link and tap
-- "Save roster to Supabase") — see README.md, "Roster".

create table if not exists public.team_roster (
  id uuid primary key default gen_random_uuid(),
  team_name text not null default 'Sample Team',
  -- Player list, in roster order.
  -- [{ "name": "Maya", "prefs": ["ST", "RM", "LM"] }]
  players jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.team_roster enable row level security;

drop policy if exists "Team roster is readable by signed-in coaches" on public.team_roster;
create policy "Team roster is readable by signed-in coaches"
  on public.team_roster for select
  to authenticated
  using (true);

drop policy if exists "Signed-in coaches can save the team roster" on public.team_roster;
create policy "Signed-in coaches can save the team roster"
  on public.team_roster for insert
  to authenticated
  with check (true);

drop policy if exists "Signed-in coaches can update the team roster" on public.team_roster;
create policy "Signed-in coaches can update the team roster"
  on public.team_roster for update
  to authenticated
  using (true)
  with check (true);
