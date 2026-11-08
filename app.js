/* Soccer Substitution Manager — portable source.
   Clean implementation of the PRIVATE app (artifact
   soccer-substitution-manager-2), not the shared one: same screens,
   order, labels, controls, and rules, with Supabase replacing the
   private app's server persistence (SQLite snapshot) and Supabase
   Auth replacing its owner session. Vanilla JS, no build step.
   Optional Supabase backend (see supabase-config.js): when
   configured, finished games are saved to the game_history table
   and the live game syncs via the live_games table (one driver,
   other phone view-only). When not configured — or when the CDN /
   Supabase is unreachable — the app falls back to in-memory
   behaviour: reload starts fresh.
   Browser storage rule (Robin's correction, 2026-11-07): game and
   history data are NEVER stored in browser storage — no sessionStorage,
   localStorage, IndexedDB, or cookies for game state, history, roster,
   or the preferred starting lineup (all in-memory only, lost on reload).
   The ONE exception is the Supabase Auth session itself: the Supabase
   client stores its session token in localStorage by default, and
   Sign out clears it. That is what lets a coach stay signed in across
   reloads. The per-tab writer id is generated in memory on page load;
   the live game code is a 4-letter code the driver shares and the other coach types in on setup.
   Fictional 13-player sample roster only. Never a real roster. */
'use strict';

/* ---------- Constants ---------- */
const POSITIONS = ['GK','RB','LB','RM','CM','LM','ST'];
/* Fictional sample roster ONLY — this is the fallback shown when no
   saved roster exists in Supabase (or Supabase is not configured).
   The real team roster lives in the Supabase `team_roster` table
   (authenticated-only, loaded after sign-in) and must never be
   hardcoded here. Position patterns are generic: one GK-only player
   (Ethan), one wing-only player (Noah), a GK-capable player (Sofia),
   two ST/RM/LM players (Maya, Lucas), and the rest all-rounders. */
const DEFAULT_ROSTER = [
  {name:'Mia',    prefs:['ST','RM','CM','LM','RB','LB']},
  {name:'Liam',   prefs:['ST','RM','CM','LM','RB','LB']},
  {name:'Sofia',  prefs:['ST','RM','LM','GK']},
  {name:'Noah',   prefs:['RM','LM']},
  {name:'Ava',    prefs:['ST','RM','LM','RB','LB']},
  {name:'Mateo',  prefs:['ST','RM','LM','RB','LB']},
  {name:'Chloe',  prefs:['ST','RM','CM','LM','RB','LB']},
  {name:'Ethan',  prefs:['GK']},
  {name:'Maya',   prefs:['ST','RM','LM']},
  {name:'Lucas',  prefs:['ST','RM','LM']},
  {name:'Zoe',    prefs:['ST','RM','LM','RB','LB']},
  {name:'Oliver', prefs:['ST','RM','CM','LM','RB','LB']},
  {name:'Grace',  prefs:['GK','RB','LB','RM','CM','LM','ST']},
];
const TEAM_DEFAULT = 'Sample Team';

function cloneRoster(src){
  return (src||DEFAULT_ROSTER).map(p=>({
    name:p.name, prefs:[...p.prefs], present:true, tired:false, note:'',
  }));
}
function fmtClock(sec){
  sec=Math.max(0,Math.round(sec));
  return String(Math.floor(sec/60)).padStart(2,'0')+':'+String(sec%60).padStart(2,'0');
}
function fmtMin(sec){ return (sec/60).toFixed(1); }
function esc(s){ return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function $(sel,root){ return (root||document).querySelector(sel); }
function shuffle(a){ const x=[...a]; for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]];} return x; }

/* ---------- State (in-memory only) ---------- */
let S = freshState();
function freshState(){
  const roster = cloneRoster(); // fictional sample roster (see DEFAULT_ROSTER)
  const n = roster.length;
  return {
    screen:'setup',            // setup | review | live | halftime | finished
    setupTab:'lineup',         // lineup | roster | settings | history (setup tabs, private app)
    liveTab:'actions',         // actions | minutes | team (live tabs; the Positions tab was dropped Nov 2026 — prefs are edited on the setup Roster tab, and the Team tab rows already show each player's prefs)
    expandedHistory:{},        // history index -> true when its Details card is open
    planCount:1,               // halftime "Lineup N" counter
    teamName:TEAM_DEFAULT,
    settings:{matchMinutes:50, cadence:5, subsPerRotation:2, fairTimeThreshold:5, countGoalieTime:false},
    roster,
    lineup:[null,null,null,null,null,null,null], // roster index per position, or null
    removedPositions:[],       // position indices removed by Play short (6v7)
    shortMode:false,
    // live game
    elapsed:0, running:false, ourScore:0, theirScore:0,
    minutesSec:Array(n).fill(0),   // total field seconds (all positions)
    gkSec:Array(n).fill(0),
    posSec:Array.from({length:n},()=>({})), // player -> {pos: seconds}
    goals:[],                  // {player:-1|index, seconds:number|null, side:'us'|'them'}
    queue:[],                  // {out,in,pos}
    swapPair:[],               // [posA,posB] staged swap
    selection:null,            // {kind:'out'|'in', player, pos} pending sub selection
    undoStack:[],
    history:[],                // completed games: from Supabase when configured, else this session only
    startingLineup:null,       // lineup at kickoff of the current game (for the history row)
    lastLineup:null,           // starting lineup of last completed game
    preferredLineup:null,      // persisted in Supabase team_roster.preferred_lineup; loaded after sign-in
    plannedLineup:null,        // halftime plan
    editingLive:false,         // true while the setup screen is being used as the mid-game Edit lineup editor
    halftimeDone:false,
    error:'',
  };
}
/* No browser storage is used for game/history data anywhere in this
   app (no sessionStorage, localStorage, IndexedDB, or cookies for
   game state, history, roster, or the preferred lineup). The roster
   and the preferred lineup live in Supabase (team_roster) and are
   loaded after sign-in. The ONE exception is the Supabase Auth
   session: the Supabase client stores it in localStorage by default (see
   initBackend) and Sign out clears it — that is what keeps a coach
   signed in across reloads. */

/* ---------- Supabase backend (optional) ---------- */
/* History + live game, one driver / other view-only.
   - Config comes from supabase-config.js (window.SSM_SUPABASE, url +
     anon key only — never the service_role key). Empty config, a
     blocked CDN, or an unreachable project => SB.configured stays
     false and the app behaves exactly as before (in-memory only).
   - Auth session: the Supabase client uses its DEFAULT persistence
     (localStorage) for the auth session token only — deliberately, so
     a coach stays signed in across reloads until Sign out clears it.
     This is the one exception to the no-browser-storage rule, which
     covers game/history data, not the auth token (Robin's correction).
     Do NOT switch this back to persistSession:false / an in-memory
     adapter: that would force a sign-in on every reload.
   - Writer id is generated in memory per page load.
   - The clock is stored as an anchor (elapsed at anchor + anchor
     start time + running), never written every second. */
const WRITER_ID = 'w-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const SB = {
  client: null, configured: false, backendError: '',
  online: (typeof navigator !== 'undefined' ? navigator.onLine !== false : true),
  historyLoaded: false, historyError: '',
  liveId: null, liveCode: null, liveVersion: 0, role: null, // 'driver' | 'viewer' | null
  channel: null, syncTimer: null, offline: false,
  viewerAnchor: null, // {elapsedAtAnchor, anchorStartedAt, running} from the driver
  applyingRemote: false,
  suppressSyncOnce: false,
  // Set when a remote update was just applied: the render that
  // follows must NOT schedule a sync of the applied state back —
  // otherwise two drivers would bounce the same version back and
  // forth forever. Consumed (and cleared) by render().
  // Viewer mode (anonymous watching via viewer_access): joined with a
  // viewer code, not a game code. Polls the function (anon has no
  // Realtime on live_games) instead of subscribing.
  viewerMode: false, viewerTimer: null, viewerHistoryJson: '', viewerJoinedCode: '',
  viewerLives: [], // live games returned by viewer_access for this code
  // Share code the coach generated (Settings → Share a view link).
  viewerCode: '', viewerCodeLoaded: false, viewerCodeLoading: false,
  // Active live games, for the "there's a live game" note on setup:
  // loaded once per sign-in (coaches only), never for viewers.
  activeGames: [], activeGamesLoaded: false, activeGamesLoading: false,
  authUser: null, authChecked: false, authError: '', authListener: null,
  authLastEmail: '', // in-memory only, pre-fills the login email after a failed attempt
  // Team roster (Supabase team_roster, authenticated-only).
  rosterRowId: null,      // id of the single team_roster row, once loaded/saved
  rosterLoaded: false,    // true once a saved roster was loaded from Supabase
  rosterFromBackend: false,
  rosterFromLive: false,  // true when the current roster came from a live game — do not auto-save it
  rosterError: '',
};
function initBackend() {
  const cfg = (typeof window !== 'undefined' && window.SSM_SUPABASE) ? window.SSM_SUPABASE : null;
  if (!cfg || !cfg.url || !cfg.anonKey) { SB.configured = false; return; }
  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    SB.configured = false;
    SB.backendError = 'Could not connect — changes are saved on this device only.';
    return;
  }
  try {
    // Default auth persistence (localStorage) for the session token
    // only — see the header comment. No storage option is passed, so
    // the client persists the session and refreshes it automatically.
    // detectSessionInUrl stays off: sign-in is email + password here,
    // not a magic-link redirect.
    SB.client = window.supabase.createClient(cfg.url, cfg.anonKey, {
      auth: { detectSessionInUrl: false },
    });
    SB.configured = true;
  } catch (e) {
    SB.configured = false;
    SB.backendError = 'Could not connect — changes are saved on this device only.';
  }
}

/* ---------- Supabase Auth (login-required for coaches) ---------- */
/* Email + password, gated before any history/roster/live-driving
   access. RLS on game_history and team_roster is authenticated-only,
   and live_games writes are authenticated-only too — so the anon key
   alone gets nothing there. The ONE exception: watching a live game.
   live_games has an anon SELECT policy (see supabase/schema.sql and
   supabase/add-anon-live-view.sql), so anyone with the 4-letter game
   code can join as a view-only watcher WITHOUT signing in — they see
   the live field, bench, score and clock from the live snapshot, and
   nothing else. Coach accounts are created by Robin in the Supabase
   dashboard (Authentication → Users → Add user); the app never
   creates users and never needs a service_role key.
   Session: stored by the Supabase client in localStorage by default
   and cleared on Sign out — a coach stays signed in across reloads.
   Game/history data is never stored in browser storage. */
async function checkAuthSession() {
  if (!SB.configured || !SB.client) { SB.authChecked = true; return null; }
  try {
    const { data, error } = await SB.client.auth.getSession();
    if (error) throw error;
    SB.authUser = data && data.session ? data.session.user : null;
    SB.authError = '';
  } catch (e) {
    SB.authUser = null;
    SB.authError = 'Could not check your sign-in — try signing in again.';
  }
  SB.authChecked = true;
  // Keep SB.authUser in step if the session changes (e.g. token
  // refresh, sign-out in another tab). The listener is installed once.
  if (!SB.authListener && SB.client.auth.onAuthStateChange) {
    const { data } = SB.client.auth.onAuthStateChange((event, session) => {
      SB.authUser = session ? session.user : null;
      if (event === 'SIGNED_OUT') {
        resetLiveSession();
        S = freshState();
        SB.historyLoaded = false;
        SB.rosterRowId = null; SB.rosterLoaded = false; SB.rosterFromBackend = false;
        SB.rosterFromLive = false; SB.rosterError = '';
        render();
      }
    });
    SB.authListener = data ? data.subscription : true;
  }
  return SB.authUser;
}
function authGated() {
  // Login screen applies only when Supabase is configured. Without a
  // config the app is in-memory only, exactly as before, with no login.
  return SB.configured && SB.authChecked && !SB.authUser;
}
function loginHtml() {
  const err = SB.authError ? '<div class="error" role="alert">' + esc(SB.authError) + '</div>' : '';
  // The email is kept in memory only (SB.authLastEmail) so a failed
  // sign-in does not make the coach retype it — only the password.
  const emailVal = SB.authLastEmail ? ' value="' + esc(SB.authLastEmail) + '"' : '';
  return '<section aria-label="Sign in"><h2>Sign in to Sub Manager</h2>'
    + '<p class="muted">Coaches only — sign in to see history, the roster, and drive a game. Watching a live game needs no sign-in: enter its code above.</p>'
    + err
    + '<div class="card"><label for="auth-email">Email</label>'
    + '<input type="email" id="auth-email" autocomplete="email" placeholder="you@example.com"' + emailVal + '>'
    + '<p><label for="auth-password">Password</label>'
    + '<input type="password" id="auth-password" autocomplete="current-password" placeholder="Password"></p>'
    + '<div class="row"><button class="primary grow" data-signin>Sign in</button></div></div>'
    + '<p class="muted small">You stay signed in on this device until you sign out.</p></section>';
}
/* Entry screen for anyone not signed in: join a live game with its
   code (no account needed, view-only) or sign in as a coach. */
function entryHtml() {
  // Errors are shown here too: the login-gate early return in
  // render() skips the error line, so a wrong view code (or a
  // failed load) on this screen used to show nothing at all.
  const err = S.error ? '<div class="error" role="alert">' + esc(S.error) + '</div>' : '';
  S.error = '';
  return '<section aria-label="Watch or sign in"><h2>Watch a live game</h2>' + err
    + '<div class="card"><h3>Join a shared view</h3><p class="muted">Enter the 4-letter view code from the coach\u2019s shared link. No account needed — you watch live and see history, view-only.</p>'
    + '<div class="row"><input type="text" id="join-code" placeholder="View code" maxlength="4" autocapitalize="characters" autocomplete="off" style="width:110px;text-transform:uppercase"><button class="primary" data-join-viewer>Watch</button></div></div>'
    + loginHtml()
    + '</section>';
}
async function signInWithPassword(email, password) {
  if (!SB.configured || !SB.client) return false;
  SB.authError = '';
  SB.authLastEmail = email; // in-memory only, so a retry keeps the email
  try {
    const { data, error } = await SB.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    SB.authUser = data && data.user ? data.user : (data && data.session ? data.session.user : null);
    if (!SB.authUser) throw new Error('Sign-in did not return a user — try again.');
    return true;
  } catch (e) {
    SB.authUser = null;
    const msg = String((e && e.message) || e || '');
    SB.authError = /invalid login|invalid.*credentials/i.test(msg)
      ? 'Wrong email or password — check them and try again.'
      : ('Sign-in failed: ' + msg);
    render();
    return false;
  }
}
async function signOutUser() {
  try { if (SB.client) await SB.client.auth.signOut(); } catch (e) { /* fall through to local clear */ }
  SB.authUser = null; SB.authError = '';
  resetLiveSession();
  S = freshState();
  SB.historyLoaded = false; SB.historyError = '';
  SB.rosterRowId = null; SB.rosterLoaded = false; SB.rosterFromBackend = false;
  SB.rosterFromLive = false; SB.rosterError = '';
  render();
}

/* ---------- Team roster in Supabase (team_roster) ---------- */
/* The roster lives in Supabase, not in the code. After sign-in the app
   loads the single team_roster row (team_name + players [{name, prefs}])
   and uses it instead of the fictional sample roster. RLS on
   team_roster is authenticated-only, so the anon key alone gets
   nothing. If no row exists yet — or Supabase is not configured — the
   app falls back to the fictional sample roster in DEFAULT_ROSTER and
   says so on the Setup screen. A roster from a live game is adopted
   for that session only and is NEVER auto-saved; the coach saves it
   explicitly with "Save roster". Notes are per-player
   private reminders and are not stored in team_roster. */
function resizeMinuteArrays() {
  const n = S.roster.length;
  S.minutesSec = padArr(S.minutesSec, n, 0);
  S.gkSec = padArr(S.gkSec, n, 0);
  S.posSec = Array.from({ length: n }, (_, i) => (S.posSec && S.posSec[i]) ? { ...S.posSec[i] } : {});
  S.lineup = S.lineup.map(x => (x == null || x < n) ? x : null);
}
function rosterSourceLabel() {
  if (SB.rosterFromLive) return 'Roster from the live game — not saved yet. Use “Save roster” below to keep it.';
  return '';
}
async function loadRoster() {
  SB.rosterLoaded = false; SB.rosterError = ''; SB.rosterRowId = null;
  SB.rosterFromBackend = false; SB.rosterFromLive = false;
  if (!SB.configured || !SB.client || !SB.authUser) return false;
  try {
    const { data, error } = await SB.client.from('team_roster')
      .select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) return false;
    SB.rosterRowId = data.id; // keep the row id even if its player list is empty, so a later save updates it instead of inserting a second row
    if (!Array.isArray(data.players) || !data.players.length) return false;
    const players = data.players
      .filter(p => p && typeof p.name === 'string' && p.name.trim())
      .map(p => ({
        name: p.name.trim(),
        prefs: Array.isArray(p.prefs) ? p.prefs.filter(x => POSITIONS.includes(x)) : [],
        note: typeof p.note === 'string' ? p.note : '',
      }));
    if (!players.length) return false;
    S.teamName = (data.team_name && String(data.team_name).trim()) || TEAM_DEFAULT;
    S.roster = players.map(p => ({
      name: p.name, prefs: p.prefs.length ? p.prefs : ['ST', 'RM', 'LM'],
      present: true, tired: false, note: p.note || '',
    }));
    // Preferred lineup persists with the roster (private app: server
    // persistence). Stored as roster indices in position order.
    if (Array.isArray(data.preferred_lineup) && data.preferred_lineup.length === 7) {
      S.preferredLineup = data.preferred_lineup.map(x => x == null ? null : x);
    }
    resizeMinuteArrays();
    SB.rosterRowId = data.id; SB.rosterLoaded = true; SB.rosterFromBackend = true;
    return true;
  } catch (e) {
    SB.rosterError = 'Roster could not be loaded.';
    return false;
  }
}
async function saveRosterToBackend() {
  if (!SB.configured || !SB.client || !SB.authUser) return false;
  if (SB.role === 'viewer' && SB.liveId) return false; // view-only never writes
  const payload = {
    team_name: S.teamName,
    // Notes persist with the roster (private app behaviour) but are
    // private and are never shared.
    players: S.roster.map(r => ({ name: r.name, prefs: [...r.prefs], note: r.note || '' })),
    preferred_lineup: (S.preferredLineup || []).map(x => x == null ? null : x),
    updated_at: new Date().toISOString(),
  };
  try {
    if (SB.rosterRowId) {
      const { error } = await SB.client.from('team_roster').update(payload).eq('id', SB.rosterRowId);
      if (error) throw error;
    } else {
      const { data, error } = await SB.client.from('team_roster').insert(payload).select('id').single();
      if (error) throw error;
      SB.rosterRowId = data.id;
    }
    SB.rosterFromBackend = true; SB.rosterFromLive = false; SB.rosterLoaded = true;
    SB.rosterError = '';
    return true;
  } catch (e) {
    SB.rosterError = 'Roster could not be saved — changes are for this session only.';
    render();
    return false;
  }
}
/* Auto-save after an explicit roster edit (rename / add / remove /
   position-prefs change). Never auto-saves a link-imported roster, and
   never fires on page load — loading a roster does not write one. */
async function saveRosterAuto() {
  if (SB.rosterFromLive) return;
  await saveRosterToBackend();
}
function padArr(arr, n, fill) {
  const out = Array.isArray(arr) ? [...arr] : [];
  while (out.length < n) out.push(fill);
  return out.slice(0, n);
}
function genGameCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I/O/0/1 — readable over the phone
  let code = '';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
