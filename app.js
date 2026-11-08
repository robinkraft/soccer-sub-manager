/* Sub Manager (shared) — portable source.
   Vanilla JS, no build step. Optional Supabase backend (see
   supabase-config.js): when configured, finished games are saved to
   the game_history table and the live game syncs via the live_games
   table (one driver, other phone view-only). When not configured —
   or when the CDN / Supabase is unreachable — the app falls back to
   exactly today's in-memory behaviour: reload starts fresh.
   Browser storage rule (Robin's correction, 2026-11-07): game and
   history data are NEVER stored in browser storage — no sessionStorage,
   localStorage, IndexedDB, or cookies for game state, history, roster,
   or the preferred starting lineup (all in-memory only, lost on reload).
   The ONE exception is the Supabase Auth session itself: the Supabase
   client stores its session token in localStorage by default, and
   Sign out clears it. That is what lets a coach stay signed in across
   reloads. The per-tab writer id is generated in memory on page load;
   the live game code comes from the URL (?game=CODE) / in-memory state.
   Fictional 13-player sample roster only. Never a real roster. */
'use strict';

/* ---------- Constants ---------- */
const POSITIONS = ['GK','RB','LB','RM','CM','LM','ST'];
const POS_BIT = {GK:1,RB:2,LB:4,RM:8,CM:16,LM:32,ST:64};
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

function prefMask(prefs){ return prefs.reduce((m,p)=>m|(POS_BIT[p]||0),0); }
function prefsFromMask(mask){ return POSITIONS.filter(p=>mask & POS_BIT[p]); }
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
    screen:'setup',            // setup | review | live | halftime | finished | snapshot
    liveTab:'field',           // field | minutes | team | history
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
    preferredLineup:null,      // in-memory only, for the current page session; lost on reload
    plannedLineup:null,        // halftime plan
    snapshot:null,             // imported #g= snapshot (read-only)
    snapshotGoals:[],
    halftimeDone:false,
    message:'', error:'',
  };
}
/* No browser storage is used for game/history data anywhere in this
   app (no sessionStorage, localStorage, IndexedDB, or cookies for
   game state, history, roster, or the preferred lineup). The preferred
   lineup lives only in S.preferredLineup, in memory, for the current
   page session. The ONE exception is the Supabase Auth session: the
   Supabase client stores it in localStorage by default (see
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
  channel: null, syncTimer: null, conflict: null, offline: false,
  viewerAnchor: null, // {elapsedAtAnchor, anchorStartedAt, running} from the driver
  applyingRemote: false,
  authUser: null, authChecked: false, authError: '', authListener: null,
  authLastEmail: '', // in-memory only, pre-fills the login email after a failed attempt
  // Team roster (Supabase team_roster, authenticated-only).
  rosterRowId: null,      // id of the single team_roster row, once loaded/saved
  rosterLoaded: false,    // true once a saved roster was loaded from Supabase
  rosterFromBackend: false,
  rosterFromLink: false,  // true when the current roster came from a texted link / live game — do not auto-save it
  rosterError: '',
};
function initBackend() {
  const cfg = (typeof window !== 'undefined' && window.SSM_SUPABASE) ? window.SSM_SUPABASE : null;
  if (!cfg || !cfg.url || !cfg.anonKey) { SB.configured = false; return; }
  if (typeof window.supabase === 'undefined' || !window.supabase.createClient) {
    SB.configured = false;
    SB.backendError = 'Supabase client failed to load (CDN blocked?) — running in-memory only.';
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
    SB.backendError = 'Supabase could not be initialised — running in-memory only.';
  }
}

/* ---------- Supabase Auth (login-required) ---------- */
/* Email + password, gated before any history/live access. RLS on
   game_history and live_games is authenticated-only, so the anon key
   alone gets nothing. Coach accounts are created by Robin in the
   Supabase dashboard (Authentication → Users → Add user); the app
   never creates users and never needs a service_role key.
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
        SB.rosterFromLink = false; SB.rosterError = '';
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
    + '<p class="muted">Coaches only — sign in to see history and join a live game. '
    + 'Your account was created by Robin in Supabase (Authentication → Users).</p>'
    + err
    + '<div class="card"><label for="auth-email">Email</label>'
    + '<input type="email" id="auth-email" autocomplete="email" placeholder="you@example.com"' + emailVal + '>'
    + '<p><label for="auth-password">Password</label>'
    + '<input type="password" id="auth-password" autocomplete="current-password" placeholder="Password"></p>'
    + '<div class="row"><button class="primary grow" data-signin>Sign in</button></div></div>'
    + '<p class="muted small">You stay signed in on this device until you sign out — '
    + 'the sign-in session is saved by Supabase Auth in this browser and cleared when you sign out. '
    + 'Game and history data are never stored in this browser; they live in Supabase.</p></section>';
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
  SB.rosterFromLink = false; SB.rosterError = '';
  render();
}

/* ---------- Team roster in Supabase (team_roster) ---------- */
/* The roster lives in Supabase, not in the code. After sign-in the app
   loads the single team_roster row (team_name + players [{name, prefs}])
   and uses it instead of the fictional sample roster. RLS on
   team_roster is authenticated-only, so the anon key alone gets
   nothing. If no row exists yet — or Supabase is not configured — the
   app falls back to the fictional sample roster in DEFAULT_ROSTER and
   says so on the Setup screen. A roster from a texted link is adopted
   for that session only and is NEVER auto-saved; the coach saves it
   explicitly with "Save roster to Supabase". Notes are per-player
   private reminders and are not stored in team_roster. */
function resizeMinuteArrays() {
  const n = S.roster.length;
  S.minutesSec = padArr(S.minutesSec, n, 0);
  S.gkSec = padArr(S.gkSec, n, 0);
  S.posSec = Array.from({ length: n }, (_, i) => (S.posSec && S.posSec[i]) ? { ...S.posSec[i] } : {});
  S.lineup = S.lineup.map(x => (x == null || x < n) ? x : null);
}
function rosterSourceLabel() {
  if (SB.rosterFromLink) return 'Roster: from a texted link — not saved yet. Use “Save roster to Supabase” below to keep it.';
  if (SB.rosterFromBackend) return 'Roster: saved in Supabase (signed-in coaches only).';
  if (SB.configured && SB.authUser) return 'Roster: sample roster — rename the sample players on the Team tab (or import a setup link) and save it to Supabase.';
  return 'Roster: sample roster — Supabase is not configured, so nothing is saved between reloads.';
}
async function loadRoster() {
  SB.rosterLoaded = false; SB.rosterError = ''; SB.rosterRowId = null;
  SB.rosterFromBackend = false; SB.rosterFromLink = false;
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
      }));
    if (!players.length) return false;
    S.teamName = (data.team_name && String(data.team_name).trim()) || TEAM_DEFAULT;
    S.roster = players.map(p => ({
      name: p.name, prefs: p.prefs.length ? p.prefs : ['ST', 'RM', 'LM'],
      present: true, tired: false, note: '',
    }));
    resizeMinuteArrays();
    SB.rosterRowId = data.id; SB.rosterLoaded = true; SB.rosterFromBackend = true;
    return true;
  } catch (e) {
    SB.rosterError = 'Roster could not be loaded from Supabase — using the sample roster.';
    return false;
  }
}
async function saveRosterToBackend() {
  if (!SB.configured || !SB.client || !SB.authUser) return false;
  if (SB.role === 'viewer' && SB.liveId) return false; // view-only never writes
  const payload = {
    team_name: S.teamName,
    players: S.roster.map(r => ({ name: r.name, prefs: [...r.prefs] })),
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
    SB.rosterFromBackend = true; SB.rosterFromLink = false; SB.rosterLoaded = true;
    SB.rosterError = '';
    return true;
  } catch (e) {
    SB.rosterError = 'Roster could not be saved to Supabase — changes are in-memory only for now.';
    render();
    return false;
  }
}
/* Auto-save after an explicit roster edit (rename / add / remove /
   position-prefs change). Never auto-saves a link-imported roster, and
   never fires on page load — loading a roster does not write one. */
