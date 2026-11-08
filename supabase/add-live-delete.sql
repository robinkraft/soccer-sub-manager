-- Portable Sub Manager — allow signed-in coaches to shut down a live game.
-- Run ONCE in the Supabase SQL Editor on a project that already has
-- live_games. Safe to re-run: the policy is dropped (IF EXISTS)
-- before it is created.
-- Adds an authenticated-only DELETE policy on live_games, so the live
-- screen's "Shut down game" can remove the live row. The game is NOT
-- saved to history — different from End game, which finishes and
-- saves. Anonymous viewers get nothing: no direct table access, and
-- the app never shows them the control.

drop policy if exists "Signed-in coaches can shut down a live game" on public.live_games;
create policy "Signed-in coaches can shut down a live game"
  on public.live_games for delete
  to authenticated
  using (true);
