-- Sub Manager — anonymous viewing through a checked code (Nov 2026).
-- Run this once in the Supabase SQL Editor on an EXISTING project
-- (for a brand-new project, run the full supabase/schema.sql instead
-- — it already includes this section). Safe to re-run: the table and
-- index are created IF NOT EXISTS, each policy is dropped (IF EXISTS)
-- before it is created, and the function is CREATE OR REPLACE, so a
-- second run does not error on duplicates.
--
-- What this adds — "lock it down": the tables stay authenticated-only.
-- Anonymous viewing goes through ONE server-side check, the SECURITY
-- DEFINER function viewer_access(code). Anon gets NO direct SELECT on
-- live_games, game_history, or team_roster — only EXECUTE on this
-- function. The function runs as the table owner, checks the code
-- against viewer_codes, and returns the live game (if one is running)
-- and the history ONLY on a match; otherwise it returns
-- {"ok": false} and nothing else.
--
-- viewer_codes: share codes the coach generates in the app
-- (Settings → Share a view link). One active code at a time: the
-- partial unique index below allows at most one active row, so
-- generating a new code deactivates the old one first (the app does
-- that). Regenerating kills the old shared link.
-- The viewer link works any time — with no live game running, the
-- viewer still sees the history.
--
-- Tradeoff, stated plainly: the code is the key, and a 4-letter code
-- is guessable — anyone who guesses the active code sees the live
-- game (including player names) and the history until the coach
-- generates a new code. That is the remaining tradeoff, and it is
-- revocable by regeneration.
-- Do NOT put the service_role key in the app — only the project URL
-- and anon key.
--
-- Defensive cleanup: if the short-lived open-RLS experiment (anon
-- SELECT on live_games / game_history, Nov 2026) was ever run in
-- this project, the drops below remove those policies. They were
-- never run in Robin's project, so these are no-ops there.

drop policy if exists "History is readable by anyone (view-only)" on public.game_history;
drop policy if exists "Live game is readable by anyone (view-only)" on public.live_games;

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

drop policy if exists "Viewer codes are readable by signed-in coaches" on public.viewer_codes;
create policy "Viewer codes are readable by signed-in coaches"
  on public.viewer_codes for select
  to authenticated
  using (true);

drop policy if exists "Signed-in coaches can create a viewer code" on public.viewer_codes;
create policy "Signed-in coaches can create a viewer code"
  on public.viewer_codes for insert
  to authenticated
  with check (true);

drop policy if exists "Signed-in coaches can update a viewer code" on public.viewer_codes;
create policy "Signed-in coaches can update a viewer code"
  on public.viewer_codes for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Signed-in coaches can delete a viewer code" on public.viewer_codes;
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
  -- Ordered by game_code, never by a timestamp: the live table was
  -- once created without ANY timestamp columns, and ordering by one
  -- made the whole check error (see add-missing-columns.sql).
  select coalesce(jsonb_agg(row_to_json(l) order by l.game_code), '[]'::jsonb)
    into v_lives
  from (
    select id, game_code, version, phase, state
    from public.live_games
    where phase in ('live', 'halftime')
    order by game_code
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
