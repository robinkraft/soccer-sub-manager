// Engine: the Sub Manager's mutable state + all actions + Supabase.
// Mirrors the portable app's imperative model: one in-memory state object
// (S), one backend session object (SB), and an emit() that re-renders the
// React view. Behaviour spec: ~/workspace/soccer-sub-manager-prism-spec.md

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SSM_SUPABASE } from "./supabase-config";
import {
  TEAM_DEFAULT,
  cloneRoster,
  freshState,
  type AppState,
  type Goal,
  type HistoryGame,
  type LiveState,
} from "./types";
import {
  allHistoryCsv,
  autoLineup,
  backendGoalsFromGame,
  backendPlayersFromGame,
  clockElapsed,
  csvForGame,
  dedupeLineup,
  downloadCsv,
  emptySpotsLabel,
  fmtClock,
  internalGameFromRow,
  liveGkSec,
  livePosSecAll,
  onField,
  padArr,
  placeOnField,
  rosterCsv,
  seasonCsv,
  totalSec,
} from "./logic";

export interface SBState {
  client: SupabaseClient | null;
  configured: boolean;
  backendError: string;
  online: boolean;
  historyLoaded: boolean;
  historyError: string;
  liveId: string | null;
  liveCode: string | null;
  liveVersion: number;
  role: "driver" | "viewer" | null;
  channel: unknown;
  syncTimer: ReturnType<typeof setTimeout> | null;
  syncPending: boolean;
  offline: boolean;
  applyingRemote: boolean;
  suppressSyncOnce: boolean;
  viewerMode: boolean;
  viewerTimer: ReturnType<typeof setInterval> | null;
  viewerHistoryJson: string;
  viewerJoinedCode: string;
  viewerLives: Record<string, unknown>[];
  viewerPollFails: number;
  viewerCode: string;
  viewerCodeLoaded: boolean;
  viewerCodeLoading: boolean;
  activeGames: Record<string, unknown>[];
  activeGamesLoaded: boolean;
  activeGamesLoading: boolean;
  authUser: { email?: string } | null;
  authChecked: boolean;
  authError: string;
  authListener: unknown;
  authLastEmail: string;
  rosterRowId: string | null;
  rosterLoaded: boolean;
  rosterFromBackend: boolean;
  rosterFromLive: boolean;
  rosterError: string;
}

export type ModalState =
  | { kind: "picker"; pos: number }
  | { kind: "scorer"; side: "us" | "them" }
  | { kind: "note"; player: number }
  | { kind: "more"; player: number }
  | { kind: "managePreferred" }
  | { kind: "halftimePrefs" }
  | { kind: "prefs"; player: number }
  | { kind: "rename"; player: number }
  | { kind: "addPlayer" }
  | { kind: "short" }
  | { kind: "editGoalsLive" }
  | { kind: "editGoalsPast"; hi: number }
  | { kind: "assignLive"; gi: number }
  | { kind: "assignHist"; hi: number; gi: number }
  | { kind: "backfill"; hi: number }
  | {
      kind: "confirm";
      title: string;
      body: string;
      confirmLabel: string;
      danger?: boolean;
    };

const WRITER_ID =
  "w-" +
  Math.random().toString(36).slice(2, 10) +
  Date.now().toString(36).slice(-4);