/* --- History mapping: internal game <-> game_history row (schema.sql) --- */
/* Backend players store minutes (not seconds): total_minutes is the
   counted total (goalie-adjusted per the setting), goalie_minutes
   separately, minutes_by_position in minutes. Goals store side too
   ('us'/'them') — the JSONB column accepts the extra field, so no
   schema change was needed for it. */
function backendPlayersFromGame(h) {
  return (h.players || []).map((p, i) => ({
    name: p.name, roster_index: i, present: !!p.present,
    total_minutes: +((p.seconds || 0) / 60).toFixed(2),
    goalie_minutes: +((p.gkSeconds || 0) / 60).toFixed(2),
    goals: p.goals || 0,
    minutes_by_position: Object.fromEntries(
      Object.entries(p.posSeconds || {}).map(([k, v]) => [k, +(v / 60).toFixed(2)])),
  }));
}
function backendGoalsFromGame(h) {
  // Scorer is stored by NAME as well as index, so a saved game never
  // depends on roster order: the name is what the History screen
  // resolves against on load. The index is into the game's own
  // players list (h.players), not the current roster. player null =
  // unknown scorer (recorded, attributed to nobody).
  return (h.goals || []).map(g => ({
    player_index: g.player == null ? null : g.player,
    player_name: g.player === -1 ? 'Own goal'
      : g.player == null ? null
      : (g.player_name || ((h.players || [])[g.player] ? h.players[g.player].name : (S.roster[g.player] ? S.roster[g.player].name : null))),
    seconds: g.seconds == null ? null : g.seconds,
    side: g.side || 'us',
  }));
}
function internalGameFromRow(row) {
  const players = (row.players || []).map(p => ({
    name: p.name, present: !!p.present,
    seconds: (p.total_minutes || 0) * 60,
    gkSeconds: (p.goalie_minutes || 0) * 60,
    goals: p.goals || 0,
    posSeconds: Object.fromEntries(
      Object.entries(p.minutes_by_position || {}).map(([k, v]) => [k, v * 60])),
  }));
  // Scorer resolution is NAME-first, never roster-order dependent:
  // a stored player_name is matched against the game's own players
  // list; player_index is only a fallback for old rows with no name.
  // player null = unknown scorer (recorded, attributed to nobody).
  const goals = (row.goals || []).map(g => {
    let player = null;
    let name = (g.player_name && g.player_name !== 'Own goal') ? g.player_name : null;
    if (g.player_index === -1) { player = -1; name = 'Own goal'; }
    else if (name) {
      const idx = (row.players || []).findIndex(p => p.name === name);
      if (idx !== -1) player = idx;
    }
    if (player == null && typeof g.player_index === 'number' && g.player_index >= 0 && (row.players || [])[g.player_index]) {
      player = g.player_index;
      if (!name) name = row.players[g.player_index].name;
    }
    return { player, player_name: name, seconds: g.seconds == null ? null : g.seconds, side: g.side || 'us' };
  });
  let date = '';
  try { date = row.game_date ? new Date(row.game_date + 'T12:00:00').toLocaleDateString() : new Date(row.created_at).toLocaleDateString(); } catch (e) { date = row.game_date || ''; }
  return {
    backendId: row.id, date, dateISO: row.game_date || '', teamName: row.team_name,
    ourScore: row.our_score, theirScore: row.their_score,
    playedSeconds: row.elapsed_seconds || 0,
    lineup: (row.starting_lineup || []).map(x => x == null ? null : x),
    players, goals, matchMinutes: row.match_minutes,
  };
}
async function loadHistory() {
  if (!SB.configured) return;
  try {
    const { data, error } = await SB.client.from('game_history')
      .select('*').order('game_date', { ascending: false }).order('created_at', { ascending: false });
    if (error) throw error;
    // Backend is the source of truth for history once configured; the
    // in-memory session games are kept only if they were never saved
    // (backendPending) — they are appended below the backend rows.
    const pending = S.history.filter(h => h.backendPending && !h.backendId);
    S.history = (data || []).map(internalGameFromRow).concat(pending);
    // "Use last game's lineup" must work after a reload too (private
    // app): the newest saved game's starting lineup, mapped back to
    // the current roster by player name.
    if (S.history.length && S.history[0].lineup) {
      const byName = new Map(S.roster.map((r, i) => [r.name, i]));
      const mapped = S.history[0].lineup.map(x => {
        if (x == null) return null;
        const p = S.history[0].players[x];
        if (!p) return null;
        const idx = byName.get(p.name);
        return (idx != null && S.roster[idx].present) ? idx : null;
      });
      if (mapped.some(x => x != null)) S.lastLineup = mapped;
    }
    SB.historyLoaded = true; SB.historyError = '';
    render();
  } catch (e) {
    SB.historyError = 'History could not be loaded — showing this session only.';
  }
}
async function saveHistoryGame(game) {
  if (!SB.configured) return;
  try {
    const row = {
      game_date: new Date().toISOString().slice(0, 10),
      team_name: game.teamName, match_minutes: S.settings.matchMinutes,
      elapsed_seconds: Math.round(S.elapsed),
      our_score: game.ourScore, their_score: game.theirScore,
      players: backendPlayersFromGame(game), goals: backendGoalsFromGame(game),
      starting_lineup: (game.lineup || []).map(x => x == null ? null : x),
    };
    const { data, error } = await SB.client.from('game_history').insert(row).select('id').single();
    if (error) throw error;
    game.backendId = data.id; game.backendPending = false;
  } catch (e) {
    game.backendPending = true;
    SB.historyError = 'Game saved on this device only — download the CSV as a backup.';
    render();
  }
}
async function discardHistoryGame(h) {
  if (!h) return;
  S.history = S.history.filter(x => x !== h);
  if (SB.configured && h.backendId) {
    try {
      const { error } = await SB.client.from('game_history').delete().eq('id', h.backendId);
      if (error) throw error;
    } catch (e) {
      SB.historyError = 'Game removed here, but the delete did not go through — it may reappear on reload.';
      render();
    }
  }
}
async function syncHistoryGame(h) {
  if (!SB.configured || !h || !h.backendId) return;
  try {
    // Recompute per-player goal counts from the (edited) goal list.
    h.players.forEach((p, i) => { p.goals = h.goals.filter(g => g.player === i).length; });
    const { error } = await SB.client.from('game_history').update({
      goals: backendGoalsFromGame(h), players: backendPlayersFromGame(h),
    }).eq('id', h.backendId);
    if (error) throw error;
  } catch (e) {
    SB.historyError = 'Goal edit saved on this device only.';
    render();
  }
}

/* --- Live game mapping: whole state <-> live_games.state (schema.sql) --- */
function buildLiveState() {
  return {
    teamName: S.teamName, settings: { ...S.settings },
    roster: S.roster.map(r => ({ name: r.name, prefs: [...r.prefs], present: r.present, tired: r.tired, note: r.note || '' })),
    lineup: [...S.lineup], removedPositions: [...S.removedPositions], shortMode: S.shortMode,
    elapsed: S.elapsed, running: S.running,
    clock: { elapsed_seconds_at_anchor: S.elapsed, anchor_started_at: S.running ? Date.now() : null, running: S.running },
    ourScore: S.ourScore, theirScore: S.theirScore,
    minutesSec: [...S.minutesSec], gkSec: [...S.gkSec],
    posSec: JSON.parse(JSON.stringify(S.posSec)),
    goals: S.goals.map(g => ({ ...g })), queue: S.queue.map(q => ({ ...q })), swapPair: [...S.swapPair],
    plannedLineup: S.plannedLineup ? [...S.plannedLineup] : null,
    halftimeDone: S.halftimeDone,
    startingLineup: S.startingLineup ? [...S.startingLineup] : null,
  };
}
function applyLiveState(st) {
  if (!st || typeof st !== 'object') return;
  SB.applyingRemote = true;
  try {
    if (st.teamName) S.teamName = st.teamName;
    if (st.settings) S.settings = { ...S.settings, ...st.settings };
    if (Array.isArray(st.roster) && st.roster.length) {
      S.roster = st.roster.map(r => ({ name: r.name, prefs: [...(r.prefs || [])], present: !!r.present, tired: !!r.tired, note: r.note || '' }));
    }
    const n = S.roster.length;
    if (Array.isArray(st.lineup)) S.lineup = padArr(dedupeLineup(st.lineup.map(x => x == null ? null : x)), 7, null);
    S.removedPositions = Array.isArray(st.removedPositions) ? [...st.removedPositions] : [];
    S.shortMode = !!st.shortMode;
    if (typeof st.ourScore === 'number') S.ourScore = st.ourScore;
    if (typeof st.theirScore === 'number') S.theirScore = st.theirScore;
    S.minutesSec = padArr(st.minutesSec, n, 0);
    S.gkSec = padArr(st.gkSec, n, 0);
    S.posSec = Array.from({ length: n }, (_, i) => (st.posSec && st.posSec[i]) ? { ...st.posSec[i] } : {});
    S.goals = Array.isArray(st.goals) ? st.goals.map(g => ({ ...g })) : [];
    S.queue = Array.isArray(st.queue) ? st.queue.map(q => ({ ...q })) : [];
    S.swapPair = []; S.selection = null;
    S.plannedLineup = Array.isArray(st.plannedLineup) ? [...st.plannedLineup] : null;
    S.halftimeDone = !!st.halftimeDone;
    S.startingLineup = Array.isArray(st.startingLineup) ? [...st.startingLineup] : null;
    // Clock anchor: while running, elapsed advances in real time from the anchor.
    const clock = st.clock || {};
    if (clock.running && clock.anchor_started_at) {
      SB.viewerAnchor = { elapsedAtAnchor: clock.elapsed_seconds_at_anchor || 0, anchorStartedAt: clock.anchor_started_at, running: true };
      S.elapsed = SB.viewerAnchor.elapsedAtAnchor + (Date.now() - SB.viewerAnchor.anchorStartedAt) / 1000;
      S.running = true;
    } else {
      SB.viewerAnchor = { elapsedAtAnchor: clock.elapsed_seconds_at_anchor != null ? clock.elapsed_seconds_at_anchor : (st.elapsed || 0), anchorStartedAt: null, running: false };
      S.elapsed = SB.viewerAnchor.elapsedAtAnchor;
      S.running = false;
    }
  } finally {
    SB.applyingRemote = false;
  }
}
function livePhase() {
  return S.screen === 'halftime' ? 'halftime' : (S.screen === 'finished' ? 'finished' : 'live');
}
async function fetchLiveRow() {
  if (!SB.configured || !SB.liveCode) return null;
  const { data, error } = await SB.client.from('live_games').select('*').eq('game_code', SB.liveCode).maybeSingle();
  if (error || !data) return null;
  return data;
}
function subscribeLive() {
  if (!SB.configured || !SB.liveCode || !SB.client) return;
  try {
    if (SB.channel) { SB.client.removeChannel(SB.channel); SB.channel = null; }
    SB.channel = SB.client.channel('live-' + SB.liveCode)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'live_games', filter: 'game_code=eq.' + SB.liveCode },
        payload => { if (payload && payload.new) handleRemoteLive(payload.new); })
      // DELETE: a coach shutting the game down removes the row. No
      // filter here — under default replica identity a deleted row
      // only carries its PK, so a game_code filter would never match;
      // match on the old id instead (see handleLiveDeleted).
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'live_games' },
        payload => { if (payload && payload.old && payload.old.id) handleLiveDeleted(payload.old.id); })
      .subscribe();
  } catch (e) { /* Realtime unavailable — the app still works in-memory; re-fetch on actions. */ }
}
function unsubscribeLive() {
  if (SB.channel && SB.client) { try { SB.client.removeChannel(SB.channel); } catch (e) {} SB.channel = null; }
}
function handleRemoteLive(row) {
  if (!row || row.last_writer_id === WRITER_ID) return; // ignore our own echo
  if (row.version < SB.liveVersion) return; // stale delivery, ignore it
  // Live at all times: a new version applies immediately, no banner,
  // no reload tap. Writer identity is per session — WRITER_ID is
  // random per page load — so Robin signed in on two devices is the
  // same person, not "the other coach": the note just says "Updated".
  // Any signed-in coach can drive, so there is no Take over and no
  // view-only for coaches; only anonymous viewers are view-only.
  const isNewer = row.version > SB.liveVersion;
  SB.liveVersion = row.version; SB.liveId = row.id;
  applyLiveState(row.state);
  if (row.phase === 'halftime') S.screen = 'halftime';
  else if (row.phase === 'finished') { S.screen = 'finished'; }
  else if (S.screen !== 'live') S.screen = 'live';
  if (isNewer) showToast('Updated');
  SB.suppressSyncOnce = true; // do not sync the applied state back
  render();
}
async function startLiveDriver() {
  if (!SB.configured) {
    SB.backendError = 'Live game could not be started — try again.';
    return;
  }
  const code = genGameCode();
  try {
    const { data, error } = await SB.client.from('live_games').insert({
      game_code: code, phase: 'live', version: 1,
      last_writer_id: WRITER_ID, last_writer_label: 'Driver',
      state: buildLiveState(),
    }).select('id,version').single();
    if (error) throw error;
    SB.liveId = data.id; SB.liveCode = code; SB.liveVersion = 1; SB.role = 'driver'; SB.offline = false;
    subscribeLive();
    await pushGameUrl(code); // deep link: this game now has its own URL (resolves the view code first)
  } catch (e) {
    SB.backendError = 'Live game could not be started — try again.';
  }
}
async function joinLiveGame(code, opts) {
  // Signed-in coach joining by game code. ANY signed-in coach can
  // drive — there is no Take over and no view-only for coaches
  // (Robin's call, Nov 2026): whoever started the game, however many
  // coach sessions are open, they all edit the same live game, last
  // write wins with the version check in doLiveSync.
  if (!SB.configured) { S.error = 'Live games need Supabase — try again later.'; render(); return false; }
  if (!SB.authUser) { S.error = 'Sign in as a coach to join a live game with its game code.'; render(); return false; }
  try {
    const { data, error } = await SB.client.from('live_games').select('*').eq('game_code', code).maybeSingle();
    if (error) throw error;
    if (!data) { S.error = 'Live game ' + code + ' was not found — check the code.'; render(); return false; }
    SB.liveId = data.id; SB.liveCode = code; SB.liveVersion = data.version; SB.role = 'driver'; SB.offline = false;
    SB.viewerMode = false;
    applyLiveState(data.state);
    // The roster here came from the live game, not from team_roster
    // — do not auto-save it. The explicit "Save roster" button still
    // works if the coach wants to keep it.
    SB.rosterFromLive = true; SB.rosterFromBackend = false;
    if (data.phase === 'halftime') S.screen = 'halftime';
    else if (data.phase === 'finished') S.screen = 'finished';
    else S.screen = 'live';
    S.liveTab = 'actions';
    subscribeLive();
    // Deep link: the URL now names this game, so a reload re-opens
    // it. Routing (popstate / first load) passes {push:false} — the
    // URL is already the destination, so nothing is pushed.
    if (!opts || opts.push !== false) await pushGameUrl(code);
    render();
    return true;
  } catch (e) {
    S.error = 'Could not load live game.';
    render();
    return false;
  }
}
/* ---------- Anonymous viewing via viewer_access (locked down) ---------- */
/* A viewer code (from viewer_codes, generated by a coach in Settings)
   is checked SERVER-SIDE by the SECURITY DEFINER function
   viewer_access(code): it returns the running live games (if any) and
   the history only on a match, otherwise {"ok": false}. Anon gets no
   direct table reads at all. The link works any time — with no live
   game running, the viewer still sees the history. An anonymous
   watcher lands on the shared-view home, which lists the live games
   with a Join button each, and can share the view onward (Share
   copies the same link — viewers never generate or revoke codes).
   Anon viewers poll the function (no Realtime for anon); a signed-in
   coach who opens a viewer link drives like any coach (see below). */
async function joinViewerCode(code) {
  if (!SB.configured) { S.error = 'Viewing needs Supabase — try again later.'; render(); return false; }
  code = (code || '').trim().toUpperCase();
  if (!code) { S.error = 'Enter the 4-letter view code first.'; render(); return false; }
  try {
    const { data, error } = await SB.client.rpc('viewer_access', { p_code: code });
    if (error) throw error;
    if (!data || !data.ok) { S.error = 'That view code was not found — check the code.'; render(); return false; }
    SB.viewerMode = true; SB.viewerJoinedCode = code;
    applyViewerAccess(data);
    return true;
  } catch (e) {
    S.error = 'Could not load the shared view.';
    render();
    return false;
  }
}
function applyViewerAccess(data) {
  // data: {ok, live: {...} | null, lives: [{id, game_code, version,
  // phase, state}], history: [rows]} — lives is the whole list of
  // running games; live is just the first, kept for compatibility.
  const lives = Array.isArray(data.lives) ? data.lives : (data.live ? [data.live] : []);
  SB.viewerLives = lives;
  if (Array.isArray(data.history)) {
    S.history = data.history.map(internalGameFromRow);
    SB.historyLoaded = true; SB.historyError = '';
    SB.viewerHistoryJson = JSON.stringify(data.history);
  }
  // A signed-in coach who opens a viewer link drives straight into
  // the live game like any coach. An anonymous watcher lands on the
  // shared-view home instead, which lists the live games with a Join
  // button — same treatment as the coach's active-game note, but
  // view-only. No live game yet: the home shows history only.
  if (SB.authUser && lives.length) {
    // A signed-in coach who opens a viewer link drives straight into
    // the live game like any coach. If the link names a game, drive
    // that one — not just the first in the list.
    let urlGame = '';
    try { urlGame = (new URLSearchParams(window.location.search).get('game') || '').trim().toUpperCase(); } catch (e) {}
    const live = (urlGame && lives.find(g => g && g.game_code === urlGame)) || lives[0];
    SB.liveId = live.id; SB.liveCode = live.game_code; SB.liveVersion = live.version;
    SB.role = 'driver';
    applyLiveState(live.state);
    SB.rosterFromLive = true; SB.rosterFromBackend = false;
    if (live.phase === 'halftime') S.screen = 'halftime';
    else S.screen = 'live';
    S.liveTab = 'actions';
    subscribeLive();
    pushGameUrl(live.game_code);
  } else {
    SB.liveId = null; SB.liveCode = null; SB.liveVersion = 0;
    SB.role = SB.authUser ? 'driver' : 'viewer';
    S.screen = 'viewer';
  }
  SB.offline = false;
  startViewerPoll();
  render();
}
// A code-joined viewer joins one of the listed live games, view-only.
// The snapshot already came through viewer_access — no new server
// read, and the code is not re-checked here: the list itself is the
// proof the code was valid. Viewers never get edit controls.
function joinViewerGame(id, opts) {
  const live = (SB.viewerLives || []).find(g => g && g.id === id);
  if (!live) { S.error = 'That live game is no longer available.'; render(); return false; }
  SB.liveId = live.id; SB.liveCode = live.game_code; SB.liveVersion = live.version;
  // Signed-in coaches drive like any coach, even when they arrived
  // on a viewer link — role 'viewer' would silently stop their
  // writes syncing (scheduleLiveSync only runs for drivers).
  SB.role = SB.authUser ? 'driver' : 'viewer';
  applyLiveState(live.state);
  SB.rosterFromLive = true; SB.rosterFromBackend = false;
  if (live.phase === 'halftime') S.screen = 'halftime';
  else S.screen = 'live';
  S.liveTab = 'actions';
  if (SB.authUser) subscribeLive(); // coaches get Realtime, not the anon poll
  // Deep link: ?view=CODE&game=CODE — pasting it joins this game.
  if (!opts || opts.push !== false) pushGameUrl(live.game_code);
  render();
  return true;
}
function startViewerPoll() {
  if (SB.viewerTimer) { clearInterval(SB.viewerTimer); SB.viewerTimer = null; }
  // Anonymous watchers poll (no Realtime for anon). Signed-in
  // coaches in viewer mode get Realtime via subscribeLive instead.
  if (!SB.viewerMode || SB.authUser) return;
  SB.viewerTimer = setInterval(() => { refreshViewer(); }, 3000);
}
async function refreshViewer() {
  if (!SB.viewerMode || SB.authUser || !SB.client) return;
  try {
    const { data, error } = await SB.client.rpc('viewer_access', { p_code: SB.viewerJoinedCode });
    if (error) throw error;
    if (!data || !data.ok) {
      // Code deactivated while watching — the link is dead.
      const msg = 'This view link is no longer active.';
      leaveLiveGame(); S.error = msg; render(); return;
    }
    const lives = Array.isArray(data.lives) ? data.lives : (data.live ? [data.live] : []);
    SB.viewerLives = lives;
    const histJson = JSON.stringify(data.history || []);
    if (histJson !== SB.viewerHistoryJson) {
      S.history = (data.history || []).map(internalGameFromRow);
      SB.historyLoaded = true; SB.viewerHistoryJson = histJson;
    }
    if (SB.liveId) {
      // Watching a game: follow it, or fall back to the home screen
      // when it ended. The home list updates from SB.viewerLives.
      const mine = lives.find(g => g && g.id === SB.liveId);
      if (!mine) {
        SB.liveId = null; SB.liveCode = null; SB.liveVersion = 0; SB.role = 'viewer';
        S.screen = 'viewer'; render();
      } else if (mine.version > SB.liveVersion) {
        // A newer live version applies immediately, with the
        // "Updated" note — same as any live update.
        handleRemoteLive({ id: mine.id, game_code: mine.game_code, version: mine.version, phase: mine.phase, state: mine.state, last_writer_id: null });
      } else {
        render(); // history may have changed above
      }
    } else {
      // On the shared-view home: a started game appears in the list
      // with a Join button — the viewer taps it, no auto-jump.
      render();
    }
  } catch (e) { /* poll failure is silent — the next poll retries */ }
}
/* Viewer home screen: the live games (if any) with a Join button
   each, then history. A started game appears here on the next poll —
   the viewer taps Join, it never auto-jumps. A viewer can also pass
   the view on: Share copies the same viewer link they arrived on
   (same code, no new code — only a coach can generate or revoke). */
