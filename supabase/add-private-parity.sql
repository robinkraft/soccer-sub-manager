-- Portable Sub Manager — private-parity migration.
-- Run ONCE in the Supabase SQL Editor on a project that already has
-- game_history / live_games / team_roster (i.e. the earlier schema
-- files were already run). Safe to re-run.
-- Adds, all authenticated-only (anon gets nothing):
--  1. team_roster.preferred_lineup — the preferred starting lineup
--     persists with the roster (private app: server persistence).
--  2. game_history.elapsed_seconds — actual played time, shown in
--     History as "52:02 played".
--  3. An authenticated-only DELETE policy on game_history, so the
--     finished screen's "Discard this game" can remove a game.
-- Do NOT seed this table with player names by hand in SQL.

alter table public.team_roster
  add column if not exists preferred_lineup jsonb not null default '[]'::jsonb;

alter table public.game_history
  add column if not exists elapsed_seconds int not null default 0;

drop policy if exists "Signed-in coaches can discard a saved game" on public.game_history;
create policy "Signed-in coaches can discard a saved game"
  on public.game_history for delete
  to authenticated
  using (true);