async function saveRosterAuto() {
  if (SB.rosterFromLink) return;
  const ok = await saveRosterToBackend();
  if (ok) { S.message = 'Roster saved to Supabase.'; render(); }
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
function liveGameUrl(code) {
  return location.origin + location.pathname + '?game=' + code;
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
  return (h.goals || []).map(g => ({
    player_index: g.player,
    player_name: g.player === -1 ? 'Own goal' : (S.roster[g.player] ? S.roster[g.player].name : '?'),
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
  const goals = (row.goals || []).map(g => ({
    player: g.player_index, seconds: g.seconds == null ? null : g.seconds, side: g.side || 'us',
  }));
  let date = '';
  try { date = row.game_date ? new Date(row.game_date + 'T12:00:00').toLocaleDateString() : new Date(row.created_at).toLocaleDateString(); } catch (e) { date = row.game_date || ''; }
  return {
    backendId: row.id, date, teamName: row.team_name,
    ourScore: row.our_score, theirScore: row.their_score,
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
    SB.historyLoaded = true; SB.historyError = '';
    render();
  } catch (e) {
    SB.historyError = 'History could not be loaded from Supabase — showing this session only.';
  }
}
async function saveHistoryGame(game) {
  if (!SB.configured) return;
  try {
    const row = {
      game_date: new Date().toISOString().slice(0, 10),
      team_name: game.teamName, match_minutes: S.settings.matchMinutes,
      our_score: game.ourScore, their_score: game.theirScore,
      players: backendPlayersFromGame(game), goals: backendGoalsFromGame(game),
      starting_lineup: (game.lineup || []).map(x => x == null ? null : x),
    };
    const { data, error } = await SB.client.from('game_history').insert(row).select('id').single();
    if (error) throw error;
    game.backendId = data.id; game.backendPending = false;
  } catch (e) {
    game.backendPending = true;
    SB.historyError = 'Finished game saved in-memory only — Supabase unreachable. Download the CSV as a backup.';
    render();
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
    SB.historyError = 'Goal edit saved in-memory only — Supabase unreachable.';
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
    if (Array.isArray(st.lineup)) S.lineup = padArr(st.lineup.map(x => x == null ? null : x), 7, null);
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
      .subscribe();
  } catch (e) { /* Realtime unavailable — the app still works in-memory; re-fetch on actions. */ }
}
function unsubscribeLive() {
  if (SB.channel && SB.client) { try { SB.client.removeChannel(SB.channel); } catch (e) {} SB.channel = null; }
}
function handleRemoteLive(row) {
  if (!row || row.last_writer_id === WRITER_ID) return; // ignore our own echo
  if (SB.role === 'viewer') {
    SB.liveVersion = row.version; SB.liveId = row.id;
    applyLiveState(row.state);
    if (row.phase === 'halftime') S.screen = 'halftime';
    else if (row.phase === 'finished') { S.screen = 'finished'; }
    else if (S.screen !== 'live') S.screen = 'live';
    S.message = 'Live update from the driver.';
    render();
  } else if (SB.role === 'driver') {
    // Someone else moved the row past the version we last saw.
    if (row.version > SB.liveVersion) { SB.conflict = { row }; render(); }
  }
}
async function startLiveDriver() {
  if (!SB.configured) {
    SB.backendError = 'Backend not configured — live game is in-memory only. See README to turn Supabase on.';
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
    try { history.replaceState(null, '', location.pathname + '?game=' + code); } catch (e) {}
    subscribeLive();
    S.message = 'Live game started — code ' + code + '. Share the live link from the Live screen.';
  } catch (e) {
    SB.backendError = 'Live game could not be started in Supabase — running in-memory only.';
  }
}
async function joinLiveGame(code) {
  if (!SB.configured) { S.error = 'This live-game link needs Supabase configured — see README.'; render(); return false; }
  try {
    const { data, error } = await SB.client.from('live_games').select('*').eq('game_code', code).maybeSingle();
    if (error) throw error;
    if (!data) { S.error = 'Live game ' + code + ' was not found — check the link.'; render(); return false; }
    SB.liveId = data.id; SB.liveCode = code; SB.liveVersion = data.version; SB.role = 'viewer'; SB.offline = false;
    applyLiveState(data.state);
    // The roster here came from the driver's live game, not from
    // team_roster — do not auto-save it. (A viewer can't save anyway;
    // after Take over, the explicit "Save roster" button still works.)
    SB.rosterFromLink = true; SB.rosterFromBackend = false;
    if (data.phase === 'halftime') S.screen = 'halftime';
    else if (data.phase === 'finished') S.screen = 'finished';
    else S.screen = 'live';
    S.liveTab = 'field';
    subscribeLive();
    S.message = 'Watching live (view-only) — the driver is driving this game.';
    render();
    return true;
  } catch (e) {
    S.error = 'Could not load live game ' + code + ' — Supabase unreachable.';
    render();
    return false;
  }
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
      // Version moved under us — fetch the latest and offer the choice.
      const latest = await fetchLiveRow();
      if (latest && latest.version > SB.liveVersion) { SB.conflict = { row: latest }; render(); }
      return;
    }
    SB.liveVersion = nextVersion; SB.offline = false;
  } catch (e) {
    SB.offline = true;
    S.message = 'Offline — changes will sync when signal returns.';
    render();
  }
}
async function takeOverLive() {
  if (!SB.configured || !SB.liveId) return;
  try {
    const latest = await fetchLiveRow();
    if (!latest) { S.error = 'Could not take over — live game no longer found.'; render(); return; }
    const nextVersion = latest.version + 1;
    const { data, error } = await SB.client.from('live_games').update({
      state: buildLiveState(), phase: livePhase(), version: nextVersion,
      last_writer_id: WRITER_ID, last_writer_label: 'Driver',
      updated_at: new Date().toISOString(),
    }).eq('id', SB.liveId).eq('version', latest.version).select('version');
    if (error) throw error;
    if (!data || !data.length) { S.error = 'Takeover raced another change — try again.'; render(); return; }
    SB.liveVersion = nextVersion; SB.role = 'driver'; SB.offline = false;
    S.message = 'You are now driving this game.';
    render();
  } catch (e) {
    S.error = 'Takeover failed — Supabase unreachable.';
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
  SB.liveId = null; SB.liveCode = null; SB.role = null; SB.conflict = null;
}
function resetLiveSession() {
  unsubscribeLive();
  SB.liveId = null; SB.liveCode = null; SB.liveVersion = 0; SB.role = null; SB.conflict = null; SB.viewerAnchor = null;
  try { history.replaceState(null, '', location.pathname); } catch (e) {}
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
  S.swapPair=[]; S.selection=null; S.message='Undid: '+u.label;
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
  const present=S.roster.filter(r=>r.present).length || 1;
  return S.settings.matchMinutes*60*fieldCount()/present;
}
function projectedSec(i){
  const remaining=Math.max(0, S.settings.matchMinutes*60 - S.elapsed);
  const onPos=S.lineup.indexOf(i);
  let proj=totalSec(i);
  if(onPos>=0) proj+=remaining;
  // queued sub: if this player is coming on, they get the remaining time instead of the outgoing player
  for(const q of S.queue){
    if(q.in===i) proj+=remaining;
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
function goalLabel(g){
  const name=g.player===-1?'Own goal':S.roster[g.player]?S.roster[g.player].name:'?';
  const min=g.seconds==null?'':" "+Math.floor(g.seconds/60)+"'";
  return name+min;
}

/* ---------- Lineup generation ---------- */
function autoLineup(favourLow){
  const present=S.roster.map((r,i)=>i).filter(i=>r.present);
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
  S.lineup=[...lineup];
  S.removedPositions=[]; S.shortMode=false;
}

/* ---------- v5 link format ---------- */
/* Payload = 'v5' + base64url(deflate-raw(UTF-8 JSON)), no padding.
   Inner: ["ssm",4,"s",team,settings,roster,lineup] or
          ["ssm",4,"g",team,settings,roster,lineup,matchMin,elapsed,us,them,
           minutesTenths,presentMask,tiredMask,plannedLineup,rotation,goals]
   settings = [matchMinutes, cadence, subsPerRotation, fairTimeThreshold]
   (+ optional 5th element 1/0 for countGoalieTime; importer accepts 4 or 5) */
function b64urlEncode(bytes){
  let bin=''; bytes.forEach(b=>{bin+=String.fromCharCode(b);});
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function b64urlDecode(str){
  const s=str.replace(/-/g,'+').replace(/_/g,'/');
  const bin=atob(s+'=='.slice(0,(4-s.length%4)%4));
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
async function encodePayload(inner){
  if(typeof CompressionStream==='undefined') throw new Error('This browser does not support CompressionStream, so links cannot be created here. Copy the setup manually instead.');
  const data=new TextEncoder().encode(JSON.stringify(inner));
  const cs=new CompressionStream('deflate-raw');
  const compressed=new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(cs)).arrayBuffer());
  return 'v5'+b64urlEncode(compressed);
}
async function decodePayload(payload){
  if(typeof DecompressionStream==='undefined') throw new Error('This browser does not support DecompressionStream, so this link cannot be imported here.');
  if(!payload.startsWith('v5')) throw new Error('old');
  const raw=b64urlDecode(payload.slice(2));
  const ds=new DecompressionStream('deflate-raw');
  const text=await new Response(new Blob([raw]).stream().pipeThrough(ds)).text();
  return JSON.parse(text);
}
function rosterFromLink(arr){
  return arr.map(([name,mask,present])=>({
    name, prefs:prefsFromMask(mask), present:!!present, tired:false, note:'',
  }));
}
function rosterToLink(){
  return S.roster.map(r=>[r.name, prefMask(r.prefs), r.present?1:0]);
}
function settingsToLink(){
  return [S.settings.matchMinutes, S.settings.cadence, S.settings.subsPerRotation,
          S.settings.fairTimeThreshold, S.settings.countGoalieTime?1:0];
}
function settingsFromLink(a){
  if(!Array.isArray(a)||a.length<4) throw new Error('old');
  return {matchMinutes:a[0], cadence:a[1], subsPerRotation:a[2], fairTimeThreshold:a[3],
          countGoalieTime: a.length>=5 ? !!a[4] : false};
}
function validateGoals(goals){
  if(!Array.isArray(goals)) throw new Error('old');
  for(const g of goals){
    if(!Array.isArray(g)||g.length!==2) throw new Error('old');
    const [p,sec]=g;
    if(!(p===-1 || (Number.isInteger(p)&&p>=0&&p<S.roster.length))) throw new Error('old');
    if(!(sec===null || (Number.isInteger(sec)&&sec>=0))) throw new Error('old');
  }
  return goals;
}
async function exportSetupLink(){
  const inner=['ssm',4,'s',S.teamName,settingsToLink(),rosterToLink(),S.lineup.map(x=>x==null?-1:x)];
  // Lineup in the spec is 7 roster indices; use -1 for an empty spot.
  const payload=await encodePayload(inner);
  return location.origin+location.pathname+'#s='+payload;
}
async function exportGameLink(){
  const minutesTenths=S.roster.map((r,i)=>Math.round(S.minutesSec[i]/6)); // minutes x10 = seconds/6
  let presentMask=0, tiredMask=0;
  S.roster.forEach((r,i)=>{ if(r.present) presentMask|=(1<<i); if(r.tired) tiredMask|=(1<<i); });
  const rotation=S.queue.map(q=>[q.out,q.in,q.pos]);
  const goals=S.goals.map(g=>[g.player, g.seconds]);
  const inner=['ssm',4,'g',S.teamName,settingsToLink(),rosterToLink(),
    S.lineup.map(x=>x==null?-1:x), S.settings.matchMinutes, Math.round(S.elapsed),
    S.ourScore, S.theirScore, minutesTenths, presentMask, tiredMask,
    (S.plannedLineup||S.lineup).map(x=>x==null?-1:x), rotation, goals];
  const payload=await encodePayload(inner);
  return location.origin+location.pathname+'#g='+payload;
}
function parsePastedLink(text){
  const t=(text||'').trim();
  const m=t.match(/#([sg])=([A-Za-z0-9\-_]+)/);
  if(m) return {kind:m[1], payload:m[2]};
  const m2=t.match(/^([sg])=([A-Za-z0-9\-_]+)/);
  if(m2) return {kind:m2[1], payload:m2[2]};
  if(t.startsWith('v5')) return {kind:null, payload:t}; // kind decided by inner JSON
  throw new Error('old');
}
async function importLink(text){
  const {kind, payload}=parsePastedLink(text);
  const inner=await decodePayload(payload);
  if(!Array.isArray(inner)||inner[0]!=='ssm'||inner[1]!==4) throw new Error('old');
  const type=inner[2];
  if(type==='s'){
    if(inner.length!==7) throw new Error('old');
    S.teamName=inner[3]; S.settings=settingsFromLink(inner[4]);
    S.roster=rosterFromLink(inner[5]);
    resizeMinuteArrays();
    // A link's roster is coach-to-coach and stays in-memory for this
    // session — it is NOT written to team_roster unless the coach
    // taps "Save roster to Supabase" on the Setup screen.
    SB.rosterFromLink=true; SB.rosterFromBackend=false;
    S.lineup=inner[6].map(x=>x===-1?null:x);
    S.removedPositions=[]; S.shortMode=false; S.screen='setup';
    S.message='Setup imported — roster adopted from the link.';
  } else if(type==='g'){
    if(inner.length<16) throw new Error('old');
    const goals=inner.length>=17 ? validateGoals(inner[16]) : [];
    S.teamName=inner[3]; S.settings=settingsFromLink(inner[4]);
    S.roster=rosterFromLink(inner[5]);
    resizeMinuteArrays();
    SB.rosterFromLink=true; SB.rosterFromBackend=false;
    // Present/tired masks
    const presentMask=inner[13], tiredMask=inner[14];
    S.roster.forEach((r,i)=>{ r.present=!!(presentMask&(1<<i)); r.tired=!!(tiredMask&(1<<i)); });
    S.snapshot={
      lineup:inner[6].map(x=>x===-1?null:x),
      matchMinutes:inner[7], elapsed:inner[8], ourScore:inner[9], theirScore:inner[10],
      minutesTenths:inner[11], plannedLineup:inner[15].map(x=>x===-1?null:x),
      rotation:inner[12]||[],
    };
    S.snapshotGoals=goals.map(([player,seconds])=>({player,seconds,side:'us'}));
    S.screen='snapshot';
    S.message='Snapshot imported — frozen at '+fmtClock(inner[8])+', not live.';
  } else throw new Error('old');
  render();
}
const LINK_ERROR='This link looks broken or is from an older version — ask for a fresh link.';

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
    if(S.elapsed>=S.settings.matchMinutes*60 && S.screen==='live'){
      S.running=false; S.message='Full time reached — you can end the game when ready.';
      render();
    }
  },1000);
}
function fieldSpotHtml(pos, opts){
  const p=S.lineup[pos];
  const removed=S.removedPositions.includes(pos);
  const queuedOff=S.queue.find(q=>q.pos===pos);
  const staged=S.swapPair.includes(pos);
  const sel=S.selection && S.selection.kind==='out' && S.selection.pos===pos;
  let cls='chip', badge='', pair='';
  if(removed){ cls+=' removed'; }
  else if(p==null){ cls+=' empty'; }
  else{
    if(S.roster[p].tired) cls+=' tired';
    if(sel||staged) cls+= staged?' swap-staged':' selected';
    if(queuedOff){ cls+=' queued-off'; badge='<span class="badge off">↓ '+POSITIONS[pos]+'</span>'; pair='<div class="pair-line"><span class="pair">→ '+esc(S.roster[queuedOff.in].name)+'</span></div>'; }
  }
  const name=removed?'Removed':(p==null?'':esc(S.roster[p].name));
  const inner=opts.readonly
    ? '<span>'+name+'</span>'
    : '<button class="'+cls+'" data-spot="'+pos+'" aria-label="'+POSITIONS[pos]+' '+(name||'empty')+'">'+name+'</button>';
  return '<div class="spot"><div class="pos-label">'+POSITIONS[pos]+'</div>'+badge+inner+pair+'</div>';
}
function fieldHtml(opts){
  opts=opts||{};
  // Layout: ST top, RM/CM/LM middle, RB/LB defence, GK in box. Same component everywhere.
  const row=(positions)=>'<div class="f-row'+(positions.length===3?' mid':'')+'">'+positions.map(p=>fieldSpotHtml(p,opts)).join('')+'</div>';
  return '<div class="field" role="group" aria-label="Field, 1-2-3-1">'
    + row([6])
    + row([3,4,5])
    + row([1,2])
    + '<div class="gk-box">'+row([0])+'</div>'
    + '</div>';
}
function benchHtml(){
  const bench=benchPlayers();
  if(!bench.length) return '<p class="muted">Bench is empty — everyone present is on the field.</p>';
  return '<div class="bench">'+bench.map(i=>{
    const q=S.queue.find(x=>x.in===i);
    const sel=S.selection && S.selection.kind==='in' && S.selection.player===i;
    const cls=['', S.roster[i].tired?'tired':'', sel?'selected':'', q?'queued-on':''].join(' ');
    const sub=q?'<span class="b-sub">↑ '+POSITIONS[q.pos]+' for '+esc(S.roster[q.out].name)+'</span>'
      :'<span class="b-sub">'+fmtMin(S.minutesSec[i])+' min</span>';
    return '<button class="'+cls+'" data-bench="'+i+'">'+esc(S.roster[i].name)+(S.roster[i].tired?' <span class="tired-dot">● tired</span>':'')+sub+'</button>';
  }).join('')+'</div>';
}
function minutesRowsHtml(){
  const present=S.roster.map((r,i)=>i).filter(i=>r.present);
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
  const idx=S.roster.map((r,i)=>i).sort((a,b)=>S.roster[a].name.localeCompare(S.roster[b].name));
  return idx.map(i=>{
    const r=S.roster[i], pos=S.lineup.indexOf(i), g=goalsFor(i);
    const where=pos>=0?POSITIONS[pos]:'Bench';
    return '<div class="mrow"><div style="min-width:0"><span class="name">'+esc(r.name)+'</span>'
      +(g?' <span>⚽ '+g+'</span>':'')+' <span class="muted">'+where+' &middot; '+fmtMin(totalSec(i))+' min</span>'
      +'<div class="note-line">'+(r.note?esc(r.note):'<button class="small" data-note="'+i+'">Add note</button>')+'</div></div>'
      +'<div class="nums"><button class="small" data-note="'+i+'">'+(r.note?'Edit note':'Note')+'</button> '
      +'<button class="small" data-tired="'+i+'">'+(r.tired?'Untire':'Tired')+'</button> '
      +'<button class="small" data-prefs="'+i+'">Positions</button> '
      +'<button class="small" data-rename="'+i+'">Rename</button> '
      +'<button class="small danger" data-remove-player="'+i+'">Remove</button></div></div>';
  }).join('');
}
function seasonTotalsHtml(){
  if(!S.history.length) return '';
  const totals = new Map();
  S.history.forEach(h => (h.players || []).forEach(p => {
    const t = totals.get(p.name) || { name: p.name, seconds: 0, games: 0, goals: 0 };
    t.seconds += (p.seconds || 0); t.goals += (p.goals || 0); t.games += 1;
    totals.set(p.name, t);
  }));
  const rows = [...totals.values()].sort((a, b) => b.seconds - a.seconds)
    .map(t => '<div class="mrow"><span class="name">' + esc(t.name) + '</span><span class="nums">' + fmtMin(t.seconds) + ' min total &middot; ' + fmtMin(t.seconds / Math.max(1, t.games)) + ' avg/game' + (t.goals ? ' &middot; ⚽ ' + t.goals : '') + '</span></div>').join('');
  return '<div class="card"><h3>Season totals (' + S.history.length + ' game' + (S.history.length === 1 ? '' : 's') + ')</h3>' + rows + '</div>';
}
function historyHtml(){
  let status = '';
  if (SB.configured) {
    if (SB.historyError) status = '<p class="muted">' + esc(SB.historyError) + '</p>';
    else if (!SB.historyLoaded) status = '<p class="muted">Loading history from Supabase…</p>';
  } else {
    status = '<p class="muted">Backend not configured — history is in-memory only for this session. See README to turn Supabase on.</p>';
  }
  if(!S.history.length) return status + '<p class="muted">No finished games yet.</p>';
  return status + seasonTotalsHtml() + S.history.map((h,hi)=>{
    const rows=h.players.map(p=>'<div class="mrow"><span class="name">'+esc(p.name)+'</span><span class="nums">'+fmtMin(p.seconds)+' min'+(p.gkSeconds?' (GK '+fmtMin(p.gkSeconds)+')':'')+(p.goals?' ⚽ '+p.goals:'')+'</span></div>').join('');
    return '<details><summary>'+esc(h.date)+' — '+esc(h.teamName)+' '+h.ourScore+'–'+h.theirScore
      +(h.goals.length?' — '+h.goals.map(goalLabel).join(', '):'')+'</summary>'
      +'<div class="row"><button class="small" data-csv="'+hi+'">Download CSV</button> '
      +'<button class="small" data-editgoals="'+hi+'">Edit goals</button></div>'+rows+'</details>';
  }).join('');
}
function csvForGame(h){
  const head='Player,Present,Actual minutes,GK minutes,Goals,Positions\n';
  const lines=h.players.map(p=>[p.name, p.present?'yes':'no', fmtMin(p.seconds), fmtMin(p.gkSeconds||0), p.goals||0,
    Object.entries(p.posSeconds||{}).map(([k,v])=>k+':'+fmtMin(v)).join('; ')].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(','));
  return head+lines.join('\n')+'\n';
}
function downloadCsv(filename, text){
  const blob=new Blob([text],{type:'text/csv'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}

/* ---------- Modals ---------- */
function openModal(html){ modalRoot.innerHTML='<div class="overlay" data-overlay><div class="sheet" role="dialog" aria-modal="true">'+html+'</div></div>'; }
function closeModal(){ modalRoot.innerHTML=''; }
let scorerMinute=null;
function openPlayerPicker(pos){
  const assigned=new Map(); S.lineup.forEach((p,i)=>{ if(p!=null) assigned.set(p, POSITIONS[i]); });
  const present=S.roster.map((r,i)=>i).filter(i=>r.present);
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
  const idx=S.roster.map((r,i)=>i).filter(i=>r.present)
    .sort((a,b)=>S.roster[a].name.localeCompare(S.roster[b].name));
  const half=Math.ceil(idx.length/2);
  const colMajor=[...idx.slice(0,half), ...idx.slice(half)]; // grid is 2-col; DOM order gives column-major reading
  const rows=colMajor.map(i=>{
    const pos=S.lineup.indexOf(i);
    return '<button data-scorer="'+i+'" data-side="'+side+'">'+esc(S.roster[i].name)
      +'<span class="sub">'+(pos>=0?POSITIONS[pos]:'Bench')+'</span></button>';
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
  openModal('<h2>Note — '+esc(S.roster[i].name)+'</h2><p class="muted">Private reminder. Notes are never included in texted links.</p>'
    +'<textarea id="note-text">'+esc(S.roster[i].note||'')+'</textarea>'
    +'<div class="row" style="margin-top:8px"><button class="primary" data-save-note="'+i+'">Save note</button><button class="ghost" data-close>Cancel</button></div>');
}
function openPrefsEditor(i){
  const r=S.roster[i];
  const chips=POSITIONS.map(p=>'<button data-pref="'+p+'" data-player="'+i+'" aria-pressed="'+r.prefs.includes(p)+'">'+p+'</button>').join('');
  openModal('<h2>Positions — '+esc(r.name)+'</h2><p class="muted">Tap to toggle preferred positions.</p>'
    +'<div class="chips">'+chips+'</div><div class="row" style="margin-top:10px"><button class="ghost" data-close>Done</button></div>');
}
function openRenameEditor(i){
  const r=S.roster[i];
  openModal('<h2>Rename player</h2><p class="muted">Renaming a sample player is how you seed the real roster — see README. The new name saves to Supabase (when signed in).</p>'
    +'<p><label>Name <input type="text" id="rename-text" value="'+esc(r.name)+'" maxlength="30"></label></p>'
    +'<div class="row" style="margin-top:8px"><button class="primary" data-save-rename="'+i+'">Save name</button><button class="ghost" data-close>Cancel</button></div>');
}
function openAddPlayerEditor(){
  openModal('<h2>Add player</h2><p class="muted">New players start with field positions preferred (no goalkeeper) — change them with Positions afterwards.</p>'
    +'<p><label>Name <input type="text" id="add-player-text" placeholder="Player name" maxlength="30"></label></p>'
    +'<div class="row" style="margin-top:8px"><button class="primary" data-save-add-player>Save player</button><button class="ghost" data-close>Cancel</button></div>');
}
function removePlayer(i){
  const name=S.roster[i].name;
  // No undo for a structural roster change: undo snapshots are
  // index-based, and removing a player shifts every later index.
  // Clear the stack instead of restoring the wrong players.
  S.undoStack=[];
  S.roster.splice(i,1);
  S.minutesSec.splice(i,1); S.gkSec.splice(i,1); S.posSec.splice(i,1);
  S.lineup=S.lineup.map(x=>x==null?null:(x===i?null:(x>i?x-1:x)));
  if(S.startingLineup) S.startingLineup=S.startingLineup.map(x=>x==null?null:(x===i?null:(x>i?x-1:x)));
  if(S.plannedLineup) S.plannedLineup=S.plannedLineup.map(x=>x==null?null:(x===i?null:(x>i?x-1:x)));
  S.message=name+' removed from the roster.';
  closeModal(); render();
  saveRosterAuto();
}
function openShortChooser(){
  const opts=POSITIONS.map((p,i)=>S.removedPositions.includes(i)?'':'<button data-remove-pos="'+i+'">Remove '+p+'</button>').join('');
  openModal('<h2>Play short (6v7)</h2><p class="muted">Choose one field slot to remove. Minutes are preserved; the player comes off to the bench.</p>'
    +'<div class="picker-grid">'+opts+'</div><div class="pin-bottom"><button class="ghost" data-close>Cancel</button></div>');
}
function openEditGoalsLive(){
  if(!S.goals.length){ openModal('<h2>Edit goals</h2><p>No goals recorded yet in this game.</p><div class="pin-bottom"><button class="ghost" data-close>Close</button></div>'); return; }
  const rows=S.goals.map((g,gi)=>'<div class="mrow"><span class="name">'+esc(goalLabel(g))+' ('+(g.side==='us'?'US':'THEM')+')</span>'
    +'<span class="nums"><button class="small" data-goal-minus="'+gi+'">−1′</button> <button class="small" data-goal-plus="'+gi+'">+1′</button> '
    +'<button class="small danger" data-goal-del="'+gi+'">Remove</button></span></div>').join('');
  openModal('<h2>Edit goals — live game</h2>'+rows+'<div class="pin-bottom"><button class="ghost" data-close>Done</button></div>');
}

/* ---------- Screens ---------- */
function render(){
  // Login gate: when Supabase is configured and nobody is signed in,
  // show ONLY the login screen — no match UI, no history, no live game
  // behind it, and no clock running.
  if (authGated()) { mainEl.innerHTML = loginHtml(); return; }
  startClock();
  const msg=S.message?'<div class="notice" role="status">'+esc(S.message)+'</div>':'';
  const err=S.error?'<div class="error" role="alert">'+esc(S.error)+'</div>':'';
  S.message=''; S.error='';
  let html=msg+err;
  if (SB.configured && SB.authUser) {
    html += '<div class="row spread"><span class="muted small">Signed in as ' + esc(SB.authUser.email || 'coach') + '</span>'
      + '<button class="small ghost" data-signout>Sign out</button></div>';
  }
  // Supabase status banners (never block the game).
  if(SB.backendError) html+='<div class="error" role="alert">'+esc(SB.backendError)+'</div>';
  if(SB.offline) html+='<div class="error" role="alert">Offline — changes will sync when signal returns.</div>';
  if(SB.conflict) html+='<div class="banner">Updated by the other coach — the live game changed on another phone.'
    +'<div class="row" style="margin-top:8px"><button data-conflict-reload>Reload their version</button><button data-conflict-keep>Keep mine</button></div></div>';
  if(SB.role==='viewer' && SB.liveId) html+='<div class="banner">View-only — you are watching the driver’s game live (code '+esc(SB.liveCode)+').'
    +'<div class="row" style="margin-top:8px"><button data-takeover-live>Take over as driver</button><button data-copy-live-link>Copy live link</button></div></div>';
  // Driver: sync the live snapshot (debounced) after any render that
  // follows an action. Remote applies set SB.applyingRemote and skip.
  if(SB.role==='driver' && SB.liveId && !SB.applyingRemote && !SB.conflict && !SB.offline && (S.screen==='live' || S.screen==='halftime')) scheduleLiveSync(false);
  if(S.screen==='setup') html+=setupHtml();
  else if(S.screen==='review') html+=reviewHtml();
  else if(S.screen==='live') html+=liveHtml();
  else if(S.screen==='halftime') html+=halftimeHtml();
  else if(S.screen==='finished') html+=finishedHtml();
  else if(S.screen==='snapshot') html+=snapshotHtml();
  mainEl.innerHTML=html;
}
function setupHtml(){
  const filled=S.lineup.filter(x=>x!=null).length;
  const lastBtn=S.lastLineup?'<button data-last-lineup>Use last game’s lineup</button>':'';
  const prefBtn=S.preferredLineup?'<button data-use-preferred>Use preferred lineup</button>':'';
  return '<section aria-label="Setup">'
    +'<div class="field-wrap">'+fieldHtml({})+'</div>'
    +'<p class="muted" style="text-align:center">'+filled+' of 7 spots filled &middot; tap a spot to choose a player</p>'
    +'<div class="row"><button class="primary" data-auto>Auto-generate lineup</button><button data-refresh>Refresh lineup</button>'
    +lastBtn+prefBtn+'<button data-save-preferred>Save as preferred</button><button data-review>Review &amp; start →</button></div>'
    +'<details><summary>Attendance ('+S.roster.filter(r=>r.present).length+' present)</summary><div class="attend">'
    +S.roster.map((r,i)=>'<button data-attend="'+i+'" class="'+(r.present?'':'absent')+'">'+esc(r.name)+(r.present?'':' — absent')+'</button>').join('')
    +'</div><p class="muted">Marking a bench player absent leaves the starting seven untouched. Marking a starter absent clears only their spot.</p></details>'
    +'<details><summary>Match settings</summary>'
    +'<p><label>Match minutes <input type="number" data-setting="matchMinutes" value="'+S.settings.matchMinutes+'" min="10" max="120"></label></p>'
    +'<p><label>Substitution cadence (min) <input type="number" data-setting="cadence" value="'+S.settings.cadence+'" min="1" max="30"></label></p>'
    +'<p><label>Subs per rotation <input type="number" data-setting="subsPerRotation" value="'+S.settings.subsPerRotation+'" min="1" max="6"></label></p>'
    +'<p><label>Fair-time threshold (min) <input type="number" data-setting="fairTimeThreshold" value="'+S.settings.fairTimeThreshold+'" min="1" max="20"></label></p>'
    +'<p><label><input type="checkbox" data-setting-check="countGoalieTime" '+(S.settings.countGoalieTime?'checked':'')+'> Count goalie time toward total game time</label><br><span class="muted">Off by default: totals count only non-goalie minutes. Goalie minutes are still tracked and shown.</span></p>'
    +'<p><label>Team name <input type="text" data-setting-text="teamName" value="'+esc(S.teamName)+'"></label></p></details>'
    +'<details><summary>Team &amp; positions</summary>'
    +'<p class="muted">'+esc(rosterSourceLabel())+(SB.rosterError?' '+esc(SB.rosterError):'')+'</p>'
    +teamRowsHtml()
    +'<div class="row"><button data-add-player>Add player</button>'
    +(SB.configured && SB.authUser?'<button data-save-roster>Save roster to Supabase</button>':'')
    +'</div>'
    +'<p class="muted">Tap Positions on a player to edit their preferred positions; Rename to change a name. Notes are private and never go in links. Renames, adds, removes and position changes save to Supabase automatically when signed in — except a roster from a texted link, which only saves when you tap “Save roster to Supabase”.</p></details>'
    +'<div class="card"><h3>Text setup to coach</h3><p class="muted">Sends the setup (roster, preferences, attendance, lineup) as a compact link. The other coach imports it on their phone.</p>'
    +'<div class="row"><button data-export-setup>Copy setup link</button><button data-sms-setup>Text setup (SMS)</button></div>'
    +'<p class="small"><label>Or copy the link text here:</label><textarea id="link-out" readonly placeholder="Link appears here after Copy"></textarea></p></div>'
    +'<div class="card"><h3>Import texted setup or game</h3><p class="muted">Paste a link or code the other coach texted you. Import adopts the link’s roster.</p>'
    +'<textarea id="link-in" placeholder="Paste link, #s=… or #g=… here"></textarea>'
    +'<div class="row" style="margin-top:8px"><button data-import>Import</button></div></div>'
    +(S.history.length?'<div class="card"><h3>History (this session)</h3>'+historyHtml()+'</div>':'')
    +'</section>';
}
function reviewHtml(){
  return '<section aria-label="Kickoff review"><h2>Kickoff review</h2><p class="muted">Check the field and bench, then start the clock.</p>'
    +'<div class="field-wrap">'+fieldHtml({readonly:true})+'</div>'
    +'<h3>Bench</h3>'+benchHtml()
    +'<div class="row"><button class="primary grow" data-start-game>Start game</button><button data-back-setup>Back to setup</button></div></section>';
}
function liveHtml(){
  const tabs=[['field','Field'],['minutes','Minutes'],['team','Team'],['history','History']];
  let body='';
  if(S.liveTab==='field'){
    body='<div class="field-wrap">'+fieldHtml({})+'</div>'
      +(S.swapPair.length?'<div class="banner">Swap staged: '+esc(S.roster[S.lineup[S.swapPair[0]]].name)+' ↔ '+esc(S.roster[S.lineup[S.swapPair[1]]].name)+' — tap Swap to run it now.</div>':'')
      +(S.selection?'<p class="muted">Selected: '+esc(S.roster[S.selection.player].name)+' — tap '+(S.selection.kind==='out'?'a bench player to bring on, or another field player to stage a swap.':'a field player to replace.')+'</p>':'')
      +(S.swapPair.length?'<div class="row"><button class="primary" data-do-swap>Swap</button><button class="ghost" data-cancel-swap>Cancel swap</button></div>':'')
      +'<h3>Bench — tap a player to start a sub</h3>'+benchHtml()
      +'<h3>Next change</h3>'
      +(S.queue.length?S.queue.map((q,qi)=>'<div class="queue-item"><span>↓ '+esc(S.roster[q.out].name)+' ('+POSITIONS[q.pos]+')</span><span class="arrow">→</span><span>↑ '+esc(S.roster[q.in].name)+'</span><button class="small" data-unqueue="'+qi+'">Remove</button></div>').join('')
        +'<div class="row"><button class="primary" data-apply>Apply ('+S.queue.length+')</button><button data-clear-queue>Clear queue</button><button data-suggest>Suggest rotation</button></div>'
        :'<p class="muted">No substitutions queued. Tap a field player, then a bench player — or a bench player first, then a field player.</p><div class="row"><button data-suggest>Suggest rotation</button></div>')
      +'<div class="row"><button data-edit-lineup>Edit lineup</button>'
      +(S.shortMode?'<button data-full-strength>Return to full strength (7v7)</button>':'<button data-play-short>Play short (6v7)</button>')
      +'<button data-edit-goals>Edit goals</button></div>'
      +'<div id="live-minutes-inline"><h3>Minutes</h3>'+minutesRowsHtml()+'</div>';
  } else if(S.liveTab==='minutes'){
    body='<h2>Minutes — actual &amp; projected</h2><p class="muted">Fair share: '+fmtMin(fairShareSec())+' min &middot; threshold ±'+S.settings.fairTimeThreshold+' min &middot; '+(S.settings.countGoalieTime?'goalie time counts':'goalie time excluded from totals')+'.</p>'
      +'<div id="live-minutes-inline">'+minutesRowsHtml()+'</div>'
      +'<h3>Goals</h3>'+(S.goals.length?S.goals.map(g=>'<p>'+esc(goalLabel(g))+' ('+(g.side==='us'?'US':'THEM')+')</p>').join(''):'<p class="muted">No goals yet.</p>')
      +'<div class="row"><button data-edit-goals>Edit goals</button></div>';
  } else if(S.liveTab==='team'){
    body='<h2>Team — player status</h2><p class="muted">Alphabetical. Notes are private and never go in links.</p>'+teamRowsHtml()
      +'<h3>Starting lineup (read-only)</h3><div class="field-wrap" style="position:static">'+fieldHtml({readonly:true})+'</div>';
  } else {
    body='<h2>History (this session)</h2>'+historyHtml();
  }
  const liveCard = SB.role==='driver' && SB.liveId
    ? '<div class="card"><h3>Live — you are driving</h3><p class="muted">Game code <strong>'+esc(SB.liveCode)+'</strong> — the other coach opens the live link below and watches view-only.</p><div class="row"><button data-copy-live-link>Copy live link</button></div></div>'
    : (SB.configured && !SB.liveId && !SB.role
      ? '<div class="card"><h3>Live sync</h3><p class="muted">Backend is configured but this game was started in-memory only (Supabase was unreachable at kickoff, or this is a snapshot takeover). History will still save on End game.</p></div>'
      : '');
  return '<section aria-label="Live game">' + liveCard
    +'<div class="scoreboard"><div class="clock" id="clock">'+fmtClock(S.elapsed)+'</div>'
    +'<div class="score"><span class="team-label">US</span> <button data-score="us-minus" aria-label="US minus">−</button> '+S.ourScore+' – '+S.theirScore+' <button data-score="them-plus" aria-label="Them plus">+</button> <span class="team-label">THEM</span></div>'
    +'<div class="row" style="justify-content:center"><button data-score="us-plus">US +</button><button data-score="them-minus">THEM −</button></div>'
    +'<div class="sub">'+(S.running?'Clock running':'Clock paused')+' &middot; '+S.settings.matchMinutes+' min &middot; '+(S.shortMode?'6v7 — playing short':'7v7')+'</div>'
    +'<div class="clock-row"><button data-pause>'+(S.running?'Pause':'Resume')+'</button><button data-plus2>+2:00</button><button data-halftime>Halftime</button><button data-end>End game</button></div>'
    +(S.undoStack.length?'<div class="clock-row"><button data-undo>Undo ('+esc(S.undoStack[S.undoStack.length-1].label)+')</button></div>':'')
    +'</div>'
    +'<div class="tabs" role="tablist">'+tabs.map(([k,label])=>'<button role="tab" aria-selected="'+(S.liveTab===k)+'" data-tab="'+k+'">'+label+'</button>').join('')+'</div>'
    +body
    +'<div class="card"><h3>Text game to coach</h3><p class="muted">Frozen snapshot at the current clock — text a fresh link for updates.</p>'
    +'<div class="row"><button data-export-game>Copy game link</button><button data-sms-game>Text game (SMS)</button></div>'
    +'<p class="small"><textarea id="link-out" readonly placeholder="Link appears here after Copy"></textarea></p></div>'
    +'<div class="row"><button class="ghost grow" data-text-coach>Text coach…</button></div>'
    +'</section>';
}
function halftimeHtml(){
  const halfBoundary=S.settings.matchMinutes*30;
  const snapNeeded=S.elapsed!==halfBoundary;
  if(!S.plannedLineup) S.plannedLineup=autoLineup(true);
  const firstHalf=S.roster.map((r,i)=>i).filter(i=>r.present)
    .sort((a,b)=>totalSec(a)-totalSec(b))
    .map(i=>'<div class="mrow"><span class="name">'+esc(S.roster[i].name)+'</span><span class="nums">'+fmtMin(totalSec(i))+' min</span></div>').join('');
  return '<section aria-label="Halftime planner"><h2>Halftime</h2>'
    +'<p>Score: <strong>US '+S.ourScore+' – '+S.theirScore+' THEM</strong> &middot; clock '+fmtClock(S.elapsed)+' (paused)</p>'
    +'<p class="muted">Second-half plan favours players with fewer first-half minutes. Tap any spot to change it.</p>'
    +'<div class="field-wrap" style="position:static">'
    + (function(){ const keep=S.lineup; S.lineup=S.plannedLineup; const h=fieldHtml({}); S.lineup=keep; return h; })()
    +'</div>'
    +'<div class="row"><button data-plan-refresh>Refresh plan</button><button data-plan-use>Use this plan</button></div>'
    +'<h3>First-half minutes</h3>'+firstHalf
    +'<div class="row"><button class="primary grow" data-start-second>Start second half</button>'
    +(snapNeeded?'<button data-snap-clock>Set clock to '+fmtClock(halfBoundary)+'</button>':'')
    +'<button data-back-live>Back to live (no change)</button></div></section>';
}
function finishedHtml(){
  const last=S.history[S.history.length-1];
  if(!last) return '<p>No finished game yet.</p>';
  const keep=S.lineup; S.lineup=last.lineup; const field=fieldHtml({readonly:true}); S.lineup=keep;
  return '<section aria-label="Finished game"><h2>Full time — US '+last.ourScore+' – '+last.theirScore+' THEM</h2>'
    +'<div class="field-wrap" style="position:static">'+field+'</div>'
    +'<p>'+(last.goals.length?'Scorers: '+last.goals.map(goalLabel).join(', '):'No goals recorded.')+'</p>'
    +'<div class="row"><button class="primary" data-csv-last>Download CSV</button><button data-editgoals-last>Edit goals</button><button data-new-game>Start new game</button></div>'
    +'<h3>Minutes</h3>'+last.players.map(p=>'<div class="mrow"><span class="name">'+esc(p.name)+'</span><span class="nums">'+fmtMin(p.seconds)+' min'+(p.gkSeconds?' (GK '+fmtMin(p.gkSeconds)+')':'')+(p.goals?' ⚽ '+p.goals:'')+'</span></div>').join('')
    +'<h3>History (this session)</h3>'+historyHtml()+'</section>';
}
function snapshotHtml(){
  const sn=S.snapshot; if(!sn) return '<p>No snapshot loaded.</p>';
  const keep=S.lineup; S.lineup=sn.lineup; const field=fieldHtml({readonly:true}); S.lineup=keep;
  const bench=S.roster.map((r,i)=>i).filter(i=>!sn.lineup.includes(i)&&r.present).map(i=>esc(S.roster[i].name)).join(', ');
  const mins=sn.minutesTenths.map((t,i)=>'<div class="mrow"><span class="name">'+esc(S.roster[i].name)+'</span><span class="nums">'+(t/10).toFixed(1)+' min'+(S.roster[i].tired?' ● tired':'')+'</span></div>').join('');
  return '<section aria-label="Snapshot"><div class="banner">Snapshot · as of '+fmtClock(sn.elapsed)+' — not live. Ask for a fresh link for updates.</div>'
    +'<h2>'+esc(S.teamName)+' — US '+sn.ourScore+' – '+sn.theirScore+' THEM</h2>'
    +'<p class="muted">'+sn.matchMinutes+' min match &middot; '+sn.lineup.filter(x=>x!=null).length+' on field</p>'
    +field
    +'<h3>Bench</h3><p>'+(bench||'—')+'</p>'
    +'<h3>Goals</h3><p>'+(S.snapshotGoals.length?S.snapshotGoals.map(goalLabel).join(', '):'None recorded.')+'</p>'
    +'<h3>Minutes</h3>'+mins
    +'<div class="row"><button class="primary" data-takeover>Take over — open halftime planner</button><button data-back-setup>Back</button></div></section>';
}

/* ---------- Game actions ---------- */
function suggestRotation(){
  const tiredOn=onField().filter(x=>S.roster[x.player].tired);
  const lowBench=benchPlayers().sort((a,b)=>totalSec(a)-totalSec(b));
  const outPool=tiredOn.length?tiredOn:onField().sort((a,b)=>totalSec(b.player)-totalSec(a.player)).slice(0,S.settings.subsPerRotation);
  const n=Math.min(S.settings.subsPerRotation, outPool.length, lowBench.length);
  S.queue=[];
  for(let i=0;i<n;i++) S.queue.push({out:outPool[i].player, in:lowBench[i], pos:outPool[i].pos});
  S.message=S.queue.length?'Suggested rotation queued — review, then Apply.':'No rotation to suggest right now.';
  render();
}
function applyQueue(){
  if(!S.queue.length) return;
  pushUndo('apply subs');
  for(const q of S.queue){ S.lineup[q.pos]=q.in; }
  S.queue=[]; S.selection=null;
  S.message='Substitutions applied at '+fmtClock(S.elapsed)+'.';
  render();
}
function doSwap(){
  if(S.swapPair.length!==2) return;
  pushUndo('swap');
  const [a,b]=S.swapPair;
  const tmp=S.lineup[a]; S.lineup[a]=S.lineup[b]; S.lineup[b]=tmp;
  S.swapPair=[]; S.selection=null;
  S.message='Swap done — Undo is available on the scoreboard.';
  render();
}
function recordGoal(side, player){
  pushUndo('goal');
  const seconds=player==='skip'?null:scorerMinute*60;
  if(player!=='skip') S.goals.push({player, seconds, side});
  if(side==='us') S.ourScore+=1; else S.theirScore+=1;
  closeModal(); render();
}
async function finishGame(){
  S.running=false;
  const players=S.roster.map((r,i)=>({
    name:r.name, present:r.present, seconds:totalSec(i), gkSeconds:S.gkSec[i],
    goals:goalsFor(i), posSeconds:S.posSec[i],
  }));
  const game={date:new Date().toLocaleDateString(), teamName:S.teamName,
    ourScore:S.ourScore, theirScore:S.theirScore, lineup:[...(S.startingLineup||S.lineup)],
    players, goals:[...S.goals]};
  S.history.push(game);
  S.lastLineup=[...S.lineup];
  S.screen='finished';
  render();
  // Durable record first: history insert, then mark the live row finished.
  await saveHistoryGame(game);
  await finishLiveGame();
  if(game.backendId) S.message='Game saved to Supabase history.';
  else if(SB.configured) S.message='Game kept in-memory only — Supabase unreachable. Download the CSV as a backup.';
  render();
}
function startNewGame(){
  const keepHistory=S.history, keepLast=S.lastLineup, keepPref=S.preferredLineup;
  const roster=S.roster.map(r=>({...r, tired:false}));
  resetLiveSession();
  S=freshState();
  S.history=keepHistory; S.lastLineup=keepLast; S.preferredLineup=keepPref; S.roster=roster;
  S.screen='setup';
  render();
}
function startSecondHalf(){
  if(S.plannedLineup){
    pushUndo('halftime plan');
    S.lineup=[...S.plannedLineup];
    S.plannedLineup=null;
  }
  S.halftimeDone=true; S.screen='live'; S.liveTab='field'; S.running=true;
  S.message='Second half started.';
  render();
}

/* ---------- Events (delegation) ---------- */
document.addEventListener('click', async (e)=>{
  const t=e.target.closest('[data-spot],[data-bench],[data-tab],[data-pick],[data-scorer],[data-step],[data-close],[data-clear-spot],[data-save-note],[data-pref],[data-remove-pos],[data-goal-minus],[data-goal-plus],[data-goal-del],[data-tired],[data-note],[data-prefs],[data-rename],[data-save-rename],[data-add-player],[data-save-add-player],[data-remove-player],[data-save-roster],[data-attend],[data-unqueue],[data-csv],[data-editgoals],[data-auto],[data-refresh],[data-review],[data-back-setup],[data-start-game],[data-pause],[data-plus2],[data-halftime],[data-end],[data-undo],[data-apply],[data-clear-queue],[data-suggest],[data-edit-lineup],[data-play-short],[data-full-strength],[data-edit-goals],[data-do-swap],[data-cancel-swap],[data-plan-refresh],[data-plan-use],[data-start-second],[data-snap-clock],[data-back-live],[data-takeover],[data-takeover-live],[data-copy-live-link],[data-conflict-reload],[data-conflict-keep],[data-new-game],[data-csv-last],[data-editgoals-last],[data-export-setup],[data-sms-setup],[data-export-game],[data-sms-game],[data-import],[data-text-coach],[data-last-lineup],[data-use-preferred],[data-save-preferred],[data-score],[data-signin],[data-signout]');
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

  // View-only phone: block every edit action. Allowed: switching tabs,
  // closing modals, copying links, viewing CSVs, and taking over.
  if(SB.role==='viewer' && SB.liveId){
    const allowed=new Set(['tab','close','takeoverLive','copyLiveLink','exportGame','smsGame','csv','csvLast','textCoach','backSetup','conflictReload','conflictKeep']);
    const keys=Object.keys(d);
    if(keys.length && !keys.some(k=>allowed.has(k))){
      S.message='View-only — the driver is driving this game. Take over to make changes.';
      render(); return;
    }
  }
  if(d.copyLiveLink!==undefined){
    const url=SB.liveCode?liveGameUrl(SB.liveCode):'';
    try{ await navigator.clipboard.writeText(url); S.message='Live link copied — the other coach opens it to watch view-only.'; }
    catch(e){ S.message='Live link: '+url; }
    render(); return;
  }
  if(d.takeoverLive!==undefined){
    if(confirm('Take over as driver? You will drive this game; the other phone becomes view-only.')) await takeOverLive();
    return;
  }
  if(d.conflictReload!==undefined){
    const row=SB.conflict?SB.conflict.row:null;
    SB.conflict=null;
    if(row){ SB.liveVersion=row.version; applyLiveState(row.state); S.message='Loaded the other coach’s version.'; }
    render(); return;
  }
  if(d.conflictKeep!==undefined){
    const row=SB.conflict?SB.conflict.row:null;
    SB.conflict=null;
    if(row) SB.liveVersion=row.version; // next write is version+1 over theirs
    S.message='Keeping your version — it will sync on the next change.';
    render(); return; // render() schedules the debounced driver sync
  }

  if(d.close!==undefined){ closeModal(); return; }
  if(d.spot!==undefined){
    const pos=+d.spot;
    if(S.screen==='halftime'){ openPlayerPicker(pos); return; }
    if(S.screen==='setup'){ openPlayerPicker(pos); return; }
    if(S.screen==='live'){
      if(S.removedPositions.includes(pos)){ pushUndo('restore position'); S.removedPositions=S.removedPositions.filter(x=>x!==pos); S.shortMode=S.removedPositions.length>0; S.message=POSITIONS[pos]+' restored — tap the spot to fill it.'; render(); return; }
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
    if(S.screen==='halftime'){ S.plannedLineup[pos]=i; }
    else { pushUndo('lineup edit'); S.lineup[pos]=i; S.removedPositions=S.removedPositions.filter(x=>x!==pos); }
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
    if(confirm('Remove '+S.roster[i].name+' from the roster? Their minutes and any lineup spot are cleared.')) removePlayer(i);
    return;
  }
  if(d.saveRoster!==undefined){
    const ok=await saveRosterToBackend();
    S.message=ok?'Roster saved to Supabase.':'Could not save the roster — see the note on the Setup screen.';
    render(); return;
  }
  if(d.tired!==undefined){
    const i=+d.tired; S.roster[i].tired=!S.roster[i].tired; render(); return;
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
  if(d.unqueue!==undefined){ S.queue.splice(+d.unqueue,1); render(); return; }
  if(d.clearQueue!==undefined){ S.queue=[]; S.selection=null; render(); return; }
  if(d.apply!==undefined){ applyQueue(); return; }
  if(d.suggest!==undefined){ suggestRotation(); return; }
  if(d.doSwap!==undefined){ doSwap(); return; }
  if(d.cancelSwap!==undefined){ S.swapPair=[]; S.selection=null; render(); return; }
  if(d.auto!==undefined){ S.lineup=autoLineup(false); S.removedPositions=[]; S.shortMode=false; render(); return; }
  if(d.refresh!==undefined){ S.lineup=autoLineup(false); render(); return; }
  if(d.review!==undefined){
    if(S.lineup.some(x=>x==null)){ S.error='Fill all 7 spots before starting — tap an empty spot to choose a player.'; render(); return; }
    S.screen='review'; render(); return;
  }
  if(d.backSetup!==undefined){ S.screen='setup'; S.snapshot=null; render(); return; }
  if(d.startGame!==undefined){
    S.screen='live'; S.liveTab='field'; S.elapsed=0; S.running=true;
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
    if(confirm('End the game? The finished summary and CSV will be saved to this session’s history.')) finishGame();
    return;
  }
  if(d.undo!==undefined){ undoLast(); return; }
  if(d.editLineup!==undefined){ S.running=false; S.screen='setup'; S.message='Edit the lineup, then Review & start to return to the game. Clock is paused.'; render(); return; }
  if(d.playShort!==undefined){ openShortChooser(); return; }
  if(d.removePos!==undefined){
    const pos=+d.removePos; pushUndo('play short');
    const player=S.lineup[pos]; S.lineup[pos]=null;
    S.removedPositions=[pos]; S.shortMode=true; closeModal();
    S.message=POSITIONS[pos]+' removed — '+(player!=null?S.roster[player].name+' is on the bench. ':'')+'Playing 6v7.';
    render(); return;
  }
  if(d.fullStrength!==undefined){
    pushUndo('full strength'); S.removedPositions=[]; S.shortMode=false; S.message='Back to full strength (7v7). Tap an empty spot to fill it.'; render(); return;
  }
  if(d.editGoals!==undefined){ openEditGoalsLive(); return; }
  if(d.goalMinus!==undefined||d.goalPlus!==undefined||d.goalDel!==undefined){
    const gi=+(d.goalMinus??d.goalPlus??d.goalDel);
    if(d.goalDel!==undefined){ pushUndo('remove goal'); const g=S.goals[gi]; if(g.side==='us') S.ourScore=Math.max(0,S.ourScore-1); else S.theirScore=Math.max(0,S.theirScore-1); S.goals.splice(gi,1); }
    else { pushUndo('edit goal minute'); const g=S.goals[gi]; const cur=g.seconds==null?0:g.seconds; g.seconds=Math.max(0, Math.min(S.settings.matchMinutes*60, cur+(d.goalPlus!==undefined?60:-60))); }
    openEditGoalsLive(); render(); return;
  }
  if(d.planRefresh!==undefined){ S.plannedLineup=autoLineup(true); render(); return; }
  if(d.planUse!==undefined){ S.message='Plan set — tap “Start second half” when ready.'; render(); return; }
  if(d.startSecond!==undefined){ startSecondHalf(); return; }
  if(d.snapClock!==undefined){
    S.elapsed=S.settings.matchMinutes*30; S.message='Clock set to '+fmtClock(S.elapsed)+'.'; render(); return;
  }
  if(d.backLive!==undefined){ S.screen='live'; render(); return; }
  if(d.takeover!==undefined){
    // Take over a snapshot: restore its state into a live game, halftime planner first.
    const sn=S.snapshot; if(!sn) return;
    S.lineup=[...sn.lineup]; S.elapsed=sn.elapsed; S.ourScore=sn.ourScore; S.theirScore=sn.theirScore;
    S.minutesSec=sn.minutesTenths.map(t=>t*6); // minutesTenths -> seconds
    S.gkSec=Array(S.roster.length).fill(0); S.posSec=Array.from({length:S.roster.length},()=>({}));
    S.goals=S.snapshotGoals.map(g=>({...g})); S.queue=[]; S.plannedLineup=[...(sn.plannedLineup||sn.lineup)];
    S.snapshot=null; S.screen='halftime'; S.running=false; render(); return;
  }
  if(d.newGame!==undefined){ startNewGame(); return; }
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
      +(h.goals.map((g,gi)=>'<div class="mrow"><span class="name">'+esc(goalLabel(g))+'</span><button class="small danger" data-delhist="'+d.editgoals+':'+gi+'">Remove</button></div>').join('')||'<p class="muted">No goals yet.</p>')
      +'<div class="pin-bottom"><button class="ghost" data-close>Done</button></div>');
    return;
  }
  if(d.lastLineup!==undefined){
    if(!S.lastLineup) return;
    S.lineup=S.lastLineup.map(i=>S.roster[i]&&S.roster[i].present?i:null);
    S.message='Last game’s lineup applied — spots for unavailable players were left empty.'; render(); return;
  }
  if(d.usePreferred!==undefined){
    if(!S.preferredLineup) return;
    S.lineup=S.preferredLineup.map(i=>S.roster[i]&&S.roster[i].present?i:null); render(); return;
  }
  if(d.savePreferred!==undefined){
    S.preferredLineup=[...S.lineup]; S.message='Preferred starting lineup saved in memory only — it will be lost on reload.'; render(); return;
  }
  if(d.exportSetup!==undefined||d.exportGame!==undefined){
    try{
      const url=d.exportSetup!==undefined?await exportSetupLink():await exportGameLink();
      const out=$('#link-out'); if(out) out.value=url;
      await navigator.clipboard.writeText(url);
      S.message='Link copied to clipboard.'; render();
      const out2=$('#link-out'); if(out2) out2.value=url;
    }catch(err){ S.error=err.message==='old'?LINK_ERROR:String(err.message||err); render(); }
    return;
  }
  if(d.smsSetup!==undefined||d.smsGame!==undefined){
    try{
      const url=d.smsSetup!==undefined?await exportSetupLink():await exportGameLink();
      location.href='sms:?&body='+encodeURIComponent('Sub Manager '+(d.smsSetup!==undefined?'setup':'game')+': '+url);
    }catch(err){ S.error=String(err.message||err); render(); }
    return;
  }
  if(d.import!==undefined){
    const val=($('#link-in')||{}).value||'';
    if(!val.trim()){ S.error='Paste a link first.'; render(); return; }
    try{ await importLink(val); }
    catch(err){ S.error=LINK_ERROR; render(); }
    return;
  }
  if(d.textCoach!==undefined){
    const body='Sub Manager — US '+S.ourScore+'–'+S.theirScore+' THEM at '+fmtClock(S.elapsed)+'. On field: '+onField().map(x=>S.roster[x.player].name+' ('+POSITIONS[x.pos]+')').join(', ')+'.';
    openModal('<h2>Text coach</h2><p>Copy this update and paste it into your message:</p><textarea readonly>'+esc(body)+'</textarea><div class="pin-bottom"><button class="ghost" data-close>Close</button></div>');
    return;
  }
  if(d.score!==undefined){
    const k=d.score;
    if(k==='us-plus'){ openScorerPicker('us'); return; }
    if(k==='them-plus'){ openScorerPicker('them'); return; }
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
  // No swap while a substitution queue is pending.
  if(S.queue.length){
    S.selection={kind:'out', player, pos}; render(); return;
  }
  if(S.selection && S.selection.kind==='out' && S.selection.pos!==pos){
    // Second field tap stages a swap.
    S.swapPair=[S.selection.pos, pos]; S.selection=null; render(); return;
  }
  if(S.selection && S.selection.kind==='in'){
    // Bench-first: bench player selected, field tap completes the sub.
    const incoming=S.selection.player;
    S.queue.push({out:player, in:incoming, pos});
    S.selection=null; S.message='Queued: '+S.roster[incoming].name+' for '+S.roster[player].name+' ('+POSITIONS[pos]+'). Tap Apply to run it.'; render(); return;
  }
  S.selection={kind:'out', player, pos}; render();
}
function handleBenchTap(i){
  if(S.selection && S.selection.kind==='out'){
    // Field-first: complete the queued sub. Reset selection so a second sub can start immediately.
    S.queue.push({out:S.selection.player, in:i, pos:S.selection.pos});
    S.selection=null; S.message='Queued: '+S.roster[i].name+' for '+S.roster[S.queue[S.queue.length-1].out].name+'. Tap Apply to run it.'; render(); return;
  }
  if(S.selection && S.selection.kind==='in' && S.selection.player===i){ S.selection=null; render(); return; }
  // Bench-first: mark this bench player as the selected incoming player.
  S.selection={kind:'in', player:i, pos:-1}; render();
}

/* ---------- Init ---------- */
/* Post-sign-in entry (or already-signed-in / unconfigured entry):
   live-game join, then a #s=/#g= hash import, then history. This runs
   only after the login gate has passed — never before sign-in. */
async function enterApp(){
  // Roster first (after sign-in): the saved team roster from Supabase
  // replaces the fictional sample roster. A #s=/#g= hash import or a
  // live-game join below overrides it for that session, as designed.
  if (SB.configured && SB.authUser) await loadRoster();
  // Live-game join takes precedence over a #s=/#g= hash import.
  const params = new URLSearchParams(location.search);
  const gameCode = params.get('game');
  let joinedLive = false;
  if (gameCode) {
    if (SB.configured) joinedLive = await joinLiveGame(gameCode);
    else { S.error = 'This live-game link needs Supabase configured — see README.'; render(); }
  }
  // Auto-import a #s= / #g= link if the page was opened with one.
  // (Frozen snapshot fallback — kept working alongside live sync.)
  if (!joinedLive && location.hash) {
    try { await importLink(location.hash); }
    catch (err) { /* Not a valid link — stay on setup; the import box explains the error. */ }
  }
  // History from Supabase when configured; in-memory only otherwise.
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
  render(); // login screen if gated, match UI otherwise
  if (authGated()) {
    // Wait for sign-in; the Sign in button calls enterApp() on success.
  } else {
    await enterApp();
  }
  // Offline / reconnect: keep working in-memory, sync when back.
  window.addEventListener('offline', () => { SB.online = false; SB.offline = true; render(); });
  window.addEventListener('online', async () => {
    SB.online = true; SB.offline = false;
    if (SB.configured && SB.authUser) {
      await loadHistory();
      if (SB.role === 'viewer' && SB.liveCode) {
        const row = await fetchLiveRow();
        if (row) handleRemoteLive(row);
      } else if (SB.role === 'driver' && SB.liveId) {
        scheduleLiveSync(true);
      }
    }
    render();
  });
})();