function viewerHtml(){
  const lives = SB.viewerLives || [];
  const gamesHtml = lives.length
    ? lives.map(g => {
        const st = (g.state) || {};
        const score = 'US ' + (st.ourScore || 0) + ' \u2013 ' + (st.theirScore || 0) + ' THEM';
        // Stacked like the coach's active-game note: the one-line
        // row squeezed the clock off the screen edge.
        return '<div class="card"><strong>There\u2019s a live game in progress</strong>'
          + '<div class="muted">' + esc(score) + ' &middot; ' + fmtClock(activeGameElapsed(st)) + '</div>'
          + '<div class="row" style="margin-top:8px"><button class="primary grow" data-join-viewer-game="' + esc(g.id) + '">Join</button></div></div>';
      }).join('')
    : '<p class="muted">No live game right now — past games below. When the coach starts a game, it appears here live.</p>';
  return '<section aria-label="Shared view"><h2>Shared view</h2>'
    + gamesHtml
    + '<div class="row"><button data-share-viewer>Share this view</button><button data-leave-live>Leave shared view</button></div>'
    + '<h3>History</h3>' + historyHtml() + '</section>';
}
/* ---------- Share a view link (coach, Settings tab) ---------- */
/* One active viewer code at a time. Generating a new link deactivates
   the old one first, so a shared link can be killed by generating a
   new one. The link is ?view=CODE on this app's own URL, and the
   plain code is shown alongside it for reading out loud. */
function viewerLinkUrl(code){
  try { return new URL('?view=' + code, document.baseURI).href; }
  catch (e) { return '?view=' + code; }
}
function viewerShareHtml(){
  if (!SB.authUser) return '';
  // Load the current code once, when Settings first renders.
  if (!SB.viewerCodeLoaded && !SB.viewerCodeLoading) loadViewerCode();
  const code = SB.viewerCode;
  return '<div class="card"><h3>Share a view link</h3>'
    +'<p class="muted">Anyone with the link can watch live and see history — no account, no sign-in. Generating a new link turns off the old one.</p>'
    +(code
      ? '<p>Current code: <strong>' + esc(code) + '</strong></p><p class="muted small">' + esc(viewerLinkUrl(code)) + '</p><div class="row"><button data-copy-viewer-link>Copy viewer link</button><button data-gen-viewer-link>Generate new link</button></div>'
      : '<p class="muted">' + (SB.viewerCodeLoaded ? 'No view link yet.' : 'Loading…') + '</p><div class="row"><button data-gen-viewer-link>Generate view link</button></div>')
    +'</div>';
}
async function loadViewerCode(){
  if (!SB.configured || !SB.authUser) return;
  SB.viewerCodeLoading = true;
  await fetchViewerCode();
  SB.viewerCodeLoading = false;
  render();
}
/* The DB half of generating a view code: deactivate the old one
   (one active code at a time), insert a fresh one, return it. The
   Settings button wraps this with copy + toast; ensureViewerCode
   (deep links) calls it silently so a coach opening a game always
   has a shareable URL. */
async function createViewerCode(){
  await SB.client.from('viewer_codes').update({ active: false, updated_at: new Date().toISOString() }).eq('active', true);
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = genGameCode();
    const { error } = await SB.client.from('viewer_codes').insert({ code: candidate, active: true });
    if (!error) { SB.viewerCode = candidate; SB.viewerCodeLoaded = true; return candidate; }
  }
  throw new Error('no code generated');
}
async function generateViewerCode(){
  if (!SB.configured || !SB.authUser) return;
  try {
    const code = await createViewerCode();
    await copyText(viewerLinkUrl(code));
    showToast('Link copied');
    render();
  } catch (e) { S.error = 'Could not generate a view link — try again.'; render(); }
}
/* Quiet load of the active view code (no render): Settings uses
   loadViewerCode, which renders; deep links just need the value. */
async function fetchViewerCode(){
  if (!SB.configured || !SB.authUser) return '';
  try {
    const { data, error } = await SB.client.from('viewer_codes').select('code').eq('active', true).maybeSingle();
    if (error) throw error;
    if (data && data.code) SB.viewerCode = data.code;
    SB.viewerCodeLoaded = true;
  } catch (e) { SB.viewerCodeLoaded = true; }
  return SB.viewerCode || '';
}
/* The code a coach's game URL carries (?view=CODE&game=...). Reuses
   the team's active code; if none exists yet, generates one on the
   spot so the URL is always shareable. Never throws — without a
   code the URL just has no view param (offline / unreachable). */
async function ensureViewerCode(){
  if (SB.viewerCode) return SB.viewerCode;
  if (!SB.configured || !SB.authUser) return '';
  if (SB.viewerCodeLoading) {
    for (let i = 0; i < 20 && SB.viewerCodeLoading; i++) await new Promise(r => setTimeout(r, 50));
    if (SB.viewerCode) return SB.viewerCode;
  }
  if (!SB.viewerCodeLoaded) await fetchViewerCode();
  if (SB.viewerCode) return SB.viewerCode;
  try { return await createViewerCode(); } catch (e) { return ''; }
}
async function copyText(text){
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch (e) { /* fall through to the textarea fallback */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'absolute'; ta.style.left = '-9999px';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return !!ok;
  } catch (e) { return false; }
}
/* ---------- Active live game note (signed-in coaches) ---------- */
/* A coach opening the app should not need a code to rejoin their own
   team's game: after sign-in, the setup screen checks once for live
   games (phase live/halftime) and shows a small one-line note per
   game with a Join button — no code, full edit rights (any coach can
   drive). The check is coaches-only and non-blocking: the setup flow
   renders first, and the note appears only when a game is actually
   active. The game the coach is already in never shows a note. */
async function loadActiveGames(){
  if (!SB.configured || !SB.authUser || SB.activeGamesLoading) return;
  SB.activeGamesLoading = true;
  try {
    const { data, error } = await SB.client.from('live_games')
      .select('*').in('phase', ['live', 'halftime'])
      .order('updated_at', { ascending: false });
    if (error) throw error;
    SB.activeGames = data || [];
    SB.activeGamesLoaded = true;
  } catch (e) { SB.activeGamesLoaded = true; /* note just stays hidden */ }
  SB.activeGamesLoading = false;
  render();
}
function activeGameElapsed(st){
  const clock = (st && st.clock) || {};
  if (clock.running && clock.anchor_started_at) {
    return (clock.elapsed_seconds_at_anchor || 0) + (Date.now() - clock.anchor_started_at) / 1000;
  }
  return clock.elapsed_seconds_at_anchor != null ? clock.elapsed_seconds_at_anchor : (st.elapsed || 0);
}
function activeGamesHtml(){
  if (!SB.authUser || SB.liveId) return '';
  // Load once, when the setup screen first renders.
  if (!SB.activeGamesLoaded && !SB.activeGamesLoading) loadActiveGames();
  const games = (SB.activeGames || []).filter(g => g && g.id !== SB.liveId);
  if (!games.length) return '';
  return games.map(g => {
    const st = (g.state) || {};
    const score = 'US ' + (st.ourScore || 0) + ' – ' + (st.theirScore || 0) + ' THEM';
    // Stacked, not one flex row: the single-line layout squeezed the
    // clock off the right edge ("US 1 – 0 THEM · 20…"). Title on its
    // own line, score + clock on the next, Join + Shut down below —
    // Join grows, Shut down is a small button beside it, so nothing
    // can overflow, at 360px or 390px.
    return '<div class="card"><strong>There\u2019s a live game in progress</strong>'
      + '<div class="muted">' + esc(score) + ' &middot; ' + fmtClock(activeGameElapsed(st)) + '</div>'
      + '<div class="row" style="margin-top:8px"><button class="primary grow" data-join-active="' + esc(g.id) + '">Join</button><button class="small danger" data-shutdown-game="' + esc(g.id) + '">Shut down</button></div></div>';
  }).join('');
}
async function joinActiveGame(row){
  // No code needed: the coach is signed in, so any coach can drive.
  if (!SB.configured || !SB.authUser || !row) return false;
  SB.liveId = row.id; SB.liveCode = row.game_code; SB.liveVersion = row.version;
  SB.role = 'driver'; SB.offline = false; SB.viewerMode = false;
  applyLiveState(row.state || {});
  SB.rosterFromLive = true; SB.rosterFromBackend = false;
  if (row.phase === 'halftime') S.screen = 'halftime';
  else S.screen = 'live';
  S.liveTab = 'actions';
  subscribeLive();
  await pushGameUrl(row.game_code); // deep link, same as joining by code (resolves the view code first)
  render();
  return true;
}
/* ---------- Deep links: every live game has its own URL ---------- */
/* Coach: ?game=HEQK. Viewer: ?view=CODE&game=HEQK. Opening a game
   pushes its URL; reloading it re-opens the same game; going back
   to setup clears it (plain URL, or ?view=CODE for a viewer). The
   browser back button works: opening a game pushes a history entry,
   going back returns to the previous screen (routeFromUrl, driven by
   popstate). URL changes never re-render and never touch game state.
   pushState/replaceState are guarded — a sandboxed or file:// page
   that forbids them still plays fine, just without deep links. */
function gameUrl(code){
  const p = new URLSearchParams();
  // The coach URL always carries the view code (?view=CODE&game=...),
  // so the address bar is already a shareable link: anyone opening
  // it without signing in lands in that game as a viewer, and a
  // signed-in coach gets full edit rights. Edit rights come from
  // sign-in only — the view code in the URL never grants them.
  // Viewers carry the code they joined with.
  const view = SB.viewerCode || (SB.viewerMode && SB.viewerJoinedCode) || '';
  if (view) p.set('view', view);
  p.set('game', code);
  return window.location.pathname + '?' + p.toString();
}
function homeUrl(){
  if (SB.viewerMode && SB.viewerJoinedCode) return window.location.pathname + '?view=' + SB.viewerJoinedCode;
  return window.location.pathname;
}
function pushUrl(url){ try { if (window.location.pathname + window.location.search !== url) window.history.pushState({}, '', url); } catch (e) {} }
function replaceUrl(url){ try { window.history.replaceState({}, '', url); } catch (e) {} }
async function pushGameUrl(code){
  // Coaches: make sure a view code exists first, so the URL is
  // shareable from the moment the game opens.
  if (SB.authUser) await ensureViewerCode();
  pushUrl(gameUrl(code));
}
/* Back out of a live game without pushing a new history entry (used
   by routing: the URL already says where we are going). Viewers
   leave the shared view; coaches go to setup keeping history,
   roster, settings and team name. */
function leaveToHome(){
  if (SB.viewerMode && !SB.authUser) leaveLiveGame();
  else startNewGame();
  replaceUrl(homeUrl());
}
/* Route the current URL: ?game= (coach) or ?view=&game= (viewer)
   opens that game directly; no game param while in a live game
   means the back button was used — leave the game. Returns true
   when it handled the URL (joined a game, showed the not-found
   message, or left a game); false when nothing applied, so the
   caller carries on with the normal entry flow. Never pushes
   history — the URL is already the destination. */
async function routeFromUrl(){
  let params;
  try { params = new URLSearchParams(window.location.search); } catch (e) { return false; }
  const gameCode = (params.get('game') || '').trim().toUpperCase();
  const viewCode = (params.get('view') || '').trim().toUpperCase();
  if (gameCode) {
    if (SB.liveCode === gameCode && SB.liveId) {
      if (SB.viewerMode && SB.authUser) { SB.role = 'driver'; startViewerPoll(); }
      return true; // already in that game
    }
    if (SB.viewerMode && SB.viewerJoinedCode) {
      const live = (SB.viewerLives || []).find(g => g && g.game_code === gameCode);
      if (live) { joinViewerGame(live.id, {push:false}); return true; }
      // Named game is gone or never existed — plain in-app message
      // on the viewer home, never a blank screen.
      S.error = 'That live game is no longer available.';
      S.screen = 'viewer'; render(); return true;
    }
    if (SB.authUser) {
      // Signed-in coach: full edit rights, no code entry, no setup
      // detour. A missing game shows joinLiveGame's not-found error
      // on setup — the way back is right there.
      return await joinLiveGame(gameCode, {push:false});
    }
    if (viewCode && SB.configured) {
      // Viewer link with a game, not joined yet (e.g. back-button
      // into a viewer URL): join the view first, then the game.
      const ok = await joinViewerCode(viewCode);
      if (!ok) return true; // joinViewerCode shows the error
      return await routeFromUrl();
    }
    return false; // needs sign-in first; enterApp routes after sign-in
  }
  if (SB.liveId && (S.screen === 'live' || S.screen === 'halftime')) {
    leaveToHome(); return true;
  }
  return false;
}
function scheduleLiveSync(immediate) {
  if (SB.role !== 'driver' || !SB.liveId || !SB.configured) return;
  if (SB.syncTimer) clearTimeout(SB.syncTimer);
  SB.syncTimer = setTimeout(() => { doLiveSync(); }, immediate ? 0 : 1200);
}
async function doLiveSync() {
  if (SB.role !== 'driver' || !SB.liveId || !SB.configured) return;
  const nextVersion = SB.liveVersion + 1;
  try {
    const { data, error } = await SB.client.from('live_games').update({
      state: buildLiveState(), phase: livePhase(), version: nextVersion,
      last_writer_id: WRITER_ID, last_writer_label: 'Driver',
      updated_at: new Date().toISOString(),
    }).eq('id', SB.liveId).eq('version', SB.liveVersion).select('version');
    if (error) throw error;
    if (!data || !data.length) {
      // Version moved under us: another coach (or Robin's other
      // session) wrote first. Retry once against the fresh version —
      // last write wins, no banner, no user action — so this
      // session's change still lands instead of being dropped.
      const latest = await fetchLiveRow();
      if (!latest) {
        // No row: fetchLiveRow does not distinguish "gone" from
        // "unreachable", so check explicitly. If the row is gone,
        // another coach shut the game down — leave it like they did
        // instead of sitting offline in a dead game. A failed check
        // is just a network problem: stay offline and retry later.
        try {
          const { data: stillThere, error: checkErr } = await SB.client.from('live_games').select('id').eq('id', SB.liveId).maybeSingle();
          if (!checkErr && !stillThere) { handleLiveDeleted(SB.liveId); return; }
        } catch (e) { /* fall through to offline below */ }
        SB.offline = true; render(); return;
      }
      if (latest.version > SB.liveVersion) {
        const retry = await SB.client.from('live_games').update({
          state: buildLiveState(), phase: livePhase(), version: latest.version + 1,
          last_writer_id: WRITER_ID, last_writer_label: 'Driver',
          updated_at: new Date().toISOString(),
        }).eq('id', SB.liveId).eq('version', latest.version).select('version');
        if (!retry.error && retry.data && retry.data.length) {
          SB.liveVersion = latest.version + 1; SB.offline = false; return;
        }
        // The retry raced too — take the latest state live, like any
        // other live update, and let the next action write on top.
        handleRemoteLive(latest);
      }
      return;
    }
    SB.liveVersion = nextVersion; SB.offline = false;
  } catch (e) {
    SB.offline = true;
    render();
  }
}
async function finishLiveGame() {
  if (SB.role !== 'driver' || !SB.liveId || !SB.configured) return;
  try {
    const nextVersion = SB.liveVersion + 1;
    await SB.client.from('live_games').update({
      state: buildLiveState(), phase: 'finished', version: nextVersion,
      last_writer_id: WRITER_ID, last_writer_label: 'Driver',
      updated_at: new Date().toISOString(),
    }).eq('id', SB.liveId).eq('version', SB.liveVersion);
    SB.liveVersion = nextVersion;
  } catch (e) { /* History insert is the durable record; live row may stay 'live'. */ }
  unsubscribeLive();
  SB.liveId = null; SB.liveCode = null; SB.role = null;
}
/* Shut down a live game (signed-in coach only): delete the live_games
   row and drop the local game — it is NOT saved to history. Different
   from End game, which finishes and saves. For a stale test game or
   an abandoned game. The control lives ONLY on the landing screen
   (setup), next to each active-game note's Join button — never in the
   game view. Anonymous viewers never see the control and the DELETE
   policy (schema.sql / add-live-delete.sql) is authenticated-only,
   so a viewer cannot call it either. */
