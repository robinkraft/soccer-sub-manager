-- Sub Manager — add columns the app writes that older tables may lack (Nov 2026).
-- Run once in the Supabase SQL Editor. Safe to re-run (IF NOT EXISTS /
-- CREATE OR REPLACE throughout).
--
-- ROOT CAUSE (found 2026-11-08 by calling viewer_access for a real code):
-- Robin's live_games table was created from the FIRST schema.sql, before
-- updated_at was added to it. CREATE TABLE IF NOT EXISTS never adds a
-- column to a table that already exists, so the live table never got it.
-- Two things then broke:
--   1. viewer_access() orders live games by updated_at -> the function
--      errors ("column l.updated_at does not exist"), so every view-code
--      check fails and the app reports the code as "not found".
--   2. Every live sync write sets updated_at (doLiveSync, finishLiveGame),
--      so those updates fail too and the app silently goes offline — which
--      is also why the clock/anchor did not reach a second browser.
-- Starting a game still worked because the INSERT does not set updated_at.
-- After this runs, re-test a view link: it should open straight into the
-- view, and live sync writes should land again.
-- UPDATE 2026-11-08: the first run still failed — the live live_games table
-- was created without ANY timestamp columns (no created_at either), so this
-- file now adds created_at too, and the function no longer orders by any
-- timestamp. Re-run the whole file; it is safe to re-run.

alter table public.live_games
  add column if not exists updated_at timestamptz not null default now();

alter table public.live_games
  add column if not exists created_at timestamptz not null default now();

alter table public.game_history
  add column if not exists created_at timestamptz not null default now();

alter table public.team_roster
  add column if not exists updated_at timestamptz not null default now();

-- Recreate viewer_access ordering by created_at (which the table has had
-- from the start) instead of updated_at, so the viewer check can never
-- break on this column again. Behaviour is otherwise identical to
-- supabase/add-viewer-access.sql: active code -> live games + history,
-- anything else -> {"ok": false} and nothing else.
-- NOTE: the first run of this file (2026-11-08) still failed with
-- "column l.created_at does not exist" — the live live_games table was
-- created without ANY timestamp columns, so created_at is added above too,
-- and the function below no longer orders by any timestamp at all: live
-- games come back ordered by game_code, history by game_date.
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
  select exists(
    select 1 from public.viewer_codes where code = p_code and active
  ) into v_ok;
  if not v_ok then
    return jsonb_build_object('ok', false);
  end if;
  select coalesce(jsonb_agg(row_to_json(l) order by l.game_code), '[]'::jsonb)
    into v_lives
  from (
    select id, game_code, version, phase, state
    from public.live_games
    where phase in ('live', 'halftime')
    order by game_code
  ) l;
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

revoke all on function public.viewer_access(text) from public;
grant execute on function public.viewer_access(text) to anon, authenticated;
