/* Sub Manager (shared) — Supabase config.
   Fill in the two values below to turn the backend on (history + live game).
   These are the PUBLIC anon (publishable) key and project URL — safe to
   ship in the page, and the only values the app needs.
   NEVER put the service_role (secret) key here.
   Where to get them: Supabase dashboard → your project → Settings → API
   → Project URL and anon / publishable key. Run supabase/schema.sql in
   the SQL Editor first, and enable Realtime for the live_games table.
   With both values empty, the app works exactly as before: in-memory
   only, history for the current page session, no backend calls. */
window.SSM_SUPABASE = {
  url: 'https://pubupcoceduhcgstnhld.supabase.co',
  anonKey: 'sb_publishable_LXqBCQsJF4UTheCkPzoZKg_w3Ukci93'
};