async function shutdownLiveGame(gameId){
  if (!SB.authUser) return;
  // The landing screen passes the game's id. (An open game would
  // pass its own id too — the same path shuts down whichever game
  // the coach picked, without opening it first.)
  const id = gameId || SB.liveId;
  if (!id || !SB.configured) return;
  const isOpenGame = id === SB.liveId;
  if (isOpenGame) unsubscribeLive(); // do not hear our own DELETE echo
  try {
    const { error } = await SB.client.from('live_games').delete().eq('id', id);
    if (error) throw error;
  } catch (e) {
    if (isOpenGame) subscribeLive(); // back on the game — the shutdown did not go through
    S.error = 'Could not shut down the live game — check connection and try again.';
    render(); return;
  }
  if (isOpenGame) {
    // Back to setup, keeping history, roster, settings and team name —
    // same as starting a new game, but nothing was saved.
    startNewGame();
    replaceUrl(homeUrl()); // the shut-down game's URL is stale
  } else {
    // Shut down from the landing screen: just drop the note.
    SB.activeGames = (SB.activeGames || []).filter(g => g && g.id !== id);
    if (S.screen === 'setup') render();
  }
  showToast('Live game shut down');
}
/* Another coach shut the game down (or the row was deleted some other
   way): the game is gone. If we were in that game, go back to setup
   like the coach who shut it down — with the small "Updated" note,
   not an error. If we were only listing it on setup, drop it from
   the active-game note. */
function handleLiveDeleted(deletedId){
  if (SB.liveId && deletedId === SB.liveId) {
    startNewGame();
    replaceUrl(homeUrl()); // the deleted game's URL is stale
    showToast('Updated');
  } else if (deletedId) {
    SB.activeGames = (SB.activeGames || []).filter(g => g && g.id !== deletedId);
    if (S.screen === 'setup') render();
  }
}
/* Live-update toast: a small "Updated" pill fixed near the top of the
   screen. It lives on document.body (outside mainEl, so re-renders
   never touch it) and is position:fixed — it never takes space in the
   page flow and never pushes the field, bench, or Apply button down.
   It fades away on its own after a few seconds. Shown on remote
   updates only, never on the driver's own actions, and worded
   neutrally ("Updated") — Robin signed in on two devices is the same
   person, not "the other coach". */
let toastTimer = null;
function showToast(text){
  try {
    let el = document.getElementById('live-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'live-toast';
      el.className = 'live-toast';
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('show'); }, 2500);
  } catch (e) { /* toast is cosmetic — never break the game for it */ }
}
function resetLiveSession() {
  unsubscribeLive();
  if (SB.viewerTimer) { clearInterval(SB.viewerTimer); SB.viewerTimer = null; }
  SB.liveId = null; SB.liveCode = null; SB.liveVersion = 0; SB.role = null; SB.viewerAnchor = null;
  SB.viewerMode = false; SB.viewerHistoryJson = ''; SB.viewerJoinedCode = ''; SB.viewerLives = [];
  SB.activeGames = []; SB.activeGamesLoaded = false; SB.activeGamesLoading = false;
}

/* ---------- Undo ---------- */
function snapshotGame(){
  return JSON.parse(JSON.stringify({
    lineup:S.lineup, removedPositions:S.removedPositions, shortMode:S.shortMode,
    elapsed:S.elapsed, ourScore:S.ourScore, theirScore:S.theirScore,
    minutesSec:S.minutesSec, gkSec:S.gkSec, posSec:S.posSec, goals:S.goals,
    queue:S.queue, rosterPresent:S.roster.map(r=>r.present), rosterTired:S.roster.map(r=>r.tired),
  }));
}
function pushUndo(label){
  S.undoStack.push({label, snap:snapshotGame()});
  if(S.undoStack.length>20) S.undoStack.shift();
}
function undoLast(){
  const u=S.undoStack.pop(); if(!u) return;
  const s=u.snap;
  S.lineup=s.lineup; S.removedPositions=s.removedPositions; S.shortMode=s.shortMode;
  S.elapsed=s.elapsed; S.ourScore=s.ourScore; S.theirScore=s.theirScore;
  S.minutesSec=s.minutesSec; S.gkSec=s.gkSec; S.posSec=s.posSec; S.goals=s.goals; S.queue=s.queue;
  s.rosterPresent.forEach((p,i)=>{S.roster[i].present=p;});
  s.rosterTired.forEach((t,i)=>{S.roster[i].tired=t;});
  S.swapPair=[]; S.selection=null;
  render();
}

/* ---------- Minutes / projections ---------- */
function fieldCount(){ return S.shortMode ? 6 : 7; }
function onField(){ return S.lineup.map((p,i)=>p==null?null:{player:p,pos:i}).filter(Boolean); }
function benchPlayers(){
  const on=new Set(S.lineup.filter(x=>x!=null));
  return S.roster.map((r,i)=>i).filter(i=>!on.has(i) && S.roster[i].present);
}
function totalSec(i){ // total counted toward game time, per goalie toggle
  return S.settings.countGoalieTime ? S.minutesSec[i] : (S.minutesSec[i]-S.gkSec[i]);
}
function fairShareSec(){
  // Fair share is computed on the same counted basis as the totals:
  // when goalie time is excluded, only the six non-goalie field slots
  // count toward a player's share of the game.
  const present=S.roster.filter(r=>r.present).length || 1;
  const countedSlots=S.settings.countGoalieTime ? fieldCount() : fieldCount()-1;
  return S.settings.matchMinutes*60*countedSlots/present;
}
function projectedSec(i){
  const remaining=Math.max(0, S.settings.matchMinutes*60 - S.elapsed);
  const onPos=S.lineup.indexOf(i);
  // A player standing in goal accrues counted minutes only when the
  // "Count goalie time" setting is ON; otherwise their projection
  // stays flat while they are in goal.
  const onCounts = onPos>=0 && (onPos!==0 || S.settings.countGoalieTime);
  let proj=totalSec(i);
  if(onCounts) proj+=remaining;
  // queued sub: if this player is coming on, they get the remaining time instead of the outgoing player
  for(const q of S.queue){
    // q.pos is the spot being filled (0 = GK).
    const inCounts = (q.pos!==0 || S.settings.countGoalieTime);
    if(q.in===i && inCounts) proj+=remaining;
    if(q.out===i) proj=Math.max(totalSec(i), proj-remaining);
  }
  return Math.max(totalSec(i), proj);
}
function flagFor(i){
  const fair=fairShareSec(), proj=projectedSec(i), th=S.settings.fairTimeThreshold*60;
  if(proj > fair+th) return {cls:'high', label:'HIGH'};
  if(proj < fair-th) return {cls:'low', label:'LOW'};
  return {cls:'ok', label:'OK'};
}
function goalsFor(i, side){
  return S.goals.filter(g=>g.player===i && (!side || g.side===side)).length;
}
// Goal label. players is the list the goal's index refers to — the
// game's own players for a history game, the current roster for a
// live game. The stored player_name wins over the index, so a goal
// never shows the wrong player when the roster is reordered.
// player null = unknown scorer.
function goalLabel(g, players){
  const list = players || S.roster;
  let name;
  if (g.player === -1) name = 'Own goal';
  else if (g.player == null) name = g.player_name || 'Unknown scorer';
  else if (g.player_name) name = g.player_name;
  else name = list[g.player] ? list[g.player].name : '?';
  const min=g.seconds==null?'':" "+Math.floor(g.seconds/60)+"'";
  return name+min;
}
// Goals shown to the user. Unknown-scorer goals on the THEM side are
// never listed: the other team's scorers were never recorded, and
// there is nobody on our roster to assign one to. US unknown goals
// ARE listed ("Unknown scorer", assignable via Edit goals).
// Display-only: the score is stored separately (our_score /
// their_score) and still shows the full score.
function displayGoals(goals){ return (goals||[]).filter(g=>!(g.player==null && (g.side||'us')==='them')); }

/* ---------- Lineup generation ---------- */
function autoLineup(favourLow){
  const present=S.roster.map((r,i)=>i).filter(i=>S.roster[i].present);
  const pool=shuffle(present);
  // Prefer low-minute players for halftime plans
  if(favourLow) pool.sort((a,b)=>totalSec(a)-totalSec(b));
  const used=new Set(), out=[null,null,null,null,null,null,null];
  // Pass 1: respect preferences, GK first (Ethan GK-only, then Sofia)
  for(const pos of [0,1,2,3,4,5,6]){
    const cand=pool.filter(i=>!used.has(i) && S.roster[i].prefs.includes(POSITIONS[pos]));
    if(cand.length){ const pick=pos===0 ? cand[0] : cand[0]; used.add(pick); out[pos]=pick; }
  }
  // Pass 2: fill any gaps with anyone present (prefs guide, never block)
  for(let pos=0;pos<7;pos++){
    if(out[pos]==null){
      const cand=pool.filter(i=>!used.has(i));
      if(cand.length){ used.add(cand[0]); out[pos]=cand[0]; }
    }
  }
  return out;
}
function applyLineup(lineup){
  pushUndo('lineup change');
  S.lineup=dedupeLineup([...lineup]);
  S.removedPositions=[]; S.shortMode=false;
}
/* One player, one field spot (Robin's rule, Nov 2026): placing a
   player at a second spot clears the first one — a move, not a copy.
   The spot they leave becomes empty (just the position label).
   Preferred positions are different — a player can prefer many
   positions — and the swap flow (two players trading spots) is
   unaffected: it swaps, never duplicates. */
function placeOnField(lineup, pos, player){
  if (player == null) { lineup[pos] = null; return; }
  for (let k = 0; k < lineup.length; k++) if (k !== pos && lineup[k] === player) lineup[k] = null;
  lineup[pos] = player;
}
/* Defensive pass for lineups loaded from storage (last / preferred /
   halftime plan): keep the first occurrence of each player, clear
   any later duplicates. */
function dedupeLineup(lineup){
  const seen = new Set();
  return (lineup || []).map(x => {
    if (x == null || seen.has(x)) return null;
    seen.add(x); return x;
  });
}

/* ---------- Rendering ---------- */
const mainEl=document.getElementById('main');
const modalRoot=document.getElementById('modal-root');
let clockTimer=null;