function genGameCode(): string {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++)
    code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export class Engine {
  S: AppState = freshState();
  SB: SBState;
  modal: ModalState | null = null;
  confirmFn: (() => void) | null = null;
  scorerMinute = 0;
  toast: string | null = null;
  booted = false;
  initialized = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private wakeLockSentinel: { release: () => Promise<void>; addEventListener: (t: string, f: () => void) => void } | null = null;
  private wakeLockPending = false;
  private emitFn: () => void;

  constructor(emitFn: () => void) {
    this.emitFn = emitFn;
    this.SB = {
      client: null,
      configured: false,
      backendError: "",
      online: typeof navigator !== "undefined" ? navigator.onLine !== false : true,
      historyLoaded: false,
      historyError: "",
      liveId: null,
      liveCode: null,
      liveVersion: 0,
      role: null,
      channel: null,
      syncTimer: null,
      syncPending: false,
      offline: false,
      applyingRemote: false,
      suppressSyncOnce: false,
      viewerMode: false,
      viewerTimer: null,
      viewerHistoryJson: "",
      viewerJoinedCode: "",
      viewerLives: [],
      viewerPollFails: 0,
      viewerCode: "",
      viewerCodeLoaded: false,
      viewerCodeLoading: false,
      activeGames: [],
      activeGamesLoaded: false,
      activeGamesLoading: false,
      authUser: null,
      authChecked: false,
      authError: "",
      authListener: null,
      authLastEmail: "",
      rosterRowId: null,
      rosterLoaded: false,
      rosterFromBackend: false,
      rosterFromLive: false,
      rosterError: "",
    };
  }

  /** Re-render the React view. dirty=true marks the live snapshot for a debounced sync. */
  emit(dirty = false): void {
    if (
      dirty &&
      this.SB.role === "driver" &&
      this.SB.liveId &&
      (this.S.screen === "live" || this.S.screen === "halftime")
    ) {
      this.SB.syncPending = true;
    }
    this.emitFn();
  }

  /** Consume the one-shot error (rendered once, then cleared). */
  takeError(): string {
    const e = this.S.error;
    this.S.error = "";
    return e;
  }

  isViewer(): boolean {
    return this.SB.viewerMode && !this.SB.authUser;
  }

  authGated(): boolean {
    return this.SB.configured && this.SB.authChecked && !this.SB.authUser;
  }

  /* ---------- Clock / stints ---------- */

  syncClock(): void {
    this.S.elapsed = clockElapsed(this.S);
  }

  bankStints(): void {
    const S = this.S;
    const now = Date.now();
    for (let i = 0; i < S.stints.length; i++) {
      const st = S.stints[i];
      if (!st || !st.start) continue;
      const sec = Math.max(0, (now - st.start) / 1000);
      S.minutesSec[i] = (S.minutesSec[i] || 0) + sec;
      const p = ["GK", "RB", "LB", "RM", "CM", "LM", "ST"][st.pos];
      S.posSec[i] = S.posSec[i] || {};
      S.posSec[i][p] = (S.posSec[i][p] || 0) + sec;
      if (st.pos === 0) S.gkSec[i] = (S.gkSec[i] || 0) + sec;
      S.stints[i] = null;
    }
  }

  openStints(): void {
    const S = this.S;
    if (!S.running) return;
    const now = Date.now();
    onField(S).forEach(({ player, pos }) => {
      if (!S.stints[player]) S.stints[player] = { start: now, pos };
    });
  }

  pauseClock(): void {
    this.syncClock();
    this.bankStints();
    this.S.clockBase = this.S.elapsed;
    this.S.running = false;
    this.S.clockAnchorAt = null;
  }

  resumeClock(): void {
    this.S.running = true;
    this.S.clockAnchorAt = Date.now();
    this.openStints();
  }

  /* ---------- Undo ---------- */

  private snapshotGame(): string {
    const S = this.S;
    return JSON.stringify({
      lineup: S.lineup,
      removedPositions: S.removedPositions,
      shortMode: S.shortMode,
      elapsed: S.elapsed,
      running: S.running,
      clockBase: S.clockBase,
      clockAnchorAt: S.clockAnchorAt,
      stints: S.stints,
      ourScore: S.ourScore,
      theirScore: S.theirScore,
      minutesSec: S.minutesSec,
      gkSec: S.gkSec,
      posSec: S.posSec,
      goals: S.goals,
      queue: S.queue,
      rosterPresent: S.roster.map((r) => r.present),
      rosterTired: S.roster.map((r) => r.tired),
    });
  }

  pushUndo(label: string): void {
    this.S.undoStack.push({ label, snap: this.snapshotGame() });
    if (this.S.undoStack.length > 20) this.S.undoStack.shift();
  }

  undoLast(): void {
    const u = this.S.undoStack.pop();
    if (!u) return;
    const s = JSON.parse(u.snap) as Record<string, unknown>;
    const S = this.S;
    S.lineup = s.lineup as (number | null)[];
    S.removedPositions = s.removedPositions as number[];
    S.shortMode = s.shortMode as boolean;
    S.elapsed = s.elapsed as number;
    S.running = s.running as boolean;
    S.clockBase = (s.clockBase as number) || 0;
    S.clockAnchorAt = (s.clockAnchorAt as number | null) || null;
    S.stints = Array.isArray(s.stints)
      ? (s.stints as (Record<string, unknown> | null)[]).map((st) =>
          st ? { start: st.start as number, pos: st.pos as number } : null,
        )
      : Array(S.roster.length).fill(null);
    this.syncClock();
    S.ourScore = s.ourScore as number;
    S.theirScore = s.theirScore as number;
    S.minutesSec = s.minutesSec as number[];
    S.gkSec = s.gkSec as number[];
    S.posSec = s.posSec as Record<string, number>[];
    S.goals = s.goals as Goal[];
    S.queue = s.queue as AppState["queue"];
    (s.rosterPresent as boolean[]).forEach((p, i) => {
      if (S.roster[i]) S.roster[i].present = p;
    });
    (s.rosterTired as boolean[]).forEach((t, i) => {
      if (S.roster[i]) S.roster[i].tired = t;
    });
    S.swapPair = [];
    S.selection = null;
    this.emit(true);
  }

  /* ---------- Toast / wake lock ---------- */

  showToast(text: string): void {
    this.toast = text;
    this.emit();
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.emit();
    }, 2500);
  }

  async requestWakeLock(): Promise<void> {
    if (
      typeof navigator === "undefined" ||
      !("wakeLock" in navigator) ||
      this.wakeLockSentinel ||
      this.wakeLockPending
    )
      return;
    this.wakeLockPending = true;
    try {
      const sentinel = (await (
        navigator as unknown as {
          wakeLock: { request: (t: string) => Promise<never> };
        }
      ).wakeLock.request("screen")) as unknown as {
        release: () => Promise<void>;
        addEventListener: (t: string, f: () => void) => void;
      };
      this.wakeLockSentinel = sentinel;
      sentinel.addEventListener("release", () => {
        if (this.wakeLockSentinel === sentinel) this.wakeLockSentinel = null;
      });
    } catch {
      /* unsupported / denied / not visible — silent no-op */
    }
    this.wakeLockPending = false;
  }

  async releaseWakeLock(): Promise<void> {
    if (!this.wakeLockSentinel) return;
    const sentinel = this.wakeLockSentinel;
    this.wakeLockSentinel = null;
    try {
      await sentinel.release();
    } catch {
      /* already released */
    }
  }

  syncWakeLock(): void {
    if (
      (this.S.screen === "live" || this.S.screen === "halftime") &&
      typeof document !== "undefined" &&
      !document.hidden
    )
      void this.requestWakeLock();
    else void this.releaseWakeLock();
  }

  /** Called after every React render: wake lock + debounced live sync. */
  afterRender(): void {
    this.syncWakeLock();
    if (this.SB.suppressSyncOnce) {
      this.SB.suppressSyncOnce = false;
      this.SB.syncPending = false;
    } else if (
      this.SB.syncPending &&
      this.SB.role === "driver" &&
      this.SB.liveId &&
      !this.SB.applyingRemote &&
      !this.SB.offline &&
      (this.S.screen === "live" || this.S.screen === "halftime")
    ) {
      this.SB.syncPending = false;
      this.scheduleLiveSync(false);
    }
    if (this.S.screen === "finished") {
      try {
        window.scrollTo(0, 0);
      } catch {
        /* ignore */
      }
    }
  }

  /* ---------- URL helpers ---------- */

  viewerLinkUrl(code: string): string {
    try {
      return new URL("?view=" + code, document.baseURI).href;
    } catch {
      return "?view=" + code;
    }
  }

  gameUrl(code: string): string {
    const p = new URLSearchParams();
    const view =
      this.SB.viewerCode || (this.SB.viewerMode && this.SB.viewerJoinedCode) || "";
    if (view) p.set("view", view);
    p.set("game", code);
    return window.location.pathname + "?" + p.toString();
  }

  homeUrl(): string {
    if (this.SB.viewerMode && this.SB.viewerJoinedCode)
      return window.location.pathname + "?view=" + this.SB.viewerJoinedCode;
    return window.location.pathname;
  }

  pushUrl(url: string): void {
    try {
      if (window.location.pathname + window.location.search !== url)
        window.history.pushState({}, "", url);
    } catch {
      /* sandboxed / file:// — deep links just don't work */
    }
  }

  replaceUrl(url: string): void {
    try {
      window.history.replaceState({}, "", url);
    } catch {
      /* ignore */
    }
  }

  async pushGameUrl(code: string): Promise<void> {
    if (this.SB.authUser) await this.ensureViewerCode();
    this.pushUrl(this.gameUrl(code));
  }

  async copyText(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through */
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "absolute";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return !!ok;
    } catch {
      return false;
    }
  }

  /* ---------- Auth ---------- */

  async checkAuthSession(): Promise<unknown> {
    const SB = this.SB;
    if (!SB.configured || !SB.client) {
      SB.authChecked = true;
      return null;
    }
    try {
      const { data, error } = await SB.client.auth.getSession();
      if (error) throw error;
      SB.authUser = data && data.session ? (data.session.user as { email?: string }) : null;
      SB.authError = "";
    } catch {
      SB.authUser = null;
      SB.authError = "Could not check your sign-in — try signing in again.";
    }
    SB.authChecked = true;
    if (!SB.authListener && SB.client.auth.onAuthStateChange) {
      const { data } = SB.client.auth.onAuthStateChange((event, session) => {
        SB.authUser = session ? (session.user as { email?: string }) : null;
        if (event === "SIGNED_OUT") {
          this.resetLiveSession();
          this.S = freshState();
          SB.historyLoaded = false;
          SB.rosterRowId = null;
          SB.rosterLoaded = false;
          SB.rosterFromBackend = false;
          SB.rosterFromLive = false;
          SB.rosterError = "";
          this.emit();
        }
      });
      SB.authListener = data ? data.subscription : true;
    }
    return SB.authUser;
  }

  async signInWithPassword(email: string, password: string): Promise<boolean> {
    const SB = this.SB;
    if (!SB.configured || !SB.client) return false;
    SB.authError = "";
    SB.authLastEmail = email;
    try {
      const { data, error } = await SB.client.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      SB.authUser =
        data && data.user
          ? (data.user as { email?: string })
          : data && data.session
            ? (data.session.user as { email?: string })
            : null;
      if (!SB.authUser) throw new Error("Sign-in did not return a user — try again.");
      return true;
    } catch (e) {
      SB.authUser = null;
      const msg = String((e as { message?: string })?.message || e || "");
      SB.authError = /invalid login|invalid.*credentials/i.test(msg)
        ? "Wrong email or password — check them and try again."
        : "Sign-in failed: " + msg;
      this.emit();
      return false;
    }
  }

  async signOutUser(): Promise<void> {
    try {
      if (this.SB.client) await this.SB.client.auth.signOut();
    } catch {
      /* fall through to local clear */
    }
    this.SB.authUser = null;
    this.SB.authError = "";
    this.resetLiveSession();
    this.S = freshState();
    this.SB.historyLoaded = false;
    this.SB.historyError = "";
    this.SB.rosterRowId = null;
    this.SB.rosterLoaded = false;
    this.SB.rosterFromBackend = false;
    this.SB.rosterFromLive = false;
    this.SB.rosterError = "";
    this.emit();
  }

  /* ---------- Roster (team_roster) ---------- */

  private resizeMinuteArrays(): void {
    const S = this.S;
    const n = S.roster.length;
    S.minutesSec = padArr(S.minutesSec, n, 0);
    S.gkSec = padArr(S.gkSec, n, 0);
    S.posSec = Array.from({ length: n }, (_, i) =>
      S.posSec && S.posSec[i] ? { ...S.posSec[i] } : {},
    );
    S.stints = padArr(S.stints, n, null);
    S.lineup = S.lineup.map((x) => (x == null || x < n ? x : null));
  }

  rosterSourceLabel(): string {
    if (this.SB.rosterFromLive)
      return "Roster from the live game — not saved yet. Use “Save roster” below to keep it.";
    return "";
  }

  async loadRoster(): Promise<boolean> {
    const SB = this.SB;
    SB.rosterLoaded = false;
    SB.rosterError = "";
    SB.rosterRowId = null;
    SB.rosterFromBackend = false;
    SB.rosterFromLive = false;
    if (!SB.configured || !SB.client || !SB.authUser) return false;
    try {
      const { data, error } = await SB.client
        .from("team_roster")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return false;
      SB.rosterRowId = data.id;
      if (!Array.isArray(data.players) || !data.players.length) return false;
      const players = (data.players as Record<string, unknown>[])
        .filter((p) => p && typeof p.name === "string" && String(p.name).trim())
        .map((p) => ({
          name: String(p.name).trim(),
          prefs: Array.isArray(p.prefs)
            ? (p.prefs as string[]).filter((x) =>
                ["GK", "RB", "LB", "RM", "CM", "LM", "ST"].includes(x),
              )
            : [],
          note: typeof p.note === "string" ? p.note : "",
        }));
      if (!players.length) return false;
      this.S.teamName =
        (data.team_name && String(data.team_name).trim()) || TEAM_DEFAULT;
      this.S.roster = players.map((p) => ({
        name: p.name,
        prefs: p.prefs.length ? p.prefs : ["ST", "RM", "LM"],
        present: true,
        tired: false,
        note: p.note || "",
      }));
      if (Array.isArray(data.preferred_lineup) && data.preferred_lineup.length === 7) {
        this.S.preferredLineup = (data.preferred_lineup as (number | null)[]).map(
          (x) => (x == null ? null : x),
        );
      }
      this.resizeMinuteArrays();
      SB.rosterRowId = data.id;
      SB.rosterLoaded = true;
      SB.rosterFromBackend = true;
      return true;
    } catch {
      SB.rosterError = "Roster could not be loaded.";
      return false;
    }
  }

  async saveRosterToBackend(): Promise<boolean> {
    const SB = this.SB;
    if (!SB.configured || !SB.client || !SB.authUser) return false;
    if (SB.role === "viewer" && SB.liveId) return false;
    const payload = {
      team_name: this.S.teamName,
      players: this.S.roster.map((r) => ({
        name: r.name,
        prefs: [...r.prefs],
        note: r.note || "",
      })),
      preferred_lineup: (this.S.preferredLineup || []).map((x) =>
        x == null ? null : x,
      ),
      updated_at: new Date().toISOString(),
    };
    try {
      if (SB.rosterRowId) {
        const { error } = await SB.client
          .from("team_roster")
          .update(payload)
          .eq("id", SB.rosterRowId);
        if (error) throw error;
      } else {
        const { data, error } = await SB.client
          .from("team_roster")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        SB.rosterRowId = data.id;
      }
      SB.rosterFromBackend = true;
      SB.rosterFromLive = false;
      SB.rosterLoaded = true;
      SB.rosterError = "";
      return true;
    } catch {
      SB.rosterError = "Roster could not be saved — changes are for this session only.";
      this.emit();
      return false;
    }
  }

  async saveRosterAuto(): Promise<void> {
    if (this.SB.rosterFromLive) return;
    await this.saveRosterToBackend();
  }

  /* ---------- History (game_history) ---------- */

  private setLastLineupFromHistory(): void {
    if (!this.S.history.length || !this.S.history[0].lineup) return;
    const byName = new Map(this.S.roster.map((r, i) => [r.name, i]));
    const mapped = this.S.history[0].lineup.map((x) => {
      if (x == null) return null;
      const p = this.S.history[0].players[x];
      if (!p) return null;
      const idx = byName.get(p.name);
      return idx != null && this.S.roster[idx].present ? idx : null;
    });
    if (mapped.some((x) => x != null)) this.S.lastLineup = mapped;
  }

  async loadHistory(): Promise<void> {
    const SB = this.SB;
    if (!SB.configured || !SB.client) return;
    try {
      const { data, error } = await SB.client
        .from("game_history")
        .select("*")
        .order("game_date", { ascending: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      const pending = this.S.history.filter((h) => h.backendPending && !h.backendId);
      this.S.history = ((data as Record<string, unknown>[]) || [])
        .map(internalGameFromRow)
        .concat(pending);
      this.setLastLineupFromHistory();
      SB.historyLoaded = true;
      SB.historyError = "";
      this.emit();
    } catch {
      SB.historyError = "History could not be loaded — showing this session only.";
    }
  }

  async saveHistoryGame(game: HistoryGame): Promise<void> {
    const SB = this.SB;
    if (!SB.configured || !SB.client) return;
    try {
      const row = {
        game_date: new Date().toISOString().slice(0, 10),
        team_name: game.teamName,
        match_minutes: this.S.settings.matchMinutes,
        elapsed_seconds: Math.round(this.S.elapsed),
        our_score: game.ourScore,
        their_score: game.theirScore,
        players: backendPlayersFromGame(game),
        goals: backendGoalsFromGame(
          game,
          this.S.roster.map((r) => r.name),
        ),
        starting_lineup: (game.lineup || []).map((x) => (x == null ? null : x)),
      };
      const { data, error } = await SB.client
        .from("game_history")
        .insert(row)
        .select("id")
        .single();
      if (error) throw error;
      game.backendId = data.id;
      game.backendPending = false;
    } catch {
      game.backendPending = true;
      SB.historyError = "Game saved on this device only — download the CSV as a backup.";
      this.emit();
    }
  }

  async discardHistoryGame(h: HistoryGame): Promise<void> {
    this.S.history = this.S.history.filter((x) => x !== h);
    if (this.SB.configured && this.SB.client && h.backendId) {
      try {
        const { error } = await this.SB.client
          .from("game_history")
          .delete()
          .eq("id", h.backendId);
        if (error) throw error;
      } catch {
        this.SB.historyError =
          "Game removed here, but the delete did not go through — it may reappear on reload.";
        this.emit();
      }
    }
  }

  async syncHistoryGame(h: HistoryGame): Promise<void> {
    if (!this.SB.configured || !this.SB.client || !h || !h.backendId) return;
    try {
      h.players.forEach((p, i) => {
        p.goals = h.goals.filter((g) => g.player === i).length;
      });
      const { error } = await this.SB.client
        .from("game_history")
        .update({
          goals: backendGoalsFromGame(
            h,
            this.S.roster.map((r) => r.name),
          ),
          players: backendPlayersFromGame(h),
        })
        .eq("id", h.backendId);
      if (error) throw error;
    } catch {
      this.SB.historyError = "Goal edit saved on this device only.";
      this.emit();
    }
  }

  /* ---------- Live sync (live_games) ---------- */

  buildLiveState(): LiveState {
    const S = this.S;
    this.syncClock();
    return {
      teamName: S.teamName,
      settings: { ...S.settings },
      roster: S.roster.map((r) => ({
        name: r.name,
        prefs: [...r.prefs],
        present: r.present,
        tired: r.tired,
        note: r.note || "",
      })),
      lineup: [...S.lineup],
      removedPositions: [...S.removedPositions],
      shortMode: S.shortMode,
      elapsed: S.elapsed,
      running: S.running,
      clock: {
        elapsed_seconds_at_anchor: S.clockBase,
        anchor_started_at: S.clockAnchorAt,
        running: S.running,
      },
      stints: S.stints.map((st) => (st ? { start: st.start, pos: st.pos } : null)),
      ourScore: S.ourScore,
      theirScore: S.theirScore,
      minutesSec: [...S.minutesSec],
      gkSec: [...S.gkSec],
      posSec: JSON.parse(JSON.stringify(S.posSec)) as Record<string, number>[],
      goals: S.goals.map((g) => ({ ...g })),
      queue: S.queue.map((q) => ({ ...q })),
      swapPair: [...S.swapPair],
      plannedLineup: S.plannedLineup ? [...S.plannedLineup] : null,
      halftimeDone: S.halftimeDone,
      startingLineup: S.startingLineup ? [...S.startingLineup] : null,
    };
  }

  applyLiveState(st: Record<string, unknown>): void {
    if (!st || typeof st !== "object") return;
    const S = this.S;
    const SB = this.SB;
    SB.applyingRemote = true;
    try {
      if (st.teamName) S.teamName = String(st.teamName);
      if (st.settings)
        S.settings = { ...S.settings, ...(st.settings as Record<string, unknown>) };
      if (Array.isArray(st.roster) && st.roster.length) {
        S.roster = (st.roster as Record<string, unknown>[]).map((r) => ({
          name: String(r.name),
          prefs: [...((r.prefs as string[]) || [])],
          present: !!r.present,
          tired: !!r.tired,
          note: (r.note as string) || "",
        }));
      }
      const n = S.roster.length;
      if (Array.isArray(st.lineup))
        S.lineup = padArr(
          dedupeLineup(
            (st.lineup as (number | null)[]).map((x) => (x == null ? null : x)),
          ),
          7,
          null,
        );
      S.removedPositions = Array.isArray(st.removedPositions)
        ? [...(st.removedPositions as number[])]
        : [];
      S.shortMode = !!st.shortMode;
      if (typeof st.ourScore === "number") S.ourScore = st.ourScore;
      if (typeof st.theirScore === "number") S.theirScore = st.theirScore;
      S.minutesSec = padArr(st.minutesSec as number[], n, 0);
      S.gkSec = padArr(st.gkSec as number[], n, 0);
      S.posSec = Array.from({ length: n }, (_, i) =>
        st.posSec && (st.posSec as Record<string, number>[])[i]
          ? { ...(st.posSec as Record<string, number>[])[i] }
          : {},
      );
      S.goals = Array.isArray(st.goals)
        ? (st.goals as Goal[]).map((g) => ({ ...g }))
        : [];
      S.queue = Array.isArray(st.queue)
        ? (st.queue as AppState["queue"]).map((q) => ({ ...q }))
        : [];
      S.swapPair = [];
      S.selection = null;
      S.plannedLineup = Array.isArray(st.plannedLineup)
        ? [...(st.plannedLineup as (number | null)[])]
        : null;
      S.halftimeDone = !!st.halftimeDone;
      S.startingLineup = Array.isArray(st.startingLineup)
        ? [...(st.startingLineup as (number | null)[])]
        : null;
      const clock = (st.clock as Record<string, unknown>) || {};
      if (clock.running && clock.anchor_started_at) {
        S.clockBase = (clock.elapsed_seconds_at_anchor as number) || 0;
        S.clockAnchorAt = clock.anchor_started_at as number;
        S.running = true;
      } else {
        S.clockBase =
          clock.elapsed_seconds_at_anchor != null
            ? (clock.elapsed_seconds_at_anchor as number)
            : (st.elapsed as number) || 0;
        S.clockAnchorAt = null;
        S.running = false;
      }
      S.elapsed = clockElapsed(S);
      if (Array.isArray(st.stints)) {
        const now = Date.now();
        S.stints = Array.from({ length: n }, (_, i) => {
          const s = (st.stints as (Record<string, unknown> | null)[])[i];
          if (!s || typeof s.start !== "number" || !isFinite(s.start as number))
            return null;
          if ((s.start as number) > now || (s.start as number) < now - 12 * 3600 * 1000)
            return null;
          return {
            start: s.start as number,
            pos:
              typeof s.pos === "number" && (s.pos as number) >= 0 && (s.pos as number) < 7
                ? (s.pos as number)
                : S.lineup.indexOf(i) >= 0
                  ? S.lineup.indexOf(i)
                  : 0,
          };
        });
      } else {
        S.stints = Array(n).fill(null);
        if (S.running) this.openStints();
      }
    } finally {
      SB.applyingRemote = false;
    }
  }

  livePhase(): string {
    return this.S.screen === "halftime"
      ? "halftime"
      : this.S.screen === "finished"
        ? "finished"
        : "live";
  }

  async fetchLiveRow(): Promise<Record<string, unknown> | null> {
    const SB = this.SB;
    if (!SB.configured || !SB.client || !SB.liveCode) return null;
    const { data, error } = await SB.client
      .from("live_games")
      .select("*")
      .eq("game_code", SB.liveCode)
      .maybeSingle();
    if (error || !data) return null;
    return data as Record<string, unknown>;
  }

  subscribeLive(): void {
    const SB = this.SB;
    if (!SB.configured || !SB.liveCode || !SB.client) return;
    try {
      if (SB.channel) {
        SB.client.removeChannel(SB.channel as never);
        SB.channel = null;
      }
      const ch = SB.client
        .channel("live-" + SB.liveCode)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "live_games",
            filter: "game_code=eq." + SB.liveCode,
          },
          (payload) => {
            if (payload && payload.new)
              this.handleRemoteLive(payload.new as Record<string, unknown>);
          },
        )
        .on(
          "postgres_changes",
          { event: "DELETE", schema: "public", table: "live_games" },
          (payload) => {
            if (payload && payload.old && (payload.old as Record<string, unknown>).id)
              this.handleLiveDeleted(String((payload.old as Record<string, unknown>).id));
          },
        )
        .subscribe();
      SB.channel = ch;
    } catch {
      /* Realtime unavailable — the app still works in-memory */
    }
  }

  unsubscribeLive(): void {
    const SB = this.SB;
    if (SB.channel && SB.client) {
      try {
        SB.client.removeChannel(SB.channel as never);
      } catch {
        /* ignore */
      }
      SB.channel = null;
    }
  }

  handleRemoteLive(row: Record<string, unknown>): void {
    const SB = this.SB;
    if (!row || row.last_writer_id === WRITER_ID) return;
    if ((row.version as number) < SB.liveVersion) return;
    const isNewer = (row.version as number) > SB.liveVersion;
    SB.liveVersion = row.version as number;
    SB.liveId = row.id as string;
    this.applyLiveState(row.state as Record<string, unknown>);
    if (row.phase === "halftime") this.S.screen = "halftime";
    else if (row.phase === "finished") this.S.screen = "finished";
    else if (this.S.screen !== "live") this.S.screen = "live";
    if (isNewer) this.showToast("Updated");
    SB.suppressSyncOnce = true;
    this.emit();
  }

  scheduleLiveSync(immediate: boolean): void {
    const SB = this.SB;
    if (SB.role !== "driver" || !SB.liveId || !SB.configured) return;
    if (SB.syncTimer) clearTimeout(SB.syncTimer);
    SB.syncTimer = setTimeout(() => {
      void this.doLiveSync();
    }, immediate ? 0 : 1200);
  }

  async doLiveSync(): Promise<void> {
    const SB = this.SB;
    if (SB.role !== "driver" || !SB.liveId || !SB.configured || !SB.client) return;
    const nextVersion = SB.liveVersion + 1;
    try {
      const { data, error } = await SB.client
        .from("live_games")
        .update({
          state: this.buildLiveState(),
          phase: this.livePhase(),
          version: nextVersion,
          last_writer_id: WRITER_ID,
          last_writer_label: "Driver",
          updated_at: new Date().toISOString(),
        })
        .eq("id", SB.liveId)
        .eq("version", SB.liveVersion)
        .select("version");
      if (error) throw error;
      if (!data || !data.length) {
        const latest = await this.fetchLiveRow();
        if (!latest) {
          try {
            const { data: stillThere, error: checkErr } = await SB.client
              .from("live_games")
              .select("id")
              .eq("id", SB.liveId)
              .maybeSingle();
            if (!checkErr && !stillThere) {
              this.handleLiveDeleted(SB.liveId);
              return;
            }
          } catch {
            /* fall through to offline */
          }
          SB.offline = true;
          this.emit();
          return;
        }
        if ((latest.version as number) > SB.liveVersion) {
          const retry = await SB.client
            .from("live_games")
            .update({
              state: this.buildLiveState(),
              phase: this.livePhase(),
              version: (latest.version as number) + 1,
              last_writer_id: WRITER_ID,
              last_writer_label: "Driver",
              updated_at: new Date().toISOString(),
            })
            .eq("id", SB.liveId)
            .eq("version", latest.version as number)
            .select("version");
          if (!retry.error && retry.data && retry.data.length) {
            SB.liveVersion = (latest.version as number) + 1;
            SB.offline = false;
            return;
          }
          this.handleRemoteLive(latest);
        }
        return;
      }
      SB.liveVersion = nextVersion;
      SB.offline = false;
    } catch {
      SB.offline = true;
      this.emit();
    }
  }

  async startLiveDriver(): Promise<void> {
    const SB = this.SB;
    if (!SB.configured || !SB.client) {
      SB.backendError = "Live game could not be started — try again.";
      return;
    }
    const code = genGameCode();
    try {
      const { data, error } = await SB.client
        .from("live_games")
        .insert({
          game_code: code,
          phase: "live",
          version: 1,
          last_writer_id: WRITER_ID,
          last_writer_label: "Driver",
          state: this.buildLiveState(),
        })
        .select("id,version")
        .single();
      if (error) throw error;
      SB.liveId = data.id;
      SB.liveCode = code;
      SB.liveVersion = 1;
      SB.role = "driver";
      SB.offline = false;
      this.subscribeLive();
      await this.pushGameUrl(code);
    } catch {
      SB.backendError = "Live game could not be started — try again.";
    }
  }

  async joinLiveGame(
    code: string,
    opts?: { push?: boolean },
  ): Promise<boolean> {
    const SB = this.SB;
    if (!SB.configured) {
      this.S.error = "Live games need Supabase — try again later.";
      this.emit();
      return false;
    }
    if (!SB.authUser) {
      this.S.error = "Sign in as a coach to join a live game with its game code.";
      this.emit();
      return false;
    }
    try {
      const { data, error } = await SB.client!
        .from("live_games")
        .select("*")
        .eq("game_code", code)
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        this.S.error = "Live game " + code + " was not found — check the code.";
        this.S.screen = "setup";
        this.emit();
        return false;
      }
      SB.liveId = data.id;
      SB.liveCode = code;
      SB.liveVersion = data.version;
      SB.role = "driver";
      SB.offline = false;
      SB.viewerMode = false;
      this.applyLiveState(data.state as Record<string, unknown>);
      SB.rosterFromLive = true;
      SB.rosterFromBackend = false;
      if (data.phase === "halftime") this.S.screen = "halftime";
      else if (data.phase === "finished") this.S.screen = "finished";
      else this.S.screen = "live";
      this.S.liveTab = "actions";
      this.subscribeLive();
      if (!opts || opts.push !== false) await this.pushGameUrl(code);
      this.emit();
      return true;
    } catch {
      this.S.error = "Could not load live game.";
      if (this.S.screen === "loading") this.S.screen = "setup";
      this.emit();
      return false;
    }
  }

  async finishLiveGame(): Promise<void> {
    const SB = this.SB;
    if (SB.role !== "driver" || !SB.liveId || !SB.configured || !SB.client) return;
    try {
      const nextVersion = SB.liveVersion + 1;
      await SB.client
        .from("live_games")
        .update({
          state: this.buildLiveState(),
          phase: "finished",
          version: nextVersion,
          last_writer_id: WRITER_ID,
          last_writer_label: "Driver",
          updated_at: new Date().toISOString(),
        })
        .eq("id", SB.liveId)
        .eq("version", SB.liveVersion);
      SB.liveVersion = nextVersion;
    } catch {
      /* History insert is the durable record */
    }
    this.unsubscribeLive();
    SB.liveId = null;
    SB.liveCode = null;
    SB.role = null;
  }

  async shutdownLiveGame(gameId: string): Promise<void> {
    const SB = this.SB;
    if (!SB.authUser || !SB.client) return;
    const id = gameId || SB.liveId;
    if (!id || !SB.configured) return;
    const isOpenGame = id === SB.liveId;
    if (isOpenGame) this.unsubscribeLive();
    try {
      const { error } = await SB.client.from("live_games").delete().eq("id", id);
      if (error) throw error;
    } catch {
      if (isOpenGame) this.subscribeLive();
      this.S.error =
        "Could not shut down the live game — check connection and try again.";
      this.emit();
      return;
    }
    if (isOpenGame) {
      this.startNewGame();
      this.replaceUrl(this.homeUrl());
    } else {
      SB.activeGames = (SB.activeGames || []).filter(
        (g) => g && g.id !== id,
      );
      if (this.S.screen === "setup") this.emit();
    }
    this.showToast("Live game shut down");
  }

  handleLiveDeleted(deletedId: string): void {
    if (this.SB.liveId && deletedId === this.SB.liveId) {
      this.startNewGame();
      this.replaceUrl(this.homeUrl());
      this.showToast("Updated");
    } else if (deletedId) {
      this.SB.activeGames = (this.SB.activeGames || []).filter(
        (g) => g && g.id !== deletedId,
      );
      if (this.S.screen === "setup") this.emit();
    }
  }

  resetLiveSession(): void {
    this.unsubscribeLive();
    if (this.SB.viewerTimer) {
      clearInterval(this.SB.viewerTimer);
      this.SB.viewerTimer = null;
    }
    this.SB.liveId = null;
    this.SB.liveCode = null;
    this.SB.liveVersion = 0;
    this.SB.role = null;
    this.SB.viewerMode = false;
    this.SB.viewerHistoryJson = "";
    this.SB.viewerJoinedCode = "";
    this.SB.viewerLives = [];
    this.SB.activeGames = [];
    this.SB.activeGamesLoaded = false;
    this.SB.activeGamesLoading = false;
  }

  /* ---------- Anonymous viewing (viewer_access RPC) ---------- */

  async joinViewerCode(code: string): Promise<boolean> {
    const SB = this.SB;
    if (!SB.configured) {
      this.S.error = "Viewing needs Supabase — try again later.";
      if (this.S.screen === "loading") this.S.screen = "setup";
      return false;
    }
    code = (code || "").trim().toUpperCase();
    if (!code) {
      this.S.error = "Enter the 4-letter view code first.";
      if (this.S.screen === "loading") this.S.screen = "setup";
      return false;
    }
    try {
      const { data, error } = await SB.client!.rpc("viewer_access", {
        p_code: code,
      });
      if (error) throw error;
      if (!data || !data.ok) {
        this.S.error = "That view code was not found — check the code.";
        if (this.S.screen === "loading") this.S.screen = "setup";
        return false;
      }
      SB.viewerMode = true;
      SB.viewerJoinedCode = code;
      this.applyViewerAccess(data as Record<string, unknown>);
      return true;
    } catch {
      this.S.error =
        "Couldn't check the code — check your connection and try again.";
      if (this.S.screen === "loading") this.S.screen = "setup";
      return false;
    }
  }

  applyViewerAccess(data: Record<string, unknown>): void {
    const SB = this.SB;
    const lives = Array.isArray(data.lives)
      ? (data.lives as Record<string, unknown>[])
      : data.live
        ? [data.live as Record<string, unknown>]
        : [];
    SB.viewerLives = lives;
    if (Array.isArray(data.history)) {
      this.S.history = (data.history as Record<string, unknown>[]).map(
        internalGameFromRow,
      );
      SB.historyLoaded = true;
      SB.historyError = "";
      SB.viewerHistoryJson = JSON.stringify(data.history);
    }
    if (SB.authUser && lives.length) {
      let urlGame = "";
      try {
        urlGame = (new URLSearchParams(window.location.search).get("game") || "")
          .trim()
          .toUpperCase();
      } catch {
        /* ignore */
      }
      const live =
        (urlGame && lives.find((g) => g && g.game_code === urlGame)) || lives[0];
      SB.liveId = live.id as string;
      SB.liveCode = live.game_code as string;
      SB.liveVersion = live.version as number;
      SB.role = "driver";
      this.applyLiveState(live.state as Record<string, unknown>);
      SB.rosterFromLive = true;
      SB.rosterFromBackend = false;
      if (live.phase === "halftime") this.S.screen = "halftime";
      else this.S.screen = "live";
      this.S.liveTab = "actions";
      this.subscribeLive();
      void this.pushGameUrl(live.game_code as string);
    } else {
      SB.liveId = null;
      SB.liveCode = null;
      SB.liveVersion = 0;
      SB.role = SB.authUser ? "driver" : "viewer";
      this.S.screen = "viewer";
    }
    SB.offline = false;
    this.startViewerPoll();
    this.emit();
  }

  joinViewerGame(id: string, opts?: { push?: boolean }): boolean {
    const SB = this.SB;
    const live = (SB.viewerLives || []).find((g) => g && g.id === id);
    if (!live) {
      this.S.error = "That live game is no longer available.";
      this.emit();
      return false;
    }
    SB.liveId = live.id as string;
    SB.liveCode = live.game_code as string;
    SB.liveVersion = live.version as number;
    SB.role = SB.authUser ? "driver" : "viewer";
    this.applyLiveState(live.state as Record<string, unknown>);
    SB.rosterFromLive = true;
    SB.rosterFromBackend = false;
    if (live.phase === "halftime") this.S.screen = "halftime";
    else this.S.screen = "live";
    this.S.liveTab = "actions";
    this.S.viewerTab = "game";
    if (SB.authUser) this.subscribeLive();
    if (!opts || opts.push !== false) void this.pushGameUrl(live.game_code as string);
    this.emit();
    return true;
  }

  startViewerPoll(): void {
    const SB = this.SB;
    if (SB.viewerTimer) {
      clearInterval(SB.viewerTimer);
      SB.viewerTimer = null;
    }
    if (!SB.viewerMode || SB.authUser) return;
    SB.viewerTimer = setInterval(() => {
      void this.refreshViewer();
    }, 3000);
  }

  async refreshViewer(): Promise<void> {
    const SB = this.SB;
    if (!SB.viewerMode || SB.authUser || !SB.client) return;
    try {
      const { data, error } = await SB.client.rpc("viewer_access", {
        p_code: SB.viewerJoinedCode,
      });
      if (error) throw error;
      SB.viewerPollFails = 0;
      if (!data || !data.ok) {
        const msg = "This view link is no longer active.";
        this.leaveLiveGame();
        this.S.error = msg;
        this.emit();
        return;
      }
      const lives = Array.isArray(data.lives)
        ? (data.lives as Record<string, unknown>[])
        : data.live
          ? [data.live as Record<string, unknown>]
          : [];
      SB.viewerLives = lives;
      const histJson = JSON.stringify(data.history || []);
      if (histJson !== SB.viewerHistoryJson) {
        this.S.history = ((data.history as Record<string, unknown>[]) || []).map(
          internalGameFromRow,
        );
        SB.historyLoaded = true;
        SB.viewerHistoryJson = histJson;
      }
      if (SB.liveId) {
        const mine = lives.find((g) => g && g.id === SB.liveId);
        if (!mine) {
          SB.liveId = null;
          SB.liveCode = null;
          SB.liveVersion = 0;
          SB.role = "viewer";
          this.S.screen = "viewer";
          this.emit();
        } else if ((mine.version as number) > SB.liveVersion) {
          this.handleRemoteLive({
            id: mine.id,
            game_code: mine.game_code,
            version: mine.version,
            phase: mine.phase,
            state: mine.state,
            last_writer_id: null,
          });
        } else {
          this.emit();
        }
      } else {
        this.emit();
      }
    } catch {
      SB.viewerPollFails = (SB.viewerPollFails || 0) + 1;
      if (SB.viewerPollFails === 2) {
        this.S.error =
          "Couldn't refresh the shared view — check your connection and try again.";
        this.emit();
      }
    }
  }

  /* ---------- Share a view link / active games ---------- */

  async loadViewerCode(): Promise<void> {
    if (!this.SB.configured || !this.SB.authUser) return;
    this.SB.viewerCodeLoading = true;
    await this.fetchViewerCode();
    this.SB.viewerCodeLoading = false;
    this.emit();
  }

  async fetchViewerCode(): Promise<string> {
    const SB = this.SB;
    if (!SB.configured || !SB.authUser || !SB.client) return "";
    try {
      const { data, error } = await SB.client
        .from("viewer_codes")
        .select("code")
        .eq("active", true)
        .maybeSingle();
      if (error) throw error;
      if (data && data.code) SB.viewerCode = data.code;
      SB.viewerCodeLoaded = true;
    } catch {
      SB.viewerCodeLoaded = true;
    }
    return SB.viewerCode || "";
  }

  async createViewerCode(): Promise<string> {
    const SB = this.SB;
    await SB.client!
      .from("viewer_codes")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("active", true);
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = genGameCode();
      const { error } = await SB.client!
        .from("viewer_codes")
        .insert({ code: candidate, active: true });
      if (!error) {
        SB.viewerCode = candidate;
        SB.viewerCodeLoaded = true;
        return candidate;
      }
    }
    throw new Error("no code generated");
  }

  async generateViewerCode(): Promise<void> {
    if (!this.SB.configured || !this.SB.authUser) return;
    try {
      const code = await this.createViewerCode();
      await this.copyText(this.viewerLinkUrl(code));
      this.showToast("Link copied");
      this.emit();
    } catch {
      this.S.error = "Could not generate a view link — try again.";
      this.emit();
    }
  }

  async ensureViewerCode(): Promise<string> {
    const SB = this.SB;
    if (SB.viewerCode) return SB.viewerCode;
    if (!SB.configured || !SB.authUser) return "";
    if (SB.viewerCodeLoading) {
      for (let i = 0; i < 20 && SB.viewerCodeLoading; i++)
        await new Promise((r) => setTimeout(r, 50));
      if (SB.viewerCode) return SB.viewerCode;
    }
    if (!SB.viewerCodeLoaded) await this.fetchViewerCode();
    if (SB.viewerCode) return SB.viewerCode;
    try {
      return await this.createViewerCode();
    } catch {
      return "";
    }
  }

  async loadActiveGames(): Promise<void> {
    const SB = this.SB;
    if (!SB.configured || !SB.authUser || SB.activeGamesLoading || !SB.client) return;
    SB.activeGamesLoading = true;
    try {
      const { data, error } = await SB.client
        .from("live_games")
        .select("*")
        .in("phase", ["live", "halftime"])
        .order("updated_at", { ascending: false });
      if (error) throw error;
      SB.activeGames = (data as Record<string, unknown>[]) || [];
      SB.activeGamesLoaded = true;
    } catch {
      SB.activeGamesLoaded = true;
    }
    SB.activeGamesLoading = false;
    this.emit();
  }

  activeGameElapsed(st: Record<string, unknown>): number {
    const clock = (st.clock as Record<string, unknown>) || {};
    if (clock.running && clock.anchor_started_at) {
      return (
        ((clock.elapsed_seconds_at_anchor as number) || 0) +
        (Date.now() - (clock.anchor_started_at as number)) / 1000
      );
    }
    return clock.elapsed_seconds_at_anchor != null
      ? (clock.elapsed_seconds_at_anchor as number)
      : (st.elapsed as number) || 0;
  }

  async joinActiveGame(row: Record<string, unknown>): Promise<boolean> {
    const SB = this.SB;
    if (!SB.configured || !SB.authUser || !row) return false;
    SB.liveId = row.id as string;
    SB.liveCode = row.game_code as string;
    SB.liveVersion = row.version as number;
    SB.role = "driver";
    SB.offline = false;
    SB.viewerMode = false;
    this.applyLiveState((row.state as Record<string, unknown>) || {});
    SB.rosterFromLive = true;
    SB.rosterFromBackend = false;
    if (row.phase === "halftime") this.S.screen = "halftime";
    else this.S.screen = "live";
    this.S.liveTab = "actions";
    this.subscribeLive();
    await this.pushGameUrl(row.game_code as string);
    this.emit();
    return true;
  }

  /* ---------- Routing ---------- */

  leaveToHome(): void {
    if (this.SB.viewerMode && !this.SB.authUser) this.leaveLiveGame();
    else this.startNewGame();
    this.replaceUrl(this.homeUrl());
  }

  async routeFromUrl(): Promise<boolean> {
    let params: URLSearchParams;
    try {
      params = new URLSearchParams(window.location.search);
    } catch {
      return false;
    }
    const gameCode = (params.get("game") || "").trim().toUpperCase();
    const viewCode = (params.get("view") || "").trim().toUpperCase();
    if (gameCode) {
      if (this.SB.liveCode === gameCode && this.SB.liveId) {
        if (this.SB.viewerMode && this.SB.authUser) {
          this.SB.role = "driver";
          this.startViewerPoll();
        }
        return true;
      }
      this.S.screen = "loading";
      this.emit();
      if (this.SB.viewerMode && this.SB.viewerJoinedCode) {
        const live = (this.SB.viewerLives || []).find(
          (g) => g && g.game_code === gameCode,
        );
        if (live) {
          this.joinViewerGame(live.id as string, { push: false });
          return true;
        }
        this.S.error = "That live game is no longer available.";
        this.S.screen = "viewer";
        this.emit();
        return true;
      }
      if (this.SB.authUser) {
        return await this.joinLiveGame(gameCode, { push: false });
      }
      if (viewCode) {
        const ok = await this.joinViewerCode(viewCode);
        if (!ok) {
          this.emit();
          return true;
        }
        return await this.routeFromUrl();
      }
      return false;
    }
    if (
      this.SB.liveId &&
      (this.S.screen === "live" || this.S.screen === "halftime")
    ) {
      this.leaveToHome();
      return true;
    }
    return false;
  }

  async enterApp(): Promise<void> {
    const SB = this.SB;
    this.S.showSignin = false;
    if (SB.liveId || SB.viewerMode) {
      if (SB.viewerMode && SB.authUser) {
        SB.role = "driver";
        this.startViewerPoll();
      }
      this.emit();
      return;
    }
    if (SB.configured) {
      const routed = await this.routeFromUrl();
      if (routed) return;
    }
    if (this.S.screen === "loading") this.S.screen = "setup";
    if (SB.configured && SB.authUser) await this.loadRoster();
    if (SB.configured) await this.loadHistory();
    this.emit();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const SB = this.SB;
    const cfg = SSM_SUPABASE;
    if (!cfg || !cfg.url || !cfg.anonKey) {
      SB.configured = false;
    } else {
      try {
        SB.client = createClient(cfg.url, cfg.anonKey, {
          auth: { detectSessionInUrl: false },
        });
        SB.configured = true;
      } catch {
        SB.configured = false;
        SB.backendError = "Could not connect — changes are saved on this device only.";
      }
    }
    if (SB.configured) await this.checkAuthSession();
    else SB.authChecked = true;
    let urlHasGame = false;
    try {
      const p = new URLSearchParams(window.location.search);
      urlHasGame = !!(p.get("game") || p.get("view"));
    } catch {
      /* ignore */
    }
    if (urlHasGame) this.S.screen = "loading";
    this.booted = true;
    this.emit();
    let viewCode: string | null = null;
    try {
      viewCode = new URLSearchParams(window.location.search).get("view");
    } catch {
      viewCode = null;
    }
    if (viewCode) {
      const ok = await this.joinViewerCode(viewCode);
      if (ok) {
        await this.routeFromUrl();
      } else if (this.authGated()) {
        this.emit();
      } else {
        await this.enterApp();
      }
    } else if (this.authGated()) {
      /* wait for sign-in */
    } else {
      await this.enterApp();
    }
  }

  /* ---------- Game flow ---------- */

  startNewGame(): void {
    const keepHistory = this.S.history;
    const keepLast = this.S.lastLineup;
    const keepPref = this.S.preferredLineup;
    const keepTeam = this.S.teamName;
    const keepSettings = { ...this.S.settings };
    const roster = this.S.roster.map((r) => ({ ...r, tired: false }));
    this.resetLiveSession();
    this.S = freshState();
    this.S.history = keepHistory;
    this.S.lastLineup = keepLast;
    this.S.preferredLineup = keepPref;
    this.S.roster = roster;
    this.S.teamName = keepTeam;
    this.S.settings = keepSettings;
    this.S.screen = "setup";
    this.S.setupTab = "lineup";
    this.emit();
  }

  leaveLiveGame(): void {
    this.unsubscribeLive();
    this.resetLiveSession();
    this.S = freshState();
    this.SB.historyLoaded = false;
    this.SB.historyError = "";
    this.emit();
  }

  closeFinishedGame(): void {
    if (this.SB.viewerMode && !this.SB.authUser) {
      this.leaveLiveGame();
      return;
    }
    this.S.removedPositions = [];
    this.S.shortMode = false;
    this.S.editingLive = false;
    this.S.screen = "setup";
    this.S.setupTab = "history";
    this.emit();
  }

  startGame(): void {
    const S = this.S;
    const empty = emptySpotsLabel(S);
    if (empty) {
      S.error = "Fill " + empty + " to start.";
      S.screen = "review";
      this.emit();
      return;
    }
    S.screen = "live";
    S.liveTab = "actions";
    S.clockBase = 0;
    S.clockAnchorAt = Date.now();
    S.running = true;
    S.elapsed = 0;
    S.minutesSec = Array(S.roster.length).fill(0);
    S.gkSec = Array(S.roster.length).fill(0);
    S.posSec = Array.from({ length: S.roster.length }, () => ({}));
    S.stints = Array(S.roster.length).fill(null);
    S.goals = [];
    S.queue = [];
    S.ourScore = 0;
    S.theirScore = 0;
    S.undoStack = [];
    S.halftimeDone = false;
    S.plannedLineup = null;
    S.startingLineup = [...S.lineup];
    this.openStints();
    this.emit();
    void this.startLiveDriver();
  }

  async finishGame(): Promise<void> {
    this.pauseClock();
    const S = this.S;
    const players = S.roster.map((r, i) => ({
      name: r.name,
      present: r.present,
      seconds: totalSec(S, i),
      gkSeconds: liveGkSec(S, i),
      goals: S.goals.filter((g) => g.player === i).length,
      posSeconds: livePosSecAll(S, i),
    }));
    const game: HistoryGame = {
      date: new Date().toLocaleDateString(),
      dateISO: new Date().toISOString().slice(0, 10),
      teamName: S.teamName,
      ourScore: S.ourScore,
      theirScore: S.theirScore,
      lineup: [...(S.startingLineup || S.lineup)],
      players,
      goals: [...S.goals],
      playedSeconds: S.elapsed,
      matchMinutes: S.settings.matchMinutes,
    };
    S.history.push(game);
    S.lastLineup = [...(S.startingLineup || S.lineup)];
    S.screen = "finished";
    this.emit();
    this.replaceUrl(this.homeUrl());
    await this.saveHistoryGame(game);
    await this.finishLiveGame();
    if (game.backendId) S.saveNote = "Game saved to history.";
    else if (this.SB.configured)
      S.saveNote = "Game saved on this device only — download the CSV as a backup.";
    this.emit();
  }

  discardFinishedGame(): void {
    const last = this.S.history[this.S.history.length - 1];
    if (!last) return;
    this.openConfirm(
      "Discard this game?",
      "It will be removed from history. Roster, settings, and earlier games are kept.",
      "Discard game",
      true,
      () => {
        void (async () => {
          await this.discardHistoryGame(last);
          this.S.lastLineup =
            this.S.history.length && this.S.history[this.S.history.length - 1].lineup
              ? [...this.S.history[this.S.history.length - 1].lineup]
              : null;
          this.startNewGame();
        })();
      },
    );
  }

  startSecondHalf(): void {
    const S = this.S;
    if (S.plannedLineup) {
      this.pushUndo("halftime plan");
      S.lineup = dedupeLineup([...S.plannedLineup]);
      S.plannedLineup = null;
    }
    S.halftimeDone = true;
    S.screen = "live";
    S.liveTab = "actions";
    this.resumeClock();
    this.emit(true);
  }

  /* ---------- Substitutions / swap / selection ---------- */

  handleFieldTap(pos: number, player: number): void {
    const S = this.S;
    if (S.swapPair.includes(pos)) {
      S.swapPair = S.swapPair.filter((x) => x !== pos);
      S.selection = null;
      this.emit();
      return;
    }
    if (S.selection && S.selection.kind === "out" && S.selection.pos === pos) {
      S.selection = null;
      this.emit();
      return;
    }
    if (S.selection && S.selection.kind === "in") {
      if (S.queue.find((q) => q.pos === pos)) return;
      const incoming = S.selection.player;
      S.queue.push({ out: player, in: incoming, pos });
      S.selection = null;
      this.emit(true);
      return;
    }
    if (S.queue.length) {
      S.selection = { kind: "out", player, pos };
      this.emit();
      return;
    }
    if (S.selection && S.selection.kind === "out" && S.selection.pos !== pos) {
      S.swapPair = [S.selection.pos, pos];
      S.selection = null;
      this.emit();
      return;
    }
    S.selection = { kind: "out", player, pos };
    this.emit();
  }

  handleBenchTap(i: number): void {
    const S = this.S;
    if (S.queue.find((x) => x.in === i)) return;
    if (S.swapPair.length === 2) return;
    if (S.selection && S.selection.kind === "out") {
      S.queue.push({ out: S.selection.player, in: i, pos: S.selection.pos });
      S.selection = null;
      this.emit(true);
      return;
    }
    if (S.selection && S.selection.kind === "in" && S.selection.player === i) {
      S.selection = null;
      this.emit();
      return;
    }
    S.selection = { kind: "in", player: i, pos: -1 };
    this.emit();
  }

  tapSpot(pos: number): void {
    const S = this.S;
    if (this.isViewer()) {
      S.error = "View-only — sign in as a coach to make changes.";
      this.emit();
      return;
    }
    if (S.screen === "halftime" || S.screen === "setup") {
      this.modal = { kind: "picker", pos };
      this.emit();
      return;
    }
    if (S.screen === "live") {
      if (S.removedPositions.includes(pos)) {
        this.pushUndo("restore position");
        S.removedPositions = S.removedPositions.filter((x) => x !== pos);
        S.shortMode = S.removedPositions.length > 0;
        this.emit(true);
        return;
      }
      const player = S.lineup[pos];
      if (player == null) {
        this.modal = { kind: "picker", pos };
        this.emit();
        return;
      }
      this.handleFieldTap(pos, player);
      return;
    }
  }

  tapBench(i: number): void {
    if (this.isViewer()) {
      this.S.error = "View-only — sign in as a coach to make changes.";
      this.emit();
      return;
    }
    if (this.S.screen === "live") this.handleBenchTap(i);
  }

  pickPlayer(i: number, pos: number): void {
    const S = this.S;
    if (S.screen === "halftime") {
      if (S.plannedLineup) placeOnField(S.plannedLineup, pos, i);
    } else {
      this.pushUndo("lineup edit");
      if (S.screen === "live") this.bankStints();
      placeOnField(S.lineup, pos, i);
      S.removedPositions = S.removedPositions.filter((x) => x !== pos);
      if (S.screen === "live") this.openStints();
    }
    this.modal = null;
    this.emit(true);
  }

  clearSpot(pos: number): void {
    const S = this.S;
    if (S.screen === "halftime") {
      if (S.plannedLineup) S.plannedLineup[pos] = null;
    } else {
      this.pushUndo("lineup edit");
      if (S.screen === "live") this.bankStints();
      S.lineup[pos] = null;
      if (S.screen === "live") this.openStints();
    }
    this.modal = null;
    this.emit(true);
  }

  suggestRotation(): void {
    const S = this.S;
    const tiredOn = onField(S).filter((x) => S.roster[x.player].tired);
    const lowBench = this.benchPlayers().sort(
      (a, b) => totalSec(S, a) - totalSec(S, b),
    );
    const outPool = tiredOn.length
      ? tiredOn
      : onField(S)
          .sort((a, b) => totalSec(S, b.player) - totalSec(S, a.player))
          .slice(0, S.settings.subsPerRotation);
    const n = Math.min(S.settings.subsPerRotation, outPool.length, lowBench.length);
    S.queue = [];
    for (let i = 0; i < n; i++)
      S.queue.push({ out: outPool[i].player, in: lowBench[i], pos: outPool[i].pos });
    this.emit(true);
  }

  benchPlayers(): number[] {
    const S = this.S;
    const on = new Set(S.lineup.filter((x) => x != null));
    return S.roster
      .map((_, i) => i)
      .filter((i) => !on.has(i) && S.roster[i].present);
  }

  applyQueue(): void {
    const S = this.S;
    if (!S.queue.length) return;
    this.pushUndo("apply subs");
    this.bankStints();
    for (const q of S.queue) placeOnField(S.lineup, q.pos, q.in);
    S.queue = [];
    S.selection = null;
    this.openStints();
    this.emit(true);
  }

  doSwap(): void {
    const S = this.S;
    if (S.swapPair.length !== 2) return;
    this.pushUndo("swap");
    this.bankStints();
    const [a, b] = S.swapPair;
    const tmp = S.lineup[a];
    S.lineup[a] = S.lineup[b];
    S.lineup[b] = tmp;
    S.swapPair = [];
    S.selection = null;
    this.openStints();
    this.emit(true);
  }

  /* ---------- Scores / goals ---------- */

  recordGoal(side: "us" | "them", player: number | "skip"): void {
    const S = this.S;
    this.pushUndo("goal");
    S.goals.push({
      player: player === "skip" ? null : player,
      seconds: this.scorerMinute * 60,
      side,
    });
    if (side === "us") S.ourScore += 1;
    else S.theirScore += 1;
    this.modal = null;
    this.emit(true);
  }

  scoreAction(k: string): void {
    const S = this.S;
    if (k === "us-plus") {
      this.scorerMinute = Math.floor(S.elapsed / 60);
      this.modal = { kind: "scorer", side: "us" };
      this.emit();
      return;
    }
    if (k === "them-plus") {
      this.scorerMinute = Math.floor(S.elapsed / 60);
      this.recordGoal("them", "skip");
      return;
    }
    if (k === "us-minus") {
      this.pushUndo("remove goal");
      const idx = [...S.goals]
        .map((g, i) => i)
        .reverse()
        .find((i) => S.goals[i].side === "us");
      if (idx !== undefined) S.goals.splice(idx, 1);
      S.ourScore = Math.max(0, S.ourScore - 1);
      this.emit(true);
      return;
    }
    if (k === "them-minus") {
      this.pushUndo("remove goal");
      const idx = [...S.goals]
        .map((g, i) => i)
        .reverse()
        .find((i) => S.goals[i].side === "them");
      if (idx !== undefined) S.goals.splice(idx, 1);
      S.theirScore = Math.max(0, S.theirScore - 1);
      this.emit(true);
      return;
    }
  }

  pauseToggle(): void {
    if (this.S.running) this.pauseClock();
    else this.resumeClock();
    this.emit(true);
  }

  plus2(): void {
    const S = this.S;
    onField(S).forEach(({ player, pos }) => {
      S.minutesSec[player] = (S.minutesSec[player] || 0) + 120;
      S.posSec[player] = S.posSec[player] || {};
      const p = ["GK", "RB", "LB", "RM", "CM", "LM", "ST"][pos];
      S.posSec[player][p] = (S.posSec[player][p] || 0) + 120;
      if (pos === 0) S.gkSec[player] = (S.gkSec[player] || 0) + 120;
    });
    S.clockBase += 120;
    this.syncClock();
    this.emit(true);
  }

  goalMinuteAdjust(gi: number, delta: number): void {
    const S = this.S;
    this.pushUndo("edit goal minute");
    const g = S.goals[gi];
    if (!g) return;
    const cur = g.seconds == null ? 0 : g.seconds;
    g.seconds = Math.max(
      0,
      Math.min(S.settings.matchMinutes * 60, cur + delta * 60),
    );
    this.modal = { kind: "editGoalsLive" };
    this.emit(true);
  }

  goalRemoveLive(gi: number): void {
    const S = this.S;
    this.pushUndo("remove goal");
    const g = S.goals[gi];
    if (!g) return;
    if (g.side === "us") S.ourScore = Math.max(0, S.ourScore - 1);
    else S.theirScore = Math.max(0, S.theirScore - 1);
    S.goals.splice(gi, 1);
    this.modal = { kind: "editGoalsLive" };
    this.emit(true);
  }

  /* ---------- Roster actions ---------- */

  toggleAttend(i: number): void {
    const S = this.S;
    S.roster[i].present = !S.roster[i].present;
    if (!S.roster[i].present) {
      const pos = S.lineup.indexOf(i);
      if (pos >= 0) {
        this.bankStints();
        S.lineup[pos] = null;
        this.openStints();
      }
    }
    this.emit(true);
  }

  togglePrefInline(i: number, pp: string): void {
    const r = this.S.roster[i];
    if (r.prefs.includes(pp)) {
      if (r.prefs.length <= 1) {
        this.S.error = "Keep at least one preferred position.";
        this.emit();
        return;
      }
      r.prefs = r.prefs.filter((x) => x !== pp);
    } else r.prefs = [...r.prefs, pp];
    this.emit();
    void this.saveRosterAuto();
  }

  togglePrefEditor(i: number, p: string): void {
    const r = this.S.roster[i];
    r.prefs = r.prefs.includes(p)
      ? r.prefs.filter((x) => x !== p)
      : [...r.prefs, p];
    this.emit();
    void this.saveRosterAuto();
  }

  saveRename(i: number, name: string): void {
    if (!name.trim()) {
      this.S.error = "Enter a name first.";
      this.emit();
      return;
    }
    this.S.roster[i].name = name.trim();
    this.modal = null;
    this.emit();
    void this.saveRosterAuto();
  }

  saveAddPlayer(name: string): void {
    if (!name.trim()) {
      this.S.error = "Enter a name first.";
      this.emit();
      return;
    }
    this.S.roster.push({
      name: name.trim(),
      prefs: ["ST", "RM", "CM", "LM", "RB", "LB"],
      present: true,
      tired: false,
      note: "",
    });
    this.S.minutesSec.push(0);
    this.S.gkSec.push(0);
    this.S.posSec.push({});
    this.S.stints.push(null);
    this.modal = null;
    this.emit();
    void this.saveRosterAuto();
  }

  removePlayer(i: number): void {
    const S = this.S;
    S.undoStack = [];
    S.roster.splice(i, 1);
    S.minutesSec.splice(i, 1);
    S.gkSec.splice(i, 1);
    S.posSec.splice(i, 1);
    S.stints.splice(i, 1);
    const shift = (x: number | null) =>
      x == null ? null : x === i ? null : x > i ? x - 1 : x;
    S.lineup = S.lineup.map(shift);
    if (S.startingLineup) S.startingLineup = S.startingLineup.map(shift);
    if (S.plannedLineup) S.plannedLineup = S.plannedLineup.map(shift);
    this.modal = null;
    this.emit();
    void this.saveRosterAuto();
  }

  toggleTired(i: number): void {
    this.S.roster[i].tired = !this.S.roster[i].tired;
    this.modal = null;
    this.emit(true);
  }

  saveNote(i: number, text: string): void {
    this.S.roster[i].note = text;
    this.modal = null;
    this.emit();
    // Spec §18.6: the port saves the note immediately (original had a gap).
    void this.saveRosterAuto();
  }

  playerLeaving(i: number): void {
    const S = this.S;
    this.modal = null;
    this.pushUndo("player leaving");
    S.roster[i].present = false;
    const pos = S.lineup.indexOf(i);
    if (pos >= 0) {
      this.bankStints();
      S.lineup[pos] = null;
      this.openStints();
    }
    this.emit(true);
  }

  playerArrived(i: number): void {
    this.modal = null;
    this.S.roster[i].present = true;
    this.emit(true);
  }

  /* ---------- Modal helpers ---------- */

  openConfirm(
    title: string,
    body: string,
    confirmLabel: string,
    danger: boolean,
    onConfirm: () => void,
  ): void {
    this.confirmFn = onConfirm;
    this.modal = { kind: "confirm", title, body, confirmLabel, danger };
    this.emit();
  }

  closeModal(): void {
    this.modal = null;
    this.confirmFn = null;
    this.emit();
  }

  confirmModal(): void {
    const fn = this.confirmFn;
    this.confirmFn = null;
    this.modal = null;
    this.emit();
    if (fn) fn();
  }

  /* ---------- Misc actions used by the view ---------- */

  applyLastLineup(): void {
    const S = this.S;
    if (!S.lastLineup) return;
    this.modal = null;
    S.removedPositions = [];
    S.shortMode = false;
    S.lineup = dedupeLineup(
      S.lastLineup.map((i) =>
        i != null && S.roster[i] && S.roster[i].present ? i : null,
      ),
    );
    this.emit();
  }

  applyPreferredLineup(): void {
    const S = this.S;
    if (!S.preferredLineup) return;
    this.modal = null;
    S.removedPositions = [];
    S.shortMode = false;
    S.lineup = dedupeLineup(
      S.preferredLineup.map((i) =>
        i != null && S.roster[i] && S.roster[i].present ? i : null,
      ),
    );
    this.emit();
  }

  savePreferredLineup(): void {
    this.modal = null;
    this.S.preferredLineup = [...this.S.lineup];
    this.emit();
    void this.saveRosterAuto();
  }

  clearPreferredLineup(): void {
    this.S.preferredLineup = null;
    this.modal = null;
    this.emit();
    void this.saveRosterAuto();
  }

  autoRefreshLineup(): void {
    const S = this.S;
    S.lineup = autoLineup(S, false);
    S.removedPositions = [];
    S.shortMode = false;
    this.emit();
  }

  clearLineup(): void {
    const S = this.S;
    S.lineup = [null, null, null, null, null, null, null];
    S.removedPositions = [];
    S.shortMode = false;
    this.emit();
  }

  removePosition(pos: number): void {
    const S = this.S;
    this.pushUndo("play short");
    this.bankStints();
    S.lineup[pos] = null;
    S.removedPositions = [pos];
    S.shortMode = true;
    this.modal = null;
    this.openStints();
    this.emit(true);
  }

  fullStrength(): void {
    const S = this.S;
    this.pushUndo("full strength");
    S.removedPositions = [];
    S.shortMode = false;
    this.emit(true);
  }

  planRefresh(): void {
    const S = this.S;
    S.planCount = (S.planCount || 1) + 1;
    S.plannedLineup = autoLineup(S, true);
    this.emit(true);
  }

  snapClock(): void {
    const S = this.S;
    S.clockBase = S.settings.matchMinutes * 30;
    if (S.running) S.clockAnchorAt = Date.now();
    this.syncClock();
    this.emit(true);
  }

  goHalftime(): void {
    this.pauseClock();
    this.S.plannedLineup = null;
    this.S.screen = "halftime";
    this.emit(true);
  }

  goEndGame(): void {
    this.openConfirm(
      "End the game?",
      "The finished summary and CSV will be saved to this session’s history.",
      "End game",
      false,
      () => {
        void this.finishGame();
      },
    );
  }

  goShutdownGame(id: string): void {
    this.openConfirm(
      "Shut down this game?",
      "The live game will be discarded and not saved to history. Finished games in history, the roster, and settings are kept.",
      "Shut down game",
      true,
      () => {
        void this.shutdownLiveGame(id);
      },
    );
  }

  goEditLineup(): void {
    this.pauseClock();
    this.S.editingLive = true;
    this.S.screen = "setup";
    this.emit(true);
  }

  backToLive(): void {
    this.S.editingLive = false;
    this.S.screen = "live";
    this.emit();
  }

  goReview(): void {
    const empty = emptySpotsLabel(this.S);
    if (empty) {
      this.S.error = "Fill " + empty + " to review & start.";
      this.emit();
      return;
    }
    this.S.screen = "review";
    this.emit();
  }

  backToSetup(): void {
    if (this.SB.viewerMode && !this.SB.authUser) {
      this.leaveLiveGame();
      return;
    }
    this.S.screen = "setup";
    this.S.editingLive = false;
    this.emit();
  }

  setSetting(key: string, value: number): void {
    const S = this.S;
    const rec = S.settings as unknown as Record<string, number | boolean>;
    rec[key] = Math.max(1, value || (rec[key] as number));
  }

  setSettingCheck(key: string, checked: boolean): void {
    (this.S.settings as unknown as Record<string, number | boolean>)[key] =
      checked;
  }

  setTeamName(value: string): void {
    this.S.teamName = value || TEAM_DEFAULT;
  }

  /* ---------- CSV downloads ---------- */

  downloadGameCsv(hi: number): void {
    const h = this.S.history[hi];
    if (h) downloadCsv("sub-manager-game.csv", csvForGame(h));
  }

  downloadLastGameCsv(): void {
    const last = this.S.history[this.S.history.length - 1];
    if (last) downloadCsv("sub-manager-game.csv", csvForGame(last));
  }

  downloadSeasonCsv(): void {
    downloadCsv("full-season.csv", seasonCsv(this.S.history));
  }

  downloadAllHistoryCsv(): void {
    downloadCsv(
      "all-history.csv",
      allHistoryCsv(this.S.history, this.S.teamName, this.S.settings.matchMinutes),
    );
  }

  downloadRosterCsv(): void {
    downloadCsv("roster.csv", rosterCsv(this.S.roster));
  }

  /** 'online' event handler. */
  async onOnline(): Promise<void> {
    const SB = this.SB;
    SB.online = true;
    SB.offline = false;
    if (SB.configured) {
      if (SB.authUser) await this.loadHistory();
      if (SB.viewerMode && !SB.authUser) {
        await this.refreshViewer();
      } else if (SB.role === "viewer" && SB.liveCode) {
        const row = await this.fetchLiveRow();
        if (row) this.handleRemoteLive(row);
      } else if (SB.role === "driver" && SB.liveId) {
        this.scheduleLiveSync(true);
      }
    }
    this.emit();
  }

  onOffline(): void {
    this.SB.online = false;
    this.SB.offline = true;
    this.emit();
  }
}