function startClock(){
  if(clockTimer) return;
  clockTimer=setInterval(()=>{
    if(!S.running) return;
    // View-only phone: the clock comes from the driver's anchor, not
    // from local ticking — never credit minutes locally on a viewer.
    if(SB.role==='viewer' && SB.liveId && SB.viewerAnchor && SB.viewerAnchor.running){
      S.elapsed = SB.viewerAnchor.elapsedAtAnchor + (Date.now() - SB.viewerAnchor.anchorStartedAt) / 1000;
      const c=$('#clock'); if(c) c.textContent=fmtClock(S.elapsed);
      return;
    }
    S.elapsed+=1;
    // Credit 1 second to everyone currently on the field.
    onField().forEach(({player,pos})=>{
      S.minutesSec[player]+=1;
      const p=POSITIONS[pos];
      S.posSec[player][p]=(S.posSec[player][p]||0)+1;
      if(pos===0) S.gkSec[player]+=1;
    });
    const c=$('#clock'); if(c) c.textContent=fmtClock(S.elapsed);
    const mins=$('#live-minutes-inline'); if(mins) mins.innerHTML=minutesRowsHtml();
    // The clock keeps running past full time (private app): overage
    // shows next to the clock. It never stops itself — End game does.
  },1000);
}
function fieldSpotHtml(pos, opts){
  const p=S.lineup[pos];
  const removed=S.removedPositions.includes(pos);
  // Queue / selection decorations are live-Actions only (opts.live):
  // every other field (setup, review, halftime plan, finished, and the
  // read-only starting lineup) shows plain chips, so a queued sub can
  // never leak into the starting lineup view.
  const live=!!opts.live;
  const queuedOff=live?S.queue.find(q=>q.pos===pos):undefined;
  const staged=live&&S.swapPair.includes(pos);
  const sel=live&&S.selection&&S.selection.kind==='out'&&S.selection.pos===pos;
  let cls='chip', badge='';
  if(removed){ cls+=' removed'; }
  else if(p==null){ cls+=' empty'; }
  else{
    if(S.roster[p].tired) cls+=' tired';
    if(sel||staged) cls+= staged?' swap-staged':' selected';
    if(queuedOff){ cls+=' queued-off'; badge='<span class="badge off">↓ '+POSITIONS[pos]+'</span>'; }
  }
  // Empty spot shows just its position label (private app); a filled
  // spot shows no position label — the spot's place on the field says it.
  const name=removed?'Removed':(p==null?POSITIONS[pos]:esc(S.roster[p].name));
  // Live field chips show the player's counted minutes under the name
  // (private app); setup / review / finished chips show just the name.
  // A queued-in player is shown inside the chip ("-> name"), with the
  // position badge on the chip's top edge — never as a line under it.
  // Minutes and incoming lines are always rendered (empty when
  // absent) so a chip is exactly the same height whether or not a sub
  // is incoming — the chip never grows and the page never shifts.
  const mins='<span class="mins">'+((opts.showMinutes&&p!=null&&!removed)?Math.round(totalSec(p)/60)+'m':'')+'</span>';
  const pairIn='<span class="pair">'+(queuedOff?'\u2192 '+esc(S.roster[queuedOff.in].name):'')+'</span>';
  const chipInner='<span>'+name+'</span>'+mins+pairIn;
  const inner=opts.readonly
    ? '<div class="'+cls+'">'+chipInner+'</div>'
    : '<button class="'+cls+'" data-spot="'+pos+'" aria-label="'+POSITIONS[pos]+' '+(name||'empty')+'">'+chipInner+'</button>';
  return '<div class="spot">'+badge+inner+'</div>';
}
function fieldHtml(opts){
  opts=opts||{};
  // Layout: ST top, RM/CM/LM middle, RB/LB defence, GK in box. Same component everywhere.
  const row=(positions)=>'<div class="f-row'+(positions.length===3?' mid':'')+'">'+positions.map(p=>fieldSpotHtml(p,opts)).join('')+'</div>';
  // Our half only: ST top, midfield, defence, GK in the box at the
  // bottom. Only the outer border and the GK box are drawn.
  // Swap overlay (live Actions only, opts.swapOverlay): when a swap is
  // staged, Swap / Cancel sit inside the field's bottom-right corner
  // as an absolute overlay — zero vertical space on the page, nothing
  // shifts when they appear. The GK chip is centred, so the corner of
  // the goal box is empty.
  const swapOverlay=opts.swapOverlay?'<div class="field-swap"><button class="primary" data-do-swap>Swap</button></div>':'';
  return '<div class="field" role="group" aria-label="Field, 1-2-3-1">'
    + row([6])
    + row([3,4,5])
    + row([1,2])
    + '<div class="gk-box">'+row([0])+'</div>'
    + swapOverlay
    + '</div>';
}
function benchHtml(){
  const bench=benchPlayers();
  if(!bench.length) return '<p class="muted">Bench is empty — everyone present is on the field.</p>';
  return '<div class="bench">'+bench.map(i=>{
    const q=S.queue.find(x=>x.in===i);
    const sel=S.selection && S.selection.kind==='in' && S.selection.player===i;
    const cls=['', S.roster[i].tired?'tired':'', sel?'selected':'', q?'queued-on':''].join(' ');
    // Private bench: one line — name left, minutes right. A queued-in
    // player instead shows the position badge and "for <out>" on a
    // second line, with no minutes.
    const name=esc(S.roster[i].name)+(S.roster[i].tired?' <span class="tired-dot">\u25cf</span>':'');
    const top=q
      ? '<span class="b-name">'+name+'</span><span class="b-badge">\u2191 '+POSITIONS[q.pos]+'</span>'
      : '<span class="b-name">'+name+'</span><span class="b-mins">'+Math.round(totalSec(i)/60)+'m</span>';
    // The "for <out>" line is always rendered (empty when no sub is
    // incoming) so a bench button is exactly the same height whether
    // or not it has a queued sub — the button never grows.
    const sub='<span class="b-sub">'+(q?'for '+esc(S.roster[q.out].name):'')+'</span>';
    return '<button class="'+cls+'" data-bench="'+i+'">'+top+sub+'</button>';
  }).join('')+'</div>';
}
function minutesRowsHtml(){
  const present=S.roster.map((r,i)=>i).filter(i=>S.roster[i].present);
  present.sort((a,b)=>totalSec(b)-totalSec(a));
  return present.map(i=>{
    const f=flagFor(i), g=goalsFor(i);
    const gk=S.gkSec[i]>0 ? ' <span class="flag gk">GK '+fmtMin(S.gkSec[i])+'</span>' : '';
    return '<div class="mrow"><div><span class="name">'+esc(S.roster[i].name)+'</span>'
      +(g?' <span title="Goals">⚽ '+g+'</span>':'')
      +(S.roster[i].tired?' <span class="tired-dot">● tired</span>':'')+gk+'</div>'
      +'<div class="nums">'+fmtMin(totalSec(i))+' min &middot; proj '+fmtMin(projectedSec(i))
      +' <span class="flag '+f.cls+'">'+f.label+'</span></div>'
      +'<button class="small" data-tired="'+i+'">'+(S.roster[i].tired?'Untire':'Tired')+'</button></div>';
  }).join('');
}
function teamRowsHtml(){
  // Compact Roster tab: one short row per player, ~86px tall.
  // Line 1 (no wrap, always fits): availability circle, name + status
  // ("Bench · 0m · 5 pos" on setup — where/minutes/position count
  // condensed into one muted run; "Absent · N pos" when absent),
  // More as a small button (plus Rename on the setup Roster tab only
  // — never during a game). Line 2 (setup only): all 7 position
  // chips in a single row, green fill on preferred positions; tap a
  // chip to toggle it (at least one preferred position is always
  // kept). Selected chips show just the position label on green — no
  // checkmark: the green fill already says selected. A note, if any,
  // is its own small line. Nothing is dropped to save space.
  // During a game (live Team tab, or the setup screen used as the
  // mid-game Edit lineup editor) there are no preferred-positions
  // controls at all: no chips row, no "N pos" in the status — just
  // name, status, minutes, and mark tired / leaving / note (More).
  // Preferred positions are edited on the setup Roster tab only.
  const idx=S.roster.map((r,i)=>i).sort((a,b)=>S.roster[a].name.localeCompare(S.roster[b].name));
  const inGame = (S.screen === 'live' || S.screen === 'halftime');
  // Rename and preferred positions belong to setup only: during a
  // game there is no Rename button and no prefs chips — the row
  // simply has More. Both stay available on the setup Roster tab
  // before a game starts.
  const showSetupOnly = (S.screen === 'setup' && !S.editingLive);
  const showRename = showSetupOnly;
  const showPrefs = showSetupOnly;
  return idx.map(i=>{
    const r=S.roster[i], pos=S.lineup.indexOf(i), g=goalsFor(i);
    const where=pos>=0?POSITIONS[pos]:'Bench';
    const status = r.present
      ? where+' &middot; '+fmtMin(totalSec(i))+' min'+(showPrefs?' &middot; '+r.prefs.length+' pos':'')
      : 'Absent'+(showPrefs?' &middot; '+r.prefs.length+' pos':'');
    const chips=showPrefs?POSITIONS.map(pp=>'<button data-pref-inline="'+pp+'" data-player="'+i+'" aria-pressed="'+r.prefs.includes(pp)+'">'+pp+'</button>').join(''):'';
    // Mid-game arrivals and departures (private Team tab): a departing
    // player keeps their minutes and their spot can be filled from the
    // bench; a late arrival joins the bench. Sits at the end of the
    // chips row so line 1 never wraps.
    const arriveLeave = inGame
      ? (r.present
          ? '<button class="xs" data-leaving="'+i+'">Leaving</button>'
          : '<button class="xs" data-arrived="'+i+'">Arrived</button>')
      : '';
    // The second row exists only when it has something in it: chips
    // on setup, Leaving/Arrived during a game — never an empty row
    // (no gap left behind when the chips go away).
    const secondRow = (chips || arriveLeave) ? '<div class="pos-chips">'+chips+arriveLeave+'</div>' : '';
    return '<div class="card roster-row"><div class="roster-top"><button class="avail'+(r.present?'':' absent')+'" data-attend="'+i+'" aria-label="Toggle availability for '+esc(r.name)+'">'+(r.present?'\u2713':'')+'</button>'
      +'<div class="roster-id"><span class="name">'+esc(r.name)+'</span>'
      +(g?' <span>\u26bd '+g+'</span>':'')+' <span class="muted small">'+status+'</span></div>'
      +(showRename?'<button class="xs" data-rename="'+i+'">Rename</button>':'')
      +'<button class="xs" data-more="'+i+'">More</button></div>'
      +(r.note?'<div class="note-line">'+esc(r.note)+'</div>':'')
      +secondRow+'</div>';
  }).join('');
}
function seasonTotalsHtml(){
  if(!S.history.length) return '';
  const totals = new Map();
  S.history.forEach(h => (h.players || []).forEach(p => {
    const t = totals.get(p.name) || { name: p.name, seconds: 0, games: 0, goals: 0, gkSeconds: 0, pos: {} };
    // p.seconds is the COUNTED total (goalie-adjusted per the setting);
    // p.gkSeconds and the per-position breakdown keep goalie minutes
    // separately, so they still show even when the total excludes them.
    t.seconds += (p.seconds || 0); t.gkSeconds += (p.gkSeconds || 0); t.goals += (p.goals || 0);
    if (p.present) t.games += 1;
    Object.entries(p.posSeconds || {}).forEach(([k, v]) => { t.pos[k] = (t.pos[k] || 0) + v; });
    totals.set(p.name, t);
  }));
  // Card layout from the private Season totals screen: name + games on
  // the left, average per game large on the right with the bold total
  // beneath it, per-position breakdown (whole minutes, position order,
  // goalie minutes included) along the bottom. Sorted by total minutes
  // descending. Average uses exact seconds / games played (one decimal),
  // total is the rounded whole-minute counted total.
  const rows = [...totals.values()].sort((a, b) => b.seconds - a.seconds)
    .map(t => {
      const posLine = POSITIONS
        .filter(k => Math.round((t.pos[k] || 0) / 60) > 0)
        .map(k => k + ' ' + Math.round((t.pos[k] || 0) / 60) + 'm').join(' &middot; ');
      const avg = t.games ? ((t.seconds / 60) / t.games).toFixed(1) : '0.0';
      return '<div class="card season-card"><div class="row spread"><div><span class="season-name">' + esc(t.name) + '</span></div>'
        + '<div style="text-align:right"><div><span class="season-avg">' + avg + '</span> <span class="muted">avg/game</span></div>'
        + '<div class="season-total">' + Math.round(t.seconds / 60) + ' <span class="muted" style="font-size:15px">min</span></div></div></div>'
        + '<div><strong>' + t.games + '</strong> <span class="muted">game' + (t.games === 1 ? '' : 's') + '</span></div>'
        + (posLine ? '<div class="muted season-pos">' + posLine + '</div>' : '') + '</div>';
    }).join('');
  // Anonymous code-joined watchers see the totals but get no CSV
  // downloads of history (same rule as the viewer edit gate).
  const anonViewer = SB.viewerMode && !SB.authUser;
  return '<div class="row spread" style="align-items:baseline"><h2 style="margin-bottom:2px">Season totals</h2>'
    + (anonViewer ? '' : '<span><button class="season-csv-link" data-season-csv>&darr; Full season CSV</button>'
    + '<button class="season-csv-link" data-all-history-csv>&darr; Export all history</button></span>') + '</div>'
    + '<p class="muted" style="margin-top:0">' + S.history.length + ' game' + (S.history.length === 1 ? '' : 's')
    + ' &middot; ' + (S.settings.countGoalieTime ? 'goalie time counts toward totals' : 'totals exclude goalie time (shown in the breakdown)') + '</p>'
    + rows;
}
function seasonCsv(){
  // Same totals as the Season totals cards, one row per player.
  const totals = new Map();
  S.history.forEach(h => (h.players || []).forEach(p => {
    const t = totals.get(p.name) || { name: p.name, seconds: 0, games: 0, goals: 0, gkSeconds: 0, pos: {} };
    t.seconds += (p.seconds || 0); t.gkSeconds += (p.gkSeconds || 0); t.goals += (p.goals || 0);
    if (p.present) t.games += 1;
    Object.entries(p.posSeconds || {}).forEach(([k, v]) => { t.pos[k] = (t.pos[k] || 0) + v; });
    totals.set(p.name, t);
  }));
  const head = ['Player','Games played','Avg minutes per game','Total minutes','GK minutes','Goals', ...POSITIONS].join(',') + '\n';
  const lines = [...totals.values()].sort((a, b) => b.seconds - a.seconds).map(t => {
    const cells = [t.name, t.games, t.games ? ((t.seconds / 60) / t.games).toFixed(1) : '0.0',
      (t.seconds / 60).toFixed(1), (t.gkSeconds / 60).toFixed(1), t.goals,
      ...POSITIONS.map(k => ((t.pos[k] || 0) / 60).toFixed(1))];
    return cells.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(',');
  });
  return head + lines.join('\n') + '\n';
}
function historyHtml(){
  let status = '';
  if (SB.configured) {
    if (SB.historyError) status = '<p class="muted">' + esc(SB.historyError) + '</p>';
    else if (!SB.historyLoaded) status = '<p class="muted">Loading history\u2026</p>';
  }
  if(!S.history.length) return status + '<p class="muted">No finished games yet.</p>';
  // Order (Robin's call, Nov 2026): games first, then the season
  // totals cards. No content changes to either section.
  return status + '<h2>Past games</h2>' + S.history.map((h,hi)=>{
    const open = !!S.expandedHistory[hi];
    const played = h.playedSeconds ? fmtClock(h.playedSeconds) + ' played' : '';
    const head = '<div class="row spread"><div><strong>' + esc(h.date) + '</strong>'
      + '<div class="muted">' + (played ? played + ' &middot; ' : '') + 'US ' + h.ourScore + ' \u2013 ' + h.theirScore + ' THEM</div></div>'
      + '<button class="small" data-details="' + hi + '">' + (open ? 'Hide' : 'Details') + '</button></div>';
    if (!open) return '<div class="card">' + head + '</div>';
    const goalLines = displayGoals(h.goals).map(g=>goalLabel(g, h.players)).join(', ') || 'No goals recorded';
    const rows = h.players.map(p => {
      // Per-player row: counted total (whole minutes) on the right,
      // per-position breakdown below the name — goalie minutes included
      // in the breakdown even when the total excludes them.
      const posLine = POSITIONS
        .filter(k => (p.posSeconds || {})[k] > 0)
        .map(k => k + ' ' + Math.round(((p.posSeconds || {})[k] || 0) / 60) + 'm').join(' &middot; ');
      return '<div class="mrow"><div style="min-width:0"><span class="name">' + esc(p.name) + '</span>'
        + (p.goals ? ' \u26bd ' + p.goals : '')
        + (posLine ? '<div class="note-line">' + posLine + '</div>' : '') + '</div>'
        + '<div class="nums">' + Math.round((p.seconds || 0) / 60) + ' min</div></div>';
    }).join('');
    // Anonymous watchers get no per-game export or goal editing.
    const anonViewer = SB.viewerMode && !SB.authUser;
    return '<div class="card">' + head
      + (anonViewer ? '' : '<div class="row" style="margin:8px 0"><button class="small" data-csv="' + hi + '">Export this game CSV</button> '
      + '<button class="small" data-editgoals="' + hi + '">Edit goals</button></div>')
      + '<h3>Goals</h3><p>' + esc(goalLines) + '</p>'
      + rows + '</div>';
  }).join('') + seasonTotalsHtml();
}
function csvCell(v){ return '"'+String(v).replace(/"/g,'""')+'"'; }
// ISO date for a history game: stored on the game since the rebuild
// (finishGame / internalGameFromRow); older games only have the
// display date, which this app writes as M/D/YYYY.
function isoDateOf(h){
  if(h.dateISO) return h.dateISO;
  const m=String(h.date||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m?m[3]+'-'+m[1].padStart(2,'0')+'-'+m[2].padStart(2,'0'):String(h.date||'');
}
// Goal rows for a history game, for CSV: [scorer, minute-or-blank, side].
// Player is a roster index into the game's own player list, so the name
// stays right even if the roster has changed since; -1 is an own goal.
function goalRowsForCsv(h){
  return displayGoals(h.goals).map(g=>[
    g.player===-1?'Own goal':(g.player==null?'Unknown scorer':(g.player_name||((h.players||[])[g.player]?h.players[g.player].name:'?'))),
    g.seconds==null?'':Math.floor(g.seconds/60),
    g.side||'us']);
}
function csvForGame(h){
  const head='Player,Present,Actual minutes,GK minutes,Goals,Positions\n';
  const lines=h.players.map(p=>[p.name, p.present?'yes':'no', fmtMin(p.seconds), fmtMin(p.gkSeconds||0), p.goals||0,
    Object.entries(p.posSeconds||{}).map(([k,v])=>k+':'+fmtMin(v)).join('; ')].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(','));
  return head+lines.join('\n')+'\n';
}
/* Export all history — the complete backup / migration source (one
   file, every game, ALL data the app has). Three labelled sections;
   every row carries its game (date + score — two games can share a
   date, so the date alone never identifies one). The history import
   script reads this file back and reproduces the games exactly,
   including starting lineups and goal minutes — no manifest needed. */
function allHistoryCsv(){
  const teamLine='Team,'+csvCell(S.teamName)+'\n';
  const gamesHead='\nGames\nGame date,Our score,Their score,Match minutes,Played seconds,Starting lineup (GK;RB;LB;RM;CM;LM;ST)\n';
  const gamesRows=S.history.map(h=>{
    const lineup=(h.lineup||[]).map(i=>i==null?'':((h.players||[])[i]?h.players[i].name:'')).join('; ');
    return [isoDateOf(h), h.ourScore, h.theirScore, h.matchMinutes||S.settings.matchMinutes||50, h.playedSeconds||0, lineup].map(csvCell).join(',');
  }).join('\n');
  const playersHead='\nPlayers\nGame date,Our score,Their score,Player,Present,Actual minutes,GK minutes,Goals,Positions\n';
  const playerRows=[];
  S.history.forEach(h=>{
    (h.players||[]).forEach(p=>{
      playerRows.push([isoDateOf(h), h.ourScore, h.theirScore, p.name, p.present?'yes':'no',
        fmtMin(p.seconds), fmtMin(p.gkSeconds||0), p.goals||0,
        Object.entries(p.posSeconds||{}).map(([k,v])=>k+':'+fmtMin(v)).join('; ')].map(csvCell).join(','));
    });
  });
  const goalsHead='\nGoals\nGame date,Our score,Their score,Scorer,Minute,Side\n';
  const goalRows=[];
  S.history.forEach(h=>{
    goalRowsForCsv(h).forEach(r=>goalRows.push([isoDateOf(h), h.ourScore, h.theirScore, ...r]));
  });
  return teamLine+gamesHead+gamesRows+'\n'+playersHead+playerRows.join('\n')+'\n'+goalsHead
    +goalRows.map(r=>r.map(csvCell).join(',')).join('\n')+(goalRows.length?'\n':'');
}
/* Export roster — the roster backup / transfer file: every player
   with all roster state the app stores (name, availability, tired
   flag, all seven preferred positions, note). Minutes and goals are
   game data, not roster data, so they are not in this file. */
function rosterCsv(){
  const head='Player,Available,Tired,GK,RB,LB,RM,CM,LM,ST,Note\n';
  const lines=S.roster.map(r=>[
    r.name, r.present?'yes':'no', r.tired?'yes':'no',
    ...POSITIONS.map(p=>r.prefs.includes(p)?'yes':'no'),
    r.note||''].map(csvCell).join(','));
  return head+lines.join('\n')+'\n';
}
function downloadCsv(filename, text){
  const blob=new Blob([text],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}

/* ---------- Modals ---------- */
function openModal(html){ modalRoot.innerHTML='<div class="overlay" data-overlay><div class="sheet" role="dialog" aria-modal="true">'+html+'</div></div>'; }
function closeModal(){ modalRoot.innerHTML=''; confirmAction=null; }
/* In-page confirmation sheet — the app's only confirmation UI.
   Native dialogs are never used (they are blocked inside the Muse
   preview sandbox, and a sheet is better on a phone too). onConfirm
   runs only when the Confirm button is tapped; closing the sheet any
   other way cancels it. */
let confirmAction=null;
function openConfirm(opts){
  confirmAction=opts.onConfirm||null;
  openModal('<h2>'+esc(opts.title)+'</h2><p>'+esc(opts.body)+'</p>'
    +'<div class="pin-bottom"><button class="'+(opts.danger?'danger':'primary')+'" data-confirm-yes>'+esc(opts.confirmLabel||'Confirm')+'</button>'
    +'<button class="ghost" data-close>Cancel</button></div>');
}
let scorerMinute=null;
function openPlayerPicker(pos){
  const assigned=new Map(); S.lineup.forEach((p,i)=>{ if(p!=null) assigned.set(p, POSITIONS[i]); });
  const present=S.roster.map((r,i)=>i).filter(i=>S.roster[i].present);
  const prefFirst=present.filter(i=>S.roster[i].prefs.includes(POSITIONS[pos]));
  const others=present.filter(i=>!S.roster[i].prefs.includes(POSITIONS[pos]));
  const ordered=[...prefFirst, ...others];
  const rows=ordered.map(i=>{
    const a=assigned.get(i);
    return '<button data-pick="'+i+'" data-pos="'+pos+'">'+esc(S.roster[i].name)
      +(a?' <span class="sub">assigned: '+a+'</span>':'')
      +(!S.roster[i].prefs.includes(POSITIONS[pos])?' <span class="sub">outside preferred positions — allowed</span>':'')
      +'</button>';
  }).join('');
  openModal('<h2>'+POSITIONS[pos]+' — choose a player</h2><p class="muted">Preferences guide, never block. Anyone present can play any spot.</p>'
    +'<div class="picker-grid">'+rows+'</div>'
    +'<div class="pin-bottom"><button data-clear-spot="'+pos+'">Leave spot empty</button><button class="ghost" data-close>Cancel</button></div>');
}
function openScorerPicker(side){
  scorerMinute=Math.floor(S.elapsed/60);
  const idx=S.roster.map((r,i)=>i).filter(i=>S.roster[i].present)
    .sort((a,b)=>S.roster[a].name.localeCompare(S.roster[b].name));
  const half=Math.ceil(idx.length/2);
  const colMajor=[...idx.slice(0,half), ...idx.slice(half)]; // grid is 2-col; DOM order gives column-major reading
  const rows=colMajor.map(i=>{
    const pos=S.lineup.indexOf(i);
    return '<button data-scorer="'+i+'" data-side="'+side+'">'+esc(S.roster[i].name)
      +' &middot; '+(pos>=0?POSITIONS[pos]:'Bench')+'</button>';
  }).join('');
  openModal('<h2>Who scored?</h2>'
    +'<div class="stepper"><button data-step="-1" aria-label="One minute earlier">−</button>'
    +'<span class="min-val" id="scorer-min">'+scorerMinute+'′</span>'
    +'<button data-step="1" aria-label="One minute later">+</button></div>'
    +'<p class="muted" style="text-align:center">Goal minute — adjust before confirming.</p>'
    +'<div class="picker-grid">'+rows+'</div>'
    +'<div class="pin-bottom"><button data-scorer="-1" data-side="'+side+'">Own goal</button>'
    +'<button data-scorer="skip" data-side="'+side+'">Skip · no scorer</button>'
    +'<button class="ghost" data-close>Cancel</button></div>');
}
function openNoteEditor(i){
  openModal('<h2>Note — '+esc(S.roster[i].name)+'</h2><p class="muted">Private reminder. Notes are never shared.</p>'
    +'<textarea id="note-text">'+esc(S.roster[i].note||'')+'</textarea>'
    +'<div class="row" style="margin-top:8px"><button class="primary" data-save-note="'+i+'">Save note</button><button class="ghost" data-close>Cancel</button></div>');
}
function openMoreModal(i){
  const r=S.roster[i];
  // During a game the More sheet is just mark tired, leaving, note —
  // no position-preferences editing (that lives on the setup Roster
  // tab only), and no Rename either (same rule as the row button).
  const setupOnly = (S.screen === 'setup' && !S.editingLive);
  openModal('<h2>'+esc(r.name)+'</h2>'
    +'<div class="pin-bottom">'
    +'<button data-note="'+i+'">'+(r.note?'Edit note':'Add note')+'</button>'
    +'<button data-tired="'+i+'">'+(r.tired?'Untire':'Mark tired')+'</button>'
    +(setupOnly?'<button data-prefs="'+i+'">Position preferences</button>':'')
    +'<button class="danger" data-remove-player="'+i+'">Remove player</button>'
    +'<button class="ghost" data-close>Close</button></div>');
}
function openManagePreferred(){
  const ready=!!S.preferredLineup;
  openModal('<h2>Preferred lineup</h2><p class="muted">'
    +(ready?'A preferred starting lineup is saved with the roster.':'No preferred lineup saved yet — set a lineup on the field, then save it here.')
    +'</p><div class="pin-bottom">'
    +(ready?'<button data-use-preferred>Use preferred lineup</button>':'')
    +'<button data-save-preferred>Save current lineup as preferred</button>'
    +(ready?'<button class="danger" data-clear-preferred>Clear preferred lineup</button>':'')
    +'<button class="ghost" data-close>Close</button></div>');
}
function openHalftimePrefs(){
  const rows=S.roster.map((r,i)=>i).filter(i=>S.roster[i].present)
    .sort((a,b)=>S.roster[a].name.localeCompare(S.roster[b].name))
    .map(i=>'<div class="mrow"><span class="name">'+esc(S.roster[i].name)+'</span><span class="nums muted">'+S.roster[i].prefs.join(' &middot; ')+'</span></div>').join('');
  openModal('<h2>Position preferences</h2><p class="muted">Preferred positions per player. Preferences guide, never block.</p>'+rows+'<div class="pin-bottom"><button class="ghost" data-close>Close</button></div>');
}
function openPrefsEditor(i){
  const r=S.roster[i];
  const chips=POSITIONS.map(p=>'<button data-pref="'+p+'" data-player="'+i+'" aria-pressed="'+r.prefs.includes(p)+'">'+p+'</button>').join('');
  openModal('<h2>Positions — '+esc(r.name)+'</h2><p class="muted">Tap to toggle preferred positions.</p>'
    +'<div class="chips">'+chips+'</div><div class="row" style="margin-top:10px"><button class="ghost" data-close>Done</button></div>');
}
function openRenameEditor(i){
  const r=S.roster[i];
  openModal('<h2>Rename player</h2><p class="muted">Rename this player.</p>'
    +'<p><label>Name <input type="text" id="rename-text" value="'+esc(r.name)+'" maxlength="30"></label></p>'
    +'<div class="row" style="margin-top:8px"><button class="primary" data-save-rename="'+i+'">Save name</button><button class="ghost" data-close>Cancel</button></div>');
}
function openAddPlayerEditor(){
  openModal('<h2>Add player</h2><p class="muted">New players start with field positions preferred (no goalkeeper) — change them with Positions afterwards.</p>'
    +'<p><label>Name <input type="text" id="add-player-text" placeholder="Player name" maxlength="30"></label></p>'
    +'<div class="row" style="margin-top:8px"><button class="primary" data-save-add-player>Save player</button><button class="ghost" data-close>Cancel</button></div>');
}
function removePlayer(i){
  // No undo for a structural roster change: undo snapshots are
  // index-based, and removing a player shifts every later index.
  // Clear the stack instead of restoring the wrong players.
  S.undoStack=[];
  S.roster.splice(i,1);
  S.minutesSec.splice(i,1); S.gkSec.splice(i,1); S.posSec.splice(i,1);
  S.lineup=S.lineup.map(x=>x==null?null:(x===i?null:(x>i?x-1:x)));
  if(S.startingLineup) S.startingLineup=S.startingLineup.map(x=>x==null?null:(x===i?null:(x>i?x-1:x)));
  if(S.plannedLineup) S.plannedLineup=S.plannedLineup.map(x=>x==null?null:(x===i?null:(x>i?x-1:x)));
  closeModal(); render();
  saveRosterAuto();
}
function openShortChooser(){
  const opts=POSITIONS.map((p,i)=>S.removedPositions.includes(i)?'':'<button data-remove-pos="'+i+'">Remove '+p+'</button>').join('');
  openModal('<h2>Play short (6v7)</h2><p class="muted">Choose one field slot to remove. Minutes are preserved; the player comes off to the bench.</p>'
    +'<div class="picker-grid">'+opts+'</div><div class="pin-bottom"><button class="ghost" data-close>Cancel</button></div>');
}
function openEditGoalsLive(){
  if(!displayGoals(S.goals).length){ openModal('<h2>Edit goals</h2><p>No goals recorded yet in this game.</p><div class="pin-bottom"><button class="ghost" data-close>Close</button></div>'); return; }
  // THEM unknown goals render as '' (not a row): there is nobody on
  // our roster to assign an opponent goal to. gi stays the index into
  // S.goals, so the row buttons still address the right goal.
  const rows=S.goals.map((g,gi)=>(g.player==null && (g.side||'us')==='them')?'':'<div class="mrow"><span class="name">'+esc(goalLabel(g))+' ('+(g.side==='us'?'US':'THEM')+')</span>'
    +'<span class="nums">'
    +(g.player==null?'<button class="small" data-assign-live="'+gi+'">Assign…</button> ':'')
    +'<button class="small" data-goal-minus="'+gi+'">−1′</button> <button class="small" data-goal-plus="'+gi+'">+1′</button> '
    +'<button class="small danger" data-goal-del="'+gi+'">Remove</button></span></div>').join('');
  openModal('<h2>Edit goals — live game</h2>'+rows+'<div class="pin-bottom"><button class="ghost" data-close>Done</button></div>');
}

/* ---------- Screens ---------- */
function render(){
  // Login gate: when Supabase is configured and nobody is signed in,
  // show the entry screen (join a live game without signing in, or
  // sign in as a coach) — no match UI, no history, no roster behind
  // it, and no clock running. The one exception: a watcher who has
  // already joined a live game with its code keeps watching it
  // view-only, even without a sign-in. A watcher who taps "Sign in"
  // (S.showSignin) sees the sign-in form instead, and returns to the
  // live game after signing in.
  if (authGated()) {
    if (SB.viewerMode && !S.showSignin) { /* fall through: watch the shared view */ }
    else { mainEl.innerHTML = S.showSignin ? loginHtml() : entryHtml(); return; }
  }
  startClock();
  // Errors are the only top-of-screen message left: they report a
  // blocked action or a failed load, which nothing else on screen
  // shows. Routine confirmations (swap done, subs applied, queued,
  // saved, …) are gone entirely — the field, bench, queue and tabs
  // already show what happened, and a banner there pushed the whole
  // live screen down every time.
  const err=S.error?'<div class="error" role="alert">'+esc(S.error)+'</div>':'';
  S.error='';
  let html=err;
  // Supabase status banners (never block the game). Live updates
  // never use a banner: they apply immediately and show the small
  // "Updated" toast instead (see showToast) — a banner here pushed
  // the whole live screen down every time.
  if(SB.backendError) html+='<div class="error" role="alert">'+esc(SB.backendError)+'</div>';
  if(SB.offline) html+='<div class="error" role="alert">Offline — changes will sync when signal returns.</div>';
  // Anonymous watchers are strictly view-only: a banner with the way
  // in (sign in as a coach to make changes). Signed-in coaches never
  // see this banner — any coach can drive, no Take over.
  if(SB.viewerMode && !SB.authUser) html+='<div class="banner">View-only — you are watching the shared view.'
    +'<div class="row" style="margin-top:8px"><button data-share-viewer>Share this view</button><button data-goto-signin>Sign in as a coach to make changes</button></div></div>';
  // Driver: sync the live snapshot (debounced) after any render that
  // follows an action. Remote applies set SB.applyingRemote and skip;
  // a render right after applying a remote update skips the sync once
  // (SB.suppressSyncOnce) so the applied state is never written back.
  if (SB.suppressSyncOnce) SB.suppressSyncOnce = false;
  else if (SB.role==='driver' && SB.liveId && !SB.applyingRemote && !SB.offline && (S.screen==='live' || S.screen==='halftime')) scheduleLiveSync(false);
  if(S.screen==='viewer') html+=viewerHtml();
  else if(S.screen==='setup') html+=setupHtml();
  else if(S.screen==='review') html+=reviewHtml();
  else if(S.screen==='live') html+=liveHtml();
  else if(S.screen==='halftime') html+=halftimeHtml();
  else if(S.screen==='finished') html+=finishedHtml();
  mainEl.innerHTML=html;
  // Finished game opens scrolled to the top so the score is visible
  // right away (private app behaviour).
  if(S.screen==='finished'){ try{ window.scrollTo(0,0); }catch(e){} }
}
function setupHtml(){
  const lastBtn=S.lastLineup?'<button data-last-lineup>Use last game\u2019s lineup</button>':'';
  // Mid-game Edit lineup: this setup screen is the editor — "Return to
  // live" goes back without resetting the clock, score, goals, or
  // minutes. Fresh setup instead goes through Review & start.
  if (S.editingLive) {
    return '<section aria-label="Edit lineup">'
      +'<div class="field-wrap">'+fieldHtml({})+'</div>'
      +'<p class="muted" style="text-align:center">Tap a spot to choose a player</p>'
      +'<div class="row"><button data-auto>Auto-generate lineup</button><button data-refresh>Refresh lineup</button><button class="primary grow" data-back-live>Return to live game</button></div>'
      +'<details><summary>Attendance ('+S.roster.filter(r=>r.present).length+' present)</summary><div class="attend">'
      +S.roster.map((r,i)=>'<button data-attend="'+i+'" class="'+(r.present?'':'absent')+'">'+esc(r.name)+(r.present?'':' — absent')+'</button>').join('')
      +'</div><p class="muted">Marking a bench player absent leaves the starting seven untouched. Marking a starter absent clears only their spot.</p></details>'
      +'<details><summary>Team &amp; positions</summary>'
      +((rosterSourceLabel()||SB.rosterError)?'<p class="muted">'+esc(rosterSourceLabel())+(SB.rosterError?' '+esc(SB.rosterError):'')+'</p>':'')
      +teamRowsHtml()
      +'<div class="row"><button data-add-player>Add player</button>'
      +(SB.configured && SB.authUser?'<button data-save-roster>Save roster</button>':'')
      +'</div></details>'
      +'</section>';
  }
  const tabs=[['lineup','Lineup'],['roster','Roster'],['settings','Settings'],['history','History']];
  let body='';
  if(S.setupTab==='lineup'){
    const bench=S.roster.map((r,i)=>i).filter(i=>!S.lineup.includes(i)&&S.roster[i].present);
    // Same completeness rule as Start: Review & start is disabled
    // (visibly, not just refusing on tap) until every required spot
    // is filled — all 7, or the 6 remaining in short mode. The hint
    // names the empty spots so the coach knows what is missing.
    const emptyReview = emptySpotsLabel();
    body='<div class="card"><h3>Join a live game</h3><p class="muted">Enter the 4-letter game code from the driver\u2019s phone.</p>'
      +'<div class="row"><input type="text" id="join-code" placeholder="Game code" maxlength="4" autocapitalize="characters" autocomplete="off" style="width:110px;text-transform:uppercase"><button class="primary" data-join-live>Join live game</button></div></div>'
      +'<div class="card"><div class="row spread"><span><strong>Preferred lineup</strong> <span class="muted">&middot; '+(S.preferredLineup?'Ready':'Not set')+'</span></span><button class="small" data-manage-preferred>Manage</button></div>'
      +(lastBtn?'<div class="row" style="margin-top:8px">'+lastBtn+'</div>':'')
      +'</div>'
      +'<div class="row"><button class="primary grow" data-auto>Refresh lineup</button><button class="primary grow" data-review'+(emptyReview?' disabled':'')+'>Review &amp; start</button><button class="ghost small" data-clear-lineup>Clear</button></div>'
      +(emptyReview?'<p class="muted">Fill '+esc(emptyReview)+' to review &amp; start.</p>':'')
      +'<div class="field-wrap">'+fieldHtml({})+'</div>'
      +'<p class="muted" style="text-align:center">Tap a spot to choose a player</p>'
      +'<p class="muted"><strong>OPENING BENCH</strong> &mdash; '+(bench.length?bench.map(i=>esc(S.roster[i].name)).join(', '):'none')+'</p>';
  } else if(S.setupTab==='roster'){
    body='<h2>Attendance &amp; positions</h2><p class="muted">Tap positions to toggle &middot; keep at least one</p>'
      +((rosterSourceLabel()||SB.rosterError)?'<p class="muted">'+esc(rosterSourceLabel())+(SB.rosterError?' '+esc(SB.rosterError):'')+'</p>':'')
      +teamRowsHtml()
      +'<div class="row"><button data-add-player>Add player</button><button data-export-roster>Export roster</button>'
      +(SB.configured && SB.authUser?'<button data-save-roster>Save roster</button>':'')
      +'</div>'
      +'<p class="muted">Notes are private.</p>';
  } else if(S.setupTab==='settings'){
    body='<h2>Match settings</h2>'
      +'<div class="card">'
      +'<p><label>Match minutes <input type="number" data-setting="matchMinutes" value="'+S.settings.matchMinutes+'" min="10" max="120"></label></p>'
      +'<p><label>Substitution cadence (min) <input type="number" data-setting="cadence" value="'+S.settings.cadence+'" min="1" max="30"></label></p>'
      +'<p><label>Subs per rotation <input type="number" data-setting="subsPerRotation" value="'+S.settings.subsPerRotation+'" min="1" max="6"></label></p>'
      +'<p><label>Fair-time threshold (min) <input type="number" data-setting="fairTimeThreshold" value="'+S.settings.fairTimeThreshold+'" min="1" max="20"></label></p>'
      +'<p><label><input type="checkbox" data-setting-check="countGoalieTime" '+(S.settings.countGoalieTime?'checked':'')+'> Count goalie time toward total game time</label><br><span class="muted">Off by default: totals count only non-goalie minutes. Goalie minutes are still tracked and shown.</span></p>'
      +'<p><label>Team name <input type="text" data-setting-text="teamName" value="'+esc(S.teamName)+'"></label></p>'
      +(SB.authUser?'<p class="muted">Signed in as '+esc(SB.authUser.email||'coach')+'</p><div class="row"><button class="ghost" data-signout>Sign out</button></div>':'')
      +'</div>'
      +viewerShareHtml();
  } else {
    body=historyHtml();
  }
  // The active-game note sits above the tabs, one line per live game
  // with a Join button — compact, and only there when a game is
  // actually running. It never appears mid-game (Edit lineup) or
  // for the game the coach is already in.
  const activeNote = (!S.editingLive) ? activeGamesHtml() : '';
  return '<section aria-label="Setup">'
    +activeNote
    +'<div class="team-head"><h2>\uD83D\uDD25\u26BD '+esc(S.teamName)+'</h2></div>'
    +'<div class="tabs" role="tablist">'+tabs.map(([k,label])=>'<button role="tab" aria-selected="'+(S.setupTab===k)+'" data-setup-tab="'+k+'">'+label+'</button>').join('')+'</div>'
    +body
    +'</section>';
}
/* Required field spots for starting: every position except ones
   removed by Play short (6v7). A 7v7 game needs all 7 filled; a
   short game needs its 6 remaining spots. A game must never start
   with an empty spot — the coach fills it, the app never auto-fills. */
function emptySpots(){
  const removed = new Set(S.removedPositions || []);
  return POSITIONS.map((p, i) => i).filter(i => !removed.has(i) && (S.lineup || [])[i] == null);
}
function emptySpotsLabel(){
  const names = emptySpots().map(i => POSITIONS[i]);
  if (!names.length) return '';
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}
function reviewHtml(){
  const empty = emptySpotsLabel();
  return '<section aria-label="Kickoff review"><h2>Kickoff review</h2><p class="muted">Check the field and bench, then start the clock.</p>'
    +(empty?'<p class="error" role="alert">Fill '+esc(empty)+' to start. Go back to setup and tap an empty spot to choose a player.</p>':'')
    +'<div class="field-wrap">'+fieldHtml({readonly:true})+'</div>'
    +'<h3>Bench</h3>'+benchHtml()
    +'<div class="row"><button class="primary grow" data-start-game'+(empty?' disabled':'')+'>Start game</button><button data-back-setup>Back to setup</button></div></section>';
}
function liveHtml(){
  // Viewers (signed-in coaches and anonymous code-joined watchers
  // alike) get a History tab on the live screen: it is the only way
  // an anonymous watcher can see history, since they have no setup
  // screen. It is read-only — the viewer edit gate blocks every
  // export / edit-goals button inside it, and anonymous watchers
  // additionally cannot download CSVs.
  const tabs=[['actions','Actions'],['minutes','Minutes'],['team','Team']];
  if (SB.role === 'viewer' && SB.liveId) tabs.push(['history','History']);
  let body='';
  if(S.liveTab==='history'){
    body='<h2>History</h2>'+historyHtml();
  } else if(S.liveTab==='actions'){
    // Layout stability: the scoreboard, tabs, field, bench and Apply
    // never move as actions are taken. Field chips and bench buttons
    // have fixed heights with their incoming-player lines always
    // rendered (empty when absent), so queueing a sub cannot grow
    // them. The Swap/Cancel buttons live inside the field as an
    // absolute overlay in its bottom-right corner — zero vertical
    // space. The Apply button lives in a fixed-height slot under the
    // bench (empty when nothing is queued). No banner or hint is ever
    // inserted between the field and the bench: the selected chips
    // already show a staged swap, and the queue list below Apply
    // already shows a queued sub.
    body='<div class="field-wrap">'+fieldHtml({showMinutes:true, live:true, swapOverlay:S.swapPair.length===2&&!S.queue.length})+'</div>'
      +'<div class="bench-head"><h3>Bench</h3><span class="muted small">'+(S.selection&&S.selection.kind==='in'?esc(S.roster[S.selection.player].name)+' selected &middot; tap a field player to sub them on':(S.queue.length?S.queue.length+' queued &middot; tap field or bench to add another':'tap a player to start a sub'))+'</span></div>'+benchHtml()
      +'<div class="apply-slot">'
      +(S.queue.length?'<button class="apply" data-apply>Apply '+S.queue.length+' now</button>':'')
      +'</div>'
      +'<div class="queue-area">'
      +(S.queue.length
        ? '<h3>Next change</h3><p class="muted">'+S.queue.length+' ready &middot; <button class="small ghost" data-clear-queue>Clear</button></p>'
          +S.queue.map((q,qi)=>'<div class="queue-item"><span class="q-num">'+(qi+1)+'</span><span>\u2193 '+esc(S.roster[q.out].name)+' ('+POSITIONS[q.pos]+')</span><span class="arrow">\u2192</span><span>\u2191 '+esc(S.roster[q.in].name)+'</span><button class="small" data-unqueue="'+qi+'">Remove</button></div>').join('')
          +'<div class="row"><button data-suggest>Suggest rotation</button></div>'
        :'<p class="muted">No substitutions queued. Tap a field player, then a bench player — or a bench player first, then a field player.</p><div class="row"><button data-suggest>Suggest rotation</button></div>')
      +'</div>'
      +'<div class="row actions-row"><button data-edit-lineup>Edit lineup</button>'
      +(S.shortMode?'<button data-full-strength>Return to full strength (7v7)</button>':'<button data-play-short>Play short (6v7)</button>')
      +'<button data-edit-goals>Edit goals</button></div>';
  } else if(S.liveTab==='minutes'){
    body='<h2>Minutes — actual &amp; projected</h2><p class="muted">Fair share: '+fmtMin(fairShareSec())+' min &middot; threshold \u00b1'+S.settings.fairTimeThreshold+' min &middot; '+(S.settings.countGoalieTime?'goalie time counts':'goalie time excluded from totals')+'.</p>'
      +'<div id="live-minutes-inline">'+minutesRowsHtml()+'</div>'
      +'<h3>Goals</h3>'+(displayGoals(S.goals).length?displayGoals(S.goals).map(g=>'<p>'+esc(goalLabel(g))+' ('+(g.side==='us'?'US':'THEM')+')</p>').join(''):'<p class="muted">No goals yet.</p>')
      +'<div class="row"><button data-edit-goals>Edit goals</button></div>';
  } else if(S.liveTab==='team'){
    body='<h2>Team — player status</h2><p class="muted">Alphabetical. Notes are private.</p>'+teamRowsHtml()
      +'<h3>Starting lineup (read-only)</h3><div class="field-wrap" style="position:static">'+fieldHtml({readonly:true})+'</div>';
  }
  // Top row: only the contextual Undo link. Halftime / End game
  // moved to large buttons at the bottom of the live screen
  // (Robin's call, Nov 2026 — the small text links under the
  // scoreboard were too small to tap), and Shut down lives only on
  // the landing screen, never in the game view. The row renders
  // only when it has something in it, so it never leaves a gap.
  const topLinks = [];
  if (S.undoStack.length) topLinks.push('<button class="linklike" data-undo>Undo '+esc(S.undoStack[S.undoStack.length-1].label)+'</button>');
  const gameActions = topLinks.length ? '<div class="game-actions">'+topLinks.join('<span aria-hidden="true">&middot;</span>')+'</div>' : '';
  return '<section aria-label="Live game">'
    +'<div class="scoreboard"><div class="score-row">'
    +'<div class="side"><button data-score="us-minus" aria-label="US minus">−</button><div class="score-col"><span class="team-label">US</span><span class="score-num">'+S.ourScore+'</span></div><button data-score="us-plus" aria-label="US plus">+</button></div>'
    +'<div class="clock-mid"><div class="clock" id="clock">'+fmtClock(S.elapsed)+'</div><div class="clock-controls"><button class="pill" data-plus2>+2:00</button><button class="pill pause" data-pause>'+(S.running?'\u275a\u275a PAUSE':'RESUME')+'</button></div></div>'
    +'<div class="side"><button data-score="them-minus" aria-label="Them minus">−</button><div class="score-col"><span class="team-label">THEM</span><span class="score-num">'+S.theirScore+'</span></div><button data-score="them-plus" aria-label="Them plus">+</button></div>'
    +'</div></div>'
    +gameActions
    +'<div class="tabs" role="tablist">'+tabs.map(([k,label])=>'<button role="tab" aria-selected="'+(S.liveTab===k)+'" data-tab="'+k+'">'+label+'</button>').join('')+'</div>'
    +body
    // Game flow, bottom of the screen: proper large tap targets.
    +'<div class="row" style="margin-top:12px"><button class="primary grow" data-halftime>Halftime</button><button class="grow" data-end>End game</button></div>'
    +(SB.role==='driver'&&SB.liveId?'<p class="muted small" style="text-align:center">Game code <strong>'+esc(SB.liveCode)+'</strong> — the other coach enters this code on setup to join.</p>':'')
    +'</section>';
}
function halftimeHtml(){
  const halfBoundary=S.settings.matchMinutes*30;
  const snapNeeded=S.elapsed!==halfBoundary;
  if(!S.plannedLineup) S.plannedLineup=autoLineup(true);
  const firstHalf=S.roster.map((r,i)=>i).filter(i=>S.roster[i].present)
    .sort((a,b)=>totalSec(a)-totalSec(b))
    .map(i=>'<div class="mrow"><span class="name">'+esc(S.roster[i].name)+'</span><span class="nums">'+fmtMin(totalSec(i))+' min</span></div>').join('');
  const filled=S.plannedLineup.filter(x=>x!=null).length;
  return '<section aria-label="Halftime planner" class="halftime-head"><span class="badge-pill">HALFTIME</span>'
    +'<h2>Reset the balance.</h2>'
    +'<p class="muted">The suggestion favors players with fewer first-half minutes, then maps the next rotation.</p>'
    +'<div class="two-col">'+firstHalf+'</div>'
    +'<div class="row"><button data-halftime-prefs>Position preferences</button></div>'
    +'<div class="row" style="margin-top:8px"><button class="primary grow" data-plan-refresh>Refresh lineup</button><span class="muted">Lineup '+(S.planCount||1)+'</span></div>'
    +'<h3>Second-half '+(S.shortMode?'6v7':'7v7')+' lineup</h3><p class="muted">'+filled+'/'+fieldCount()+' filled &middot; tap a player to change</p>'
    +'<div class="field-wrap" style="position:static">'
    + (function(){ const keep=S.lineup; S.lineup=S.plannedLineup; const h=fieldHtml({}); S.lineup=keep; return h; })()
    +'</div>'
    +'<div class="row"><button class="primary grow" data-start-second>Start second half</button>'
    +(snapNeeded?'<button data-snap-clock>Set clock to '+fmtClock(halfBoundary)+'</button>':'')
    +'<button data-back-live>Back to live (no change)</button></div></section>';
}
function finishedHtml(){
  const last=S.history[S.history.length-1];
  if(!last) return '<p>No finished game yet.</p>';
  const keep=S.lineup; S.lineup=last.lineup; const field=fieldHtml({readonly:true}); S.lineup=keep;
  return '<section aria-label="Finished game"><h2>Full time — US '+last.ourScore+' – '+last.theirScore+' THEM</h2>'
    +(S.saveNote?'<p class="muted">'+esc(S.saveNote)+'</p>':'')
    +'<div class="field-wrap" style="position:static">'+field+'</div>'
    +'<p>'+(displayGoals(last.goals).length?'Scorers: '+displayGoals(last.goals).map(g=>goalLabel(g, last.players)).join(', '):'No goals recorded.')+'</p>'
    +'<div class="row"><button class="primary" data-close-history>Close and view history</button><button data-csv-last>Download CSV</button><button data-editgoals-last>Edit goals</button></div>'
    +'<div class="row"><button data-new-game>Start new game</button><button class="danger" data-discard-game>Discard this game</button></div>'
    +'<h3>Minutes</h3>'+last.players.map(p=>'<div class="mrow"><span class="name">'+esc(p.name)+'</span><span class="nums">'+fmtMin(p.seconds)+' min'+(p.gkSeconds?' (GK '+fmtMin(p.gkSeconds)+')':'')+(p.goals?' ⚽ '+p.goals:'')+'</span></div>').join('')
    +'<h3>History</h3>'+historyHtml()+'</section>';
}
/* ---------- Game actions ---------- */
function suggestRotation(){
  const tiredOn=onField().filter(x=>S.roster[x.player].tired);
  const lowBench=benchPlayers().sort((a,b)=>totalSec(a)-totalSec(b));
  const outPool=tiredOn.length?tiredOn:onField().sort((a,b)=>totalSec(b.player)-totalSec(a.player)).slice(0,S.settings.subsPerRotation);
  const n=Math.min(S.settings.subsPerRotation, outPool.length, lowBench.length);
  S.queue=[];
  for(let i=0;i<n;i++) S.queue.push({out:outPool[i].player, in:lowBench[i], pos:outPool[i].pos});
  render();
}
function applyQueue(){
  if(!S.queue.length) return;
  pushUndo('apply subs');
  for(const q of S.queue){ placeOnField(S.lineup, q.pos, q.in); }
  S.queue=[]; S.selection=null;
  render();
}
function doSwap(){
  if(S.swapPair.length!==2) return;
  pushUndo('swap');
  const [a,b]=S.swapPair;
  const tmp=S.lineup[a]; S.lineup[a]=S.lineup[b]; S.lineup[b]=tmp;
  S.swapPair=[]; S.selection=null;
  render();
}
function recordGoal(side, player){
  pushUndo('goal');
  // "Skip · no scorer" still records the goal — as an unknown scorer
  // with the current minute — so the goal list always matches the
  // score. It is attributed to nobody until someone assigns it.
  S.goals.push({player: player==='skip'?null:player, seconds: scorerMinute*60, side});
  if(side==='us') S.ourScore+=1; else S.theirScore+=1;
  closeModal(); render();
}
async function finishGame(){
  S.running=false;
  const players=S.roster.map((r,i)=>({
    name:r.name, present:r.present, seconds:totalSec(i), gkSeconds:S.gkSec[i],
    goals:goalsFor(i), posSeconds:S.posSec[i],
  }));
  const game={date:new Date().toLocaleDateString(), dateISO:new Date().toISOString().slice(0,10), teamName:S.teamName,
    ourScore:S.ourScore, theirScore:S.theirScore, lineup:[...(S.startingLineup||S.lineup)],
    players, goals:[...S.goals], playedSeconds:S.elapsed, matchMinutes:S.settings.matchMinutes};
  S.history.push(game);
  // "Use last game's lineup" loads the previous completed game's
  // STARTING lineup, not the end-of-game lineup.
  S.lastLineup=[...(S.startingLineup||S.lineup)];
  S.screen='finished';
  render();
  replaceUrl(homeUrl()); // the game is over — its ?game= URL is stale
  // Durable record first: history insert, then mark the live row finished.
  await saveHistoryGame(game);
  await finishLiveGame();
  if(game.backendId) S.saveNote='Game saved to history.';
  else if(SB.configured) S.saveNote='Game saved on this device only — download the CSV as a backup.';
  render();
}
function startNewGame(){
  const keepHistory=S.history, keepLast=S.lastLineup, keepPref=S.preferredLineup;
  const keepTeam=S.teamName, keepSettings={...S.settings};
  const roster=S.roster.map(r=>({...r, tired:false}));
  resetLiveSession();
  S=freshState();
  S.history=keepHistory; S.lastLineup=keepLast; S.preferredLineup=keepPref; S.roster=roster;
  S.teamName=keepTeam; S.settings=keepSettings;
  S.screen='setup'; S.setupTab='lineup';
  render();
}
/* "Close and view history" (private finished screen): back to setup
   with history, roster, settings, team name, and setup lineup edits
   preserved — only the short-handed flags are cleared, so setup
   always opens at full strength. */
function closeFinishedGame(){
  // An anonymous watcher has no setup screen to go back to (it would
  // expose the Roster / Settings / History setup tabs), so closing
  // leaves the live game and returns to the entry screen instead.
  if (SB.viewerMode && !SB.authUser) { leaveLiveGame(); return; }
  S.removedPositions=[]; S.shortMode=false; S.editingLive=false;
  S.screen='setup'; S.setupTab='history';
  render();
}
/* Leave a live game entirely (anonymous watcher): stop listening,
   drop the live session and the in-memory game state, back to the
   entry screen. Nothing is written — a watcher never writes. */
function leaveLiveGame(){
  unsubscribeLive();
  resetLiveSession();
  S = freshState();
  SB.historyLoaded = false; SB.historyError = '';
  render();
}
async function discardFinishedGame(){
  const last=S.history[S.history.length-1];
  if(!last) return;
  openConfirm({title:'Discard this game?', body:'It will be removed from history. Roster, settings, and earlier games are kept.', confirmLabel:'Discard game', danger:true, onConfirm:async ()=>{
    await discardHistoryGame(last);
    // The discarded game's lineup must not be offered as "last lineup".
    S.lastLineup = S.history.length && S.history[S.history.length-1].lineup
      ? [...S.history[S.history.length-1].lineup] : null;
    startNewGame();
  }});
}
function startSecondHalf(){
  if(S.plannedLineup){
    pushUndo('halftime plan');
    S.lineup=dedupeLineup([...S.plannedLineup]);
    S.plannedLineup=null;
  }
  S.halftimeDone=true; S.screen='live'; S.liveTab='actions'; S.running=true;
  render();
}

/* ---------- Events (delegation) ---------- */
document.addEventListener('click', async (e)=>{
  const t=e.target.closest('[data-spot],[data-bench],[data-tab],[data-pick],[data-scorer],[data-step],[data-close],[data-clear-spot],[data-save-note],[data-pref],[data-remove-pos],[data-goal-minus],[data-goal-plus],[data-goal-del],[data-tired],[data-note],[data-prefs],[data-rename],[data-save-rename],[data-add-player],[data-save-add-player],[data-remove-player],[data-save-roster],[data-attend],[data-unqueue],[data-csv],[data-editgoals],[data-auto],[data-refresh],[data-review],[data-back-setup],[data-start-game],[data-pause],[data-plus2],[data-halftime],[data-end],[data-shutdown-game],[data-undo],[data-apply],[data-clear-queue],[data-suggest],[data-edit-lineup],[data-play-short],[data-full-strength],[data-edit-goals],[data-do-swap],[data-plan-refresh],[data-plan-use],[data-start-second],[data-snap-clock],[data-back-live],[data-goto-signin],[data-join-viewer],[data-join-viewer-game],[data-share-viewer],[data-join-active],[data-gen-viewer-link],[data-copy-viewer-link],[data-leave-live],[data-new-game],[data-csv-last],[data-editgoals-last],[data-confirm-yes],[data-last-lineup],[data-use-preferred],[data-save-preferred],[data-score],[data-signin],[data-signout],[data-close-history],[data-discard-game],[data-leaving],[data-arrived],[data-setup-tab],[data-details],[data-season-csv],[data-all-history-csv],[data-export-roster],[data-clear-lineup],[data-clear-preferred],[data-manage-preferred],[data-more],[data-pref-inline],[data-halftime-prefs],[data-join-live]');
  if(!t) return;
  const d=t.dataset;

  // Auth actions come first — they are allowed even on the login
  // screen and for a view-only phone.
  if(d.signout!==undefined){ await signOutUser(); return; }
  if(d.signin!==undefined){
    const email=(($('#auth-email')||{}).value||'').trim();
    const password=(($('#auth-password')||{}).value||'');
    if(!email || !password){ SB.authError='Enter your email and password.'; render(); return; }
    const ok=await signInWithPassword(email, password);
    if(ok){ await enterApp(); }
    return;
  }

  // Anonymous watchers are strictly view-only: block every edit
  // action. Allowed: switching tabs, closing modals, viewing history
  // details, leaving the shared view, and going to sign in (sign-in
  // is how a watcher gets edit controls). Signed-in coaches are
  // never gated — any coach can drive, no Take over.
  if(SB.viewerMode && !SB.authUser){
    // Share and Join are read-only, so a watcher may use them;
    // generating/revoking codes is not in this list — only a
    // signed-in coach gets those controls (and the handler below).
    const allowed = new Set(['tab','close','confirmYes','joinViewer','joinViewerGame','shareViewer','details','backSetup','closeHistory','leaveLive','gotoSignin']);
    const keys=Object.keys(d);
    if(keys.length && !keys.some(k=>allowed.has(k))){
      S.error='View-only — sign in as a coach to make changes.';
      render(); return;
    }
  }
  if(d.gotoSignin!==undefined){ S.showSignin=true; render(); return; }
  if(d.leaveLive!==undefined){ const home = homeUrl(); leaveLiveGame(); pushUrl(home); return; }
  // Share onward: copies the URL in the address bar — the deep link
  // for the game open right now (?view=CODE&game=...), or ?view=CODE
  // on the viewer home. Same shape as the coach's URL, so pasting it
  // into a text lands the next person in the same game as a viewer.
  // No new code, nothing revoked — viewers cannot generate or revoke codes.
  if(d.shareViewer!==undefined){
    let url = '';
    try { url = window.location.href; } catch (e) {}
    if (url) { await copyText(url); showToast('Link copied'); }
    else if (SB.viewerJoinedCode) { await copyText(viewerLinkUrl(SB.viewerJoinedCode)); showToast('Link copied'); }
    return;
  }
  if(d.joinViewerGame!==undefined){ joinViewerGame(d.joinViewerGame); return; }
  if(d.genViewerLink!==undefined){ await generateViewerCode(); return; }
  if(d.copyViewerLink!==undefined){
    if (SB.viewerCode) { await copyText(viewerLinkUrl(SB.viewerCode)); showToast('Link copied'); }
    return;
  }

  if(d.close!==undefined){ closeModal(); return; }
  if(d.confirmYes!==undefined){
    const fn=confirmAction; confirmAction=null; closeModal();
    if(fn) await fn();
    return;
  }
  if(d.joinViewer!==undefined){
    const code=((($('#join-code')||{}).value||'').trim().toUpperCase());
    if(!code){ S.error='Enter the 4-letter view code first.'; render(); return; }
    await joinViewerCode(code); return;
  }
  if(d.joinLive!==undefined){
    const code=((($('#join-code')||{}).value||'').trim().toUpperCase());
    if(!code){ S.error='Enter the 4-letter game code first.'; render(); return; }
    await joinLiveGame(code); return;
  }
  if(d.joinActive!==undefined){
    const row=(SB.activeGames||[]).find(g=>g && g.id===d.joinActive);
    if(!row){ S.error='That live game is no longer available.'; render(); return; }
    await joinActiveGame(row); return;
  }
  if(d.spot!==undefined){
    const pos=+d.spot;
    if(S.screen==='halftime'){ openPlayerPicker(pos); return; }
    if(S.screen==='setup'){ openPlayerPicker(pos); return; }
    if(S.screen==='live'){
      if(S.removedPositions.includes(pos)){ pushUndo('restore position'); S.removedPositions=S.removedPositions.filter(x=>x!==pos); S.shortMode=S.removedPositions.length>0; render(); return; }
      const player=S.lineup[pos];
      if(player==null){ openPlayerPicker(pos); return; }
      handleFieldTap(pos, player); return;
    }
    return;
  }
  if(d.bench!==undefined){
    const i=+d.bench;
    if(S.screen==='live'){ handleBenchTap(i); return; }
    return;
  }
  if(d.pick!==undefined){
    const i=+d.pick, pos=+d.pos;
    if(S.screen==='halftime'){ placeOnField(S.plannedLineup, pos, i); }
    else { pushUndo('lineup edit'); placeOnField(S.lineup, pos, i); S.removedPositions=S.removedPositions.filter(x=>x!==pos); }
    closeModal(); render(); return;
  }
  if(d.clearSpot!==undefined){
    const pos=+d.clearSpot;
    if(S.screen==='halftime') S.plannedLineup[pos]=null; else { pushUndo('lineup edit'); S.lineup[pos]=null; }
    closeModal(); render(); return;
  }
  if(d.scorer!==undefined){
    const side=d.side;
    if(d.scorer==='skip'){ recordGoal(side,'skip'); return; }
    recordGoal(side, +d.scorer); return;
  }
  if(d.step!==undefined){
    scorerMinute=Math.max(0, Math.min(S.settings.matchMinutes, scorerMinute+ (+d.step)));
    const el=$('#scorer-min'); if(el) el.textContent=scorerMinute+'′';
    return;
  }
  if(d.saveNote!==undefined){
    const i=+d.saveNote; S.roster[i].note=($('#note-text')||{}).value||''; closeModal(); render(); return;
  }
  if(d.pref!==undefined){
    const i=+d.player, p=d.pref, r=S.roster[i];
    r.prefs=r.prefs.includes(p)?r.prefs.filter(x=>x!==p):[...r.prefs,p];
    openPrefsEditor(i); render(); saveRosterAuto(); return;
  }
  if(d.note!==undefined){ openNoteEditor(+d.note); return; }
  if(d.prefInline!==undefined){
    const i=+d.player, pp=d.prefInline, r=S.roster[i];
    if(r.prefs.includes(pp)){
      if(r.prefs.length<=1){ S.error='Keep at least one preferred position.'; render(); return; }
      r.prefs=r.prefs.filter(x=>x!==pp);
    } else r.prefs=[...r.prefs,pp];
    render(); saveRosterAuto(); return;
  }
  if(d.prefs!==undefined){ openPrefsEditor(+d.prefs); return; }
  if(d.rename!==undefined){ openRenameEditor(+d.rename); return; }
  if(d.saveRename!==undefined){
    const i=+d.saveRename, name=(($('#rename-text')||{}).value||'').trim();
    if(!name){ S.error='Enter a name first.'; render(); return; }
    S.roster[i].name=name; closeModal(); render(); saveRosterAuto(); return;
  }
  if(d.addPlayer!==undefined){ openAddPlayerEditor(); return; }
  if(d.saveAddPlayer!==undefined){
    const name=(($('#add-player-text')||{}).value||'').trim();
    if(!name){ S.error='Enter a name first.'; render(); return; }
    S.roster.push({name, prefs:['ST','RM','CM','LM','RB','LB'], present:true, tired:false, note:''});
    S.minutesSec.push(0); S.gkSec.push(0); S.posSec.push({});
    closeModal(); render(); saveRosterAuto(); return;
  }
  if(d.removePlayer!==undefined){
    const i=+d.removePlayer;
    openConfirm({title:'Remove '+S.roster[i].name+'?', body:'Their minutes and any lineup spot are cleared.', confirmLabel:'Remove player', danger:true, onConfirm:()=>{ removePlayer(i); }});
    return;
  }
  if(d.saveRoster!==undefined){
    const ok=await saveRosterToBackend();
    if(!ok) S.error='Could not save the roster — try again.';
    render(); return;
  }
  if(d.tired!==undefined){
    const i=+d.tired; S.roster[i].tired=!S.roster[i].tired; closeModal(); render(); return;
  }
  if(d.attend!==undefined){
    const i=+d.attend; S.roster[i].present=!S.roster[i].present;
    if(!S.roster[i].present){
      const pos=S.lineup.indexOf(i);
      if(pos>=0) S.lineup[pos]=null; // only the absent starter's spot clears
    }
    render(); return;
  }
  if(d.tab!==undefined){ S.liveTab=d.tab; render(); return; }
  if(d.setupTab!==undefined){ S.setupTab=d.setupTab; render(); return; }
  if(d.details!==undefined){ const hi=+d.details; S.expandedHistory[hi]=!S.expandedHistory[hi]; render(); return; }
  if(d.seasonCsv!==undefined){ downloadCsv('full-season.csv', seasonCsv()); return; }
  if(d.allHistoryCsv!==undefined){ downloadCsv('all-history.csv', allHistoryCsv()); return; }
  if(d.exportRoster!==undefined){ downloadCsv('roster.csv', rosterCsv()); return; }
  if(d.clearLineup!==undefined){ S.lineup=[null,null,null,null,null,null,null]; S.removedPositions=[]; S.shortMode=false; render(); return; }
  if(d.managePreferred!==undefined){ openManagePreferred(); return; }
  if(d.clearPreferred!==undefined){
    S.preferredLineup=null; closeModal();
    render(); saveRosterAuto(); return;
  }
  if(d.more!==undefined){ openMoreModal(+d.more); return; }
  if(d.halftimePrefs!==undefined){ openHalftimePrefs(); return; }
  if(d.unqueue!==undefined){ S.queue.splice(+d.unqueue,1); render(); return; }
  if(d.clearQueue!==undefined){ S.queue=[]; S.selection=null; render(); return; }
  if(d.apply!==undefined){ applyQueue(); return; }
  if(d.suggest!==undefined){ suggestRotation(); return; }
  if(d.doSwap!==undefined){ doSwap(); return; }
  if(d.auto!==undefined){ S.lineup=autoLineup(false); S.removedPositions=[]; S.shortMode=false; render(); return; }
  if(d.refresh!==undefined){ S.lineup=autoLineup(false); S.removedPositions=[]; S.shortMode=false; render(); return; }
  if(d.review!==undefined){
    // Defence in depth for the disabled button: the review screen
    // is only reachable with a complete lineup. The setup screen
    // disables Review & start and names the empty spots; a tap that
    // somehow gets through (stale render, keyboard) stays on setup
    // with the same message instead of opening review with holes.
    const empty = emptySpotsLabel();
    if (empty) { S.error='Fill '+empty+' to review & start.'; render(); return; }
    S.screen='review'; render(); return;
  }
  if(d.backSetup!==undefined){
    // An anonymous watcher has no setup screen to go back to (it
    // would expose the Roster / Settings tabs), so this leaves the
    // live game and returns to the entry screen instead.
    if (SB.viewerMode && !SB.authUser) { leaveLiveGame(); return; }
    S.screen='setup'; S.editingLive=false; render(); return;
  }
  if(d.closeHistory!==undefined){ const home = homeUrl(); closeFinishedGame(); pushUrl(home); return; }
  if(d.discardGame!==undefined){ discardFinishedGame(); return; }
  if(d.leaving!==undefined){
    const i=+d.leaving; closeModal(); pushUndo('player leaving');
    S.roster[i].present=false;
    const pos=S.lineup.indexOf(i);
    if(pos>=0) S.lineup[pos]=null; // departing player keeps minutes; spot can be filled from the bench
    render(); return;
  }
  if(d.arrived!==undefined){
    const i=+d.arrived; closeModal();
    S.roster[i].present=true;
    render(); return;
  }
  if(d.startGame!==undefined){
    // Guard (the review screen also disables the button): a game
    // never starts with an empty required spot.
    const empty = emptySpotsLabel();
    if (empty) { S.error='Fill '+empty+' to start.'; S.screen='review'; render(); return; }
    S.screen='live'; S.liveTab='actions'; S.elapsed=0; S.running=true;
    S.minutesSec=Array(S.roster.length).fill(0); S.gkSec=Array(S.roster.length).fill(0);
    S.posSec=Array.from({length:S.roster.length},()=>({})); S.goals=[]; S.queue=[]; S.ourScore=0; S.theirScore=0;
    S.undoStack=[]; S.halftimeDone=false; S.plannedLineup=null;
    S.startingLineup=[...S.lineup];
    render();
    // Driver: create the live row (fire-and-forget; the game works
    // in-memory even if Supabase is unreachable).
    startLiveDriver();
    return;
  }
  if(d.pause!==undefined){ S.running=!S.running; render(); return; }
  if(d.plus2!==undefined){
    // +2:00 credits to players currently on the field; no stint close/reopen.
    onField().forEach(({player,pos})=>{ S.minutesSec[player]+=120; S.posSec[player][POSITIONS[pos]]=(S.posSec[player][POSITIONS[pos]]||0)+120; if(pos===0) S.gkSec[player]+=120; });
    S.elapsed+=120; render(); return;
  }
  if(d.halftime!==undefined){ S.running=false; S.plannedLineup=null; S.screen='halftime'; render(); return; }
  if(d.end!==undefined){
    openConfirm({title:'End the game?', body:'The finished summary and CSV will be saved to this session’s history.', confirmLabel:'End game', onConfirm:()=>{ finishGame(); }});
    return;
  }
  if(d.shutdownGame!==undefined){
    // Coach-only, landing screen only: the button renders only on
    // the active-game note for a signed-in coach, and
    // shutdownLiveGame() returns unless signed in. The confirm sheet
    // states the game is discarded, not saved to history.
    const id = d.shutdownGame;
    openConfirm({title:'Shut down this game?', body:'The live game will be discarded and not saved to history. Finished games in history, the roster, and settings are kept.', confirmLabel:'Shut down game', danger:true, onConfirm:()=>{ shutdownLiveGame(id); }});
    return;
  }
  if(d.undo!==undefined){ undoLast(); return; }
  if(d.editLineup!==undefined){ S.running=false; S.editingLive=true; S.screen='setup'; render(); return; }
  if(d.playShort!==undefined){ openShortChooser(); return; }
  if(d.removePos!==undefined){
    const pos=+d.removePos; pushUndo('play short');
    const player=S.lineup[pos]; S.lineup[pos]=null;
    S.removedPositions=[pos]; S.shortMode=true; closeModal();
    render(); return;
  }
  if(d.fullStrength!==undefined){
    pushUndo('full strength'); S.removedPositions=[]; S.shortMode=false; render(); return;
  }
  if(d.editGoals!==undefined){ openEditGoalsLive(); return; }
  if(d.goalMinus!==undefined||d.goalPlus!==undefined||d.goalDel!==undefined){
    const gi=+(d.goalMinus??d.goalPlus??d.goalDel);
    if(d.goalDel!==undefined){ pushUndo('remove goal'); const g=S.goals[gi]; if(g.side==='us') S.ourScore=Math.max(0,S.ourScore-1); else S.theirScore=Math.max(0,S.theirScore-1); S.goals.splice(gi,1); }
    else { pushUndo('edit goal minute'); const g=S.goals[gi]; const cur=g.seconds==null?0:g.seconds; g.seconds=Math.max(0, Math.min(S.settings.matchMinutes*60, cur+(d.goalPlus!==undefined?60:-60))); }
    openEditGoalsLive(); render(); return;
  }
  if(d.planRefresh!==undefined){ S.planCount=(S.planCount||1)+1; S.plannedLineup=autoLineup(true); render(); return; }
  if(d.planUse!==undefined){ render(); return; }
  if(d.startSecond!==undefined){ startSecondHalf(); return; }
  if(d.snapClock!==undefined){
    S.elapsed=S.settings.matchMinutes*30; render(); return;
  }
  if(d.backLive!==undefined){ S.editingLive=false; S.screen='live'; render(); return; }
  if(d.newGame!==undefined){ startNewGame(); pushUrl(homeUrl()); return; }
  if(d.csvLast!==undefined){
    const last=S.history[S.history.length-1]; if(last) downloadCsv('sub-manager-game.csv', csvForGame(last)); return;
  }
  if(d.csv!==undefined){
    const h=S.history[+d.csv]; if(h) downloadCsv('sub-manager-game.csv', csvForGame(h)); return;
  }
  if(d.editgoals!==undefined){
    const h=S.history[+d.editgoals];
    openModal('<h2>Edit goals — past game</h2><p class="muted">Backfill a scorer with an optional minute, or remove one.</p>'
      +'<div class="row"><button data-backfill="'+d.editgoals+'">Add goal…</button></div>'
      +(h.goals.map((g,gi)=>(g.player==null && (g.side||'us')==='them')?'':'<div class="mrow"><span class="name">'+esc(goalLabel(g, h.players))+'</span>'
        +(g.player==null?'<button class="small" data-assign-hist="'+d.editgoals+':'+gi+'">Assign…</button>':'')
        +'<button class="small danger" data-delhist="'+d.editgoals+':'+gi+'">Remove</button></div>').join('')||'<p class="muted">No goals yet.</p>')
      +'<div class="pin-bottom"><button class="ghost" data-close>Done</button></div>');
    return;
  }
  if(d.lastLineup!==undefined){
    if(!S.lastLineup) return;
    closeModal();
    S.removedPositions=[]; S.shortMode=false;
    S.lineup=dedupeLineup(S.lastLineup.map(i=>S.roster[i]&&S.roster[i].present?i:null));
    render(); return;
  }
  if(d.usePreferred!==undefined){
    if(!S.preferredLineup) return;
    closeModal();
    S.removedPositions=[]; S.shortMode=false;
    S.lineup=dedupeLineup(S.preferredLineup.map(i=>S.roster[i]&&S.roster[i].present?i:null)); render(); return;
  }
  if(d.savePreferred!==undefined){
    closeModal();
    S.preferredLineup=[...S.lineup];
    // Preferred lineup persists with the roster in Supabase (private
    // app: server persistence), not in memory only.
    render(); saveRosterAuto(); return;
  }
  if(d.score!==undefined){
    const k=d.score;
    if(k==='us-plus'){ openScorerPicker('us'); return; }
    // THEM + records the goal immediately — no scorer picker: there is
    // no scorer of ours to pick for an opponent goal. The goal is
    // logged with no scorer (unknown), at the current minute; the
    // display rule hides unknown opponent goals from the Goals list,
    // so only the score changes.
    if(k==='them-plus'){ scorerMinute=Math.floor(S.elapsed/60); recordGoal('them','skip'); return; }
    if(k==='us-minus'){
      pushUndo('remove goal');
      const idx=[...S.goals].map((g,i)=>i).reverse().find(i=>S.goals[i].side==='us');
      if(idx!==undefined) S.goals.splice(idx,1);
      S.ourScore=Math.max(0,S.ourScore-1); render(); return;
    }
    if(k==='them-minus'){
      pushUndo('remove goal');
      const idx=[...S.goals].map((g,i)=>i).reverse().find(i=>S.goals[i].side==='them');
      if(idx!==undefined) S.goals.splice(idx,1);
      S.theirScore=Math.max(0,S.theirScore-1); render(); return;
    }
  }
});
/* Assign a scorer to an unknown-scorer goal (live game or past game).
   The goal keeps its side and minute; only the scorer changes. */
document.addEventListener('click',(e)=>{
  const t=e.target.closest('[data-assign-live],[data-assign-hist]');
  if(!t) return;
  if(t.dataset.assignLive!==undefined){
    const gi=+t.dataset.assignLive;
    const rows=S.roster.map((r,i)=>'<button data-assign-live-pick="'+gi+':'+i+'">'+esc(r.name)+'</button>').join('');
    openModal('<h2>Assign scorer</h2><div class="picker-grid">'+rows+'</div><div class="pin-bottom"><button data-assign-live-pick="'+gi+':-1">Own goal</button><button class="ghost" data-close>Cancel</button></div>');
    return;
  }
  if(t.dataset.assignHist!==undefined){
    const [hi,gi]=t.dataset.assignHist.split(':').map(Number);
    const rows=S.roster.map((r,i)=>'<button data-assign-hist-pick="'+hi+':'+gi+':'+i+'">'+esc(r.name)+'</button>').join('');
    openModal('<h2>Assign scorer</h2><div class="picker-grid">'+rows+'</div><div class="pin-bottom"><button data-assign-hist-pick="'+hi+':'+gi+':-1">Own goal</button><button class="ghost" data-close>Cancel</button></div>');
    return;
  }
});
document.addEventListener('click',(e)=>{
  const t=e.target.closest('[data-assign-live-pick],[data-assign-hist-pick]');
  if(!t) return;
  if(t.dataset.assignLivePick!==undefined){
    const [gi,pi]=t.dataset.assignLivePick.split(':').map(Number);
    const g=S.goals[gi];
    if(g){ g.player=pi; g.player_name=pi===-1?'Own goal':S.roster[pi].name; }
    closeModal(); openEditGoalsLive(); return;
  }
  if(t.dataset.assignHistPick!==undefined){
    const [hi,gi,pi]=t.dataset.assignHistPick.split(':').map(Number);
    const h=S.history[hi];
    if(h){
      const g=h.goals[gi];
      if(g){
        if(pi===-1){ g.player=-1; g.player_name='Own goal'; }
        else {
          const idx=(h.players||[]).findIndex(p=>p.name===S.roster[pi].name);
          g.player=idx===-1?null:idx;
          g.player_name=S.roster[pi].name;
        }
      }
      syncHistoryGame(h);
    }
    closeModal(); render(); return;
  }
});
/* Backfill / delete goals in a past game (delegated separately: dynamic buttons in modal) */
document.addEventListener('click',(e)=>{
  const t=e.target.closest('[data-backfill],[data-delhist]');
  if(!t) return;
  if(t.dataset.delhist!==undefined){
    const [hi,gi]=t.dataset.delhist.split(':').map(Number);
    const h=S.history[hi]; if(h){ h.goals.splice(gi,1); syncHistoryGame(h); }
    closeModal(); render(); return;
  }
  if(t.dataset.backfill!==undefined){
    const hi=+t.dataset.backfill;
    const rows=S.roster.map((r,i)=>'<button data-backfill-pick="'+hi+':'+i+'">'+esc(r.name)+'</button>').join('');
    openModal('<h2>Add goal — backfill</h2><p class="muted">Minute is optional; leave it blank for “name only”.</p><div class="picker-grid">'+rows+'</div><div class="pin-bottom"><button data-backfill-pick="'+hi+':-1">Own goal</button><button class="ghost" data-close>Cancel</button></div>');
    return;
  }
});
document.addEventListener('click',(e)=>{
  const t=e.target.closest('[data-backfill-pick]');
  if(!t) return;
  const [hi,pi]=t.dataset.backfillPick.split(':').map(Number);
  const h=S.history[hi]; if(h){ h.goals.push({player:pi, seconds:null, side:'us'}); syncHistoryGame(h); }
  closeModal(); render();
});
document.addEventListener('change',(e)=>{
  const t=e.target;
  if(SB.role==='viewer' && SB.liveId) return; // view-only: settings are the driver's
  if(t.dataset.setting!==undefined){
    S.settings[t.dataset.setting]=Math.max(1, +t.value||S.settings[t.dataset.setting]);
    return;
  }
  if(t.dataset.settingCheck!==undefined){ S.settings[t.dataset.settingCheck]=t.checked; return; }
  if(t.dataset.settingText!==undefined){ S.teamName=t.value||TEAM_DEFAULT; return; }
});
/* Overlay click outside the sheet closes it */
document.addEventListener('click',(e)=>{
  if(e.target && e.target.dataset && e.target.dataset.overlay!==undefined) closeModal();
});

function handleFieldTap(pos, player){
  // Tapping a player already staged in a swap deselects just that one.
  if(S.swapPair.includes(pos)){
    S.swapPair=S.swapPair.filter(x=>x!==pos); S.selection=null; render(); return;
  }
  // Tapping the selected player again deselects it.
  if(S.selection && S.selection.kind==='out' && S.selection.pos===pos){
    S.selection=null; render(); return;
  }
  // Bench-first completion comes before the queue check below: once
  // a sub is already queued, a plain field tap starts a new
  // field-first selection — but a tap that completes a bench-first
  // selection must still queue the sub, even with a queue pending.
  if(S.selection && S.selection.kind==='in'){
    // A spot that already has a queued sub can't take another one.
    if(S.queue.find(q=>q.pos===pos)) return;
    const incoming=S.selection.player;
    S.queue.push({out:player, in:incoming, pos});
    S.selection=null; render(); return;
  }
  // No swap while a substitution queue is pending.
  if(S.queue.length){
    S.selection={kind:'out', player, pos}; render(); return;
  }
  if(S.selection && S.selection.kind==='out' && S.selection.pos!==pos){
    // Second field tap stages a swap.
    S.swapPair=[S.selection.pos, pos]; S.selection=null; render(); return;
  }
  S.selection={kind:'out', player, pos}; render();
}
function handleBenchTap(i){
  // A bench player already queued to come on can't be picked again:
  // they keep only their queued highlight, never a second one, and
  // the same player can never be queued twice.
  if(S.queue.find(x=>x.in===i)) return;
  // A staged swap is untouched by bench taps — no bench-first
  // selection starts while a swap is waiting on the Swap button.
  if(S.swapPair.length===2) return;
  if(S.selection && S.selection.kind==='out'){
    // Field-first: complete the queued sub. Reset selection so a second sub can start immediately.
    S.queue.push({out:S.selection.player, in:i, pos:S.selection.pos});
    S.selection=null; render(); return;
  }
  if(S.selection && S.selection.kind==='in' && S.selection.player===i){ S.selection=null; render(); return; }
  // Bench-first: mark this bench player as the selected incoming
  // player. Tapping a different bench player switches the selection
  // to them; the field tap that follows completes the sub.
  S.selection={kind:'in', player:i, pos:-1}; render();
}

/* ---------- Init ---------- */
/* Post-sign-in entry (or already-signed-in / unconfigured entry):
   roster, then history. This runs only after the login gate has
   passed — never before sign-in. A live game is joined by typing its
   4-letter game code on the Setup screen; a shared view is joined
   with a viewer code, or by opening a ?view= link. */
async function enterApp(){
  S.showSignin = false;
  // A watcher who signs in keeps watching that game: do not reload
  // the roster or history over the live snapshot. Signing in also
  // promotes them from view-only to a coach who can drive.
  if (SB.liveId || SB.viewerMode) {
    if (SB.viewerMode && SB.authUser) { SB.role = 'driver'; startViewerPoll(); }
    render(); return;
  }
  // Deep link: a coach opening ?game= (or ?view=CODE&game=) lands in
  // that game directly — on first load and after signing in.
  if (SB.configured) {
    const routed = await routeFromUrl();
    if (routed) return;
  }
  if (SB.configured && SB.authUser) await loadRoster();
  if (SB.configured) await loadHistory();
  render();
}
(async function init(){
  initBackend();
  // Login gate first: with Supabase configured, check for a saved
  // session (stored by the Supabase client in localStorage by default)
  // before loading history, joining a live game, or rendering the
  // match UI. Without a config there is no login at all.
  if (SB.configured) await checkAuthSession();
  else SB.authChecked = true;
  render(); // entry screen if gated, match UI otherwise
  // Shared view link (?view=CODE): join it directly, signed in or
  // not — no sign-in needed to watch. A bad code falls through to
  // the normal entry below, with the error shown.
  let viewCode = null;
  try { viewCode = new URLSearchParams(window.location.search).get('view'); } catch (e) { viewCode = null; }
  if (viewCode && SB.configured) {
    const ok = await joinViewerCode(viewCode);
    if (ok) { await routeFromUrl(); /* ?view=CODE&game=... lands in that game */ }
    else if (authGated()) { /* stay on the entry screen with the error */ }
    else { await enterApp(); }
    // fall through to the listeners below
  } else if (authGated()) {
    // Wait for sign-in; the Sign in button calls enterApp() on success.
  } else {
    await enterApp();
  }
  // Back / forward buttons: the URL is the game — route it, so
  // going back leaves the game and going forward re-opens it.
  window.addEventListener('popstate', () => { routeFromUrl(); });
  // Offline / reconnect: keep working in-memory, sync when back.
  window.addEventListener('offline', () => { SB.online = false; SB.offline = true; render(); });
  window.addEventListener('online', async () => {
    SB.online = true; SB.offline = false;
    if (SB.configured) {
      if (SB.authUser) await loadHistory();
      if (SB.viewerMode && !SB.authUser) {
        await refreshViewer();
      } else if (SB.role === 'viewer' && SB.liveCode) {
        const row = await fetchLiveRow();
        if (row) handleRemoteLive(row);
      } else if (SB.role === 'driver' && SB.liveId) {
        scheduleLiveSync(true);
      }
    }
    render();
  });
})();
