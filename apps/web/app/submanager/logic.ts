// Pure logic for the Sub Manager port: clock/minutes math, lineup
// generation, goal labels, history mapping, season totals, CSV exports.
// All functions take the app state explicitly; no Supabase, no DOM.

import {
  POSITIONS,
  TEAM_DEFAULT,
  type AppState,
  type Goal,
  type HistoryGame,
} from "./types";

export function fmtClock(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  return (
    String(Math.floor(sec / 60)).padStart(2, "0") +
    ":" +
    String(sec % 60).padStart(2, "0")
  );
}

export function fmtMin(sec: number): string {
  return (sec / 60).toFixed(1);
}

export function shuffle<T>(a: T[]): T[] {
  const x = [...a];
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

export function padArr<T>(arr: T[] | undefined | null, n: number, fill: T): T[] {
  const out = Array.isArray(arr) ? [...arr] : [];
  while (out.length < n) out.push(fill);
  return out.slice(0, n);
}

/* ---------- Wall-clock clock + stints (never ticked) ---------- */

export function clockElapsed(S: AppState): number {
  return (
    S.clockBase +
    (S.running && S.clockAnchorAt ? (Date.now() - S.clockAnchorAt) / 1000 : 0)
  );
}

export function stintSec(S: AppState, i: number): number {
  const st = S.stints[i];
  return st && st.start && S.running
    ? Math.max(0, (Date.now() - st.start) / 1000)
    : 0;
}

export function liveMinutesSec(S: AppState, i: number): number {
  return (S.minutesSec[i] || 0) + stintSec(S, i);
}

export function liveGkSec(S: AppState, i: number): number {
  const st = S.stints[i];
  return (
    (S.gkSec[i] || 0) + (st && st.start && st.pos === 0 ? stintSec(S, i) : 0)
  );
}

export function livePosSec(S: AppState, i: number, pos: number): number {
  const st = S.stints[i];
  const p = POSITIONS[pos];
  return (
    ((S.posSec[i] || {})[p] || 0) +
    (st && st.start && st.pos === pos ? stintSec(S, i) : 0)
  );
}

export function livePosSecAll(S: AppState, i: number): Record<string, number> {
  const out = { ...(S.posSec[i] || {}) };
  const st = S.stints[i];
  if (st && st.start) {
    const p = POSITIONS[st.pos];
    out[p] = (out[p] || 0) + stintSec(S, i);
  }
  return out;
}

/** Counted total toward game time (goalie-adjusted per setting). */
export function totalSec(S: AppState, i: number): number {
  return S.settings.countGoalieTime
    ? liveMinutesSec(S, i)
    : liveMinutesSec(S, i) - liveGkSec(S, i);
}

export function fieldCount(S: AppState): number {
  return S.shortMode ? 6 : 7;
}

export function onField(S: AppState): { player: number; pos: number }[] {
  return S.lineup
    .map((p, i) => (p == null ? null : { player: p, pos: i }))
    .filter((x): x is { player: number; pos: number } => x !== null);
}

export function benchPlayers(S: AppState): number[] {
  const on = new Set(S.lineup.filter((x) => x != null));
  return S.roster.map((_, i) => i).filter((i) => !on.has(i) && S.roster[i].present);
}

export function fairShareSec(S: AppState): number {
  const present = S.roster.filter((r) => r.present).length || 1;
  const countedSlots = S.settings.countGoalieTime
    ? fieldCount(S)
    : fieldCount(S) - 1;
  return (S.settings.matchMinutes * 60 * countedSlots) / present;
}

export function projectedSec(S: AppState, i: number): number {
  const remaining = Math.max(0, S.settings.matchMinutes * 60 - S.elapsed);
  const onPos = S.lineup.indexOf(i);
  const onCounts = onPos >= 0 && (onPos !== 0 || S.settings.countGoalieTime);
  let proj = totalSec(S, i);
  if (onCounts) proj += remaining;
  for (const q of S.queue) {
    const inCounts = q.pos !== 0 || S.settings.countGoalieTime;
    if (q.in === i && inCounts) proj += remaining;
    if (q.out === i) proj = Math.max(totalSec(S, i), proj - remaining);
  }
  return Math.max(totalSec(S, i), proj);
}

export function flagFor(
  S: AppState,
  i: number,
): { cls: "low" | "high" | "ok"; label: string } {
  const fair = fairShareSec(S);
  const proj = projectedSec(S, i);
  const th = S.settings.fairTimeThreshold * 60;
  if (proj > fair + th) return { cls: "high", label: "HIGH" };
  if (proj < fair - th) return { cls: "low", label: "LOW" };
  return { cls: "ok", label: "OK" };
}

export function goalsFor(S: AppState, i: number, side?: "us" | "them"): number {
  return S.goals.filter((g) => g.player === i && (!side || g.side === side))
    .length;
}

export function goalLabel(
  g: Goal,
  players: { name: string }[],
): string {
  let name: string;
  if (g.player === -1) name = "Own goal";
  else if (g.player == null) name = g.player_name || "Unknown scorer";
  else if (g.player_name) name = g.player_name;
  else name = players[g.player] ? players[g.player].name : "?";
  const min = g.seconds == null ? "" : " " + Math.floor(g.seconds / 60) + "'";
  return name + min;
}

/** Unknown-scorer THEM goals are never listed anywhere. */
export function displayGoals(goals: Goal[] | undefined | null): Goal[] {
  return (goals || []).filter(
    (g) => !(g.player == null && (g.side || "us") === "them"),
  );
}

export function emptySpots(S: AppState): number[] {
  const removed = new Set(S.removedPositions || []);
  return POSITIONS.map((_, i) => i).filter(
    (i) => !removed.has(i) && (S.lineup || [])[i] == null,
  );
}

export function emptySpotsLabel(S: AppState): string {
  const names = emptySpots(S).map((i) => POSITIONS[i]);
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

/* ---------- Lineup ---------- */

export function dedupeLineup(
  lineup: (number | null)[] | undefined | null,
): (number | null)[] {
  const seen = new Set<number>();
  return (lineup || []).map((x) => {
    if (x == null || seen.has(x)) return null;
    seen.add(x);
    return x;
  });
}

/** One player, one field spot: placing a player at a second spot clears the first. */
export function placeOnField(
  lineup: (number | null)[],
  pos: number,
  player: number | null,
): void {
  if (player == null) {
    lineup[pos] = null;
    return;
  }
  for (let k = 0; k < lineup.length; k++)
    if (k !== pos && lineup[k] === player) lineup[k] = null;
  lineup[pos] = player;
}

export function autoLineup(S: AppState, favourLow: boolean): (number | null)[] {
  const present = S.roster.map((_, i) => i).filter((i) => S.roster[i].present);
  const pool = shuffle(present);
  if (favourLow) pool.sort((a, b) => totalSec(S, a) - totalSec(S, b));
  const used = new Set<number>();
  const out: (number | null)[] = [null, null, null, null, null, null, null];
  for (const pos of [0, 1, 2, 3, 4, 5, 6]) {
    const cand = pool.filter(
      (i) => !used.has(i) && S.roster[i].prefs.includes(POSITIONS[pos]),
    );
    if (cand.length) {
      used.add(cand[0]);
      out[pos] = cand[0];
    }
  }
  for (let pos = 0; pos < 7; pos++) {
    if (out[pos] == null) {
      const cand = pool.filter((i) => !used.has(i));
      if (cand.length) {
        used.add(cand[0]);
        out[pos] = cand[0];
      }
    }
  }
  return out;
}

/* ---------- History mapping (Supabase rows <-> internal games) ---------- */

export function backendPlayersFromGame(h: HistoryGame) {
  return (h.players || []).map((p, i) => ({
    name: p.name,
    roster_index: i,
    present: !!p.present,
    total_minutes: +((p.seconds || 0) / 60).toFixed(2),
    goalie_minutes: +((p.gkSeconds || 0) / 60).toFixed(2),
    goals: p.goals || 0,
    minutes_by_position: Object.fromEntries(
      Object.entries(p.posSeconds || {}).map(([k, v]) => [k, +(v / 60).toFixed(2)]),
    ),
  }));
}

export function backendGoalsFromGame(h: HistoryGame, rosterNames: string[]) {
  return (h.goals || []).map((g) => ({
    player_index: g.player == null ? null : g.player,
    player_name:
      g.player === -1
        ? "Own goal"
        : g.player == null
          ? null
          : g.player_name ||
            ((h.players || [])[g.player]
              ? h.players[g.player].name
              : rosterNames[g.player] || null),
    seconds: g.seconds == null ? null : g.seconds,
    side: g.side || "us",
  }));
}

export function internalGameFromRow(row: Record<string, unknown>): HistoryGame {
  const players = ((row.players as unknown[]) || []).map((p) => {
    const q = p as Record<string, unknown>;
    return {
      name: String(q.name || ""),
      present: !!q.present,
      seconds: (Number(q.total_minutes) || 0) * 60,
      gkSeconds: (Number(q.goalie_minutes) || 0) * 60,
      goals: Number(q.goals) || 0,
      posSeconds: Object.fromEntries(
        Object.entries(
          (q.minutes_by_position as Record<string, number>) || {},
        ).map(([k, v]) => [k, v * 60]),
      ),
    };
  });
  const goals = ((row.goals as unknown[]) || []).map((g) => {
    const q = g as Record<string, unknown>;
    let player: number | null = null;
    let name: string | undefined =
      q.player_name && q.player_name !== "Own goal"
        ? String(q.player_name)
        : undefined;
    if (q.player_index === -1) {
      player = -1;
      name = "Own goal";
    } else if (name) {
      const idx = ((row.players as unknown[]) || []).findIndex(
        (p) => (p as Record<string, unknown>).name === name,
      );
      if (idx !== -1) player = idx;
    }
    if (
      player == null &&
      typeof q.player_index === "number" &&
      q.player_index >= 0 &&
      ((row.players as unknown[]) || [])[q.player_index]
    ) {
      player = q.player_index as number;
      if (!name)
        name = String(
          ((row.players as unknown[])[q.player_index] as Record<string, unknown>)
            .name || "",
        );
    }
    return {
      player,
      player_name: name,
      seconds: q.seconds == null ? null : Number(q.seconds),
      side: (q.side as "us" | "them") || "us",
    };
  });
  let date = "";
  try {
    date = row.game_date
      ? new Date(String(row.game_date) + "T12:00:00").toLocaleDateString()
      : new Date(String(row.created_at)).toLocaleDateString();
  } catch {
    date = String(row.game_date || "");
  }
  return {
    backendId: String(row.id),
    date,
    dateISO: String(row.game_date || ""),
    teamName: String(row.team_name || TEAM_DEFAULT),
    ourScore: Number(row.our_score) || 0,
    theirScore: Number(row.their_score) || 0,
    playedSeconds: Number(row.elapsed_seconds) || 0,
    lineup: ((row.starting_lineup as unknown[]) || []).map((x) =>
      x == null ? null : Number(x),
    ),
    players,
    goals,
    matchMinutes: Number(row.match_minutes) || 50,
  };
}

/* ---------- Season totals ---------- */

export interface SeasonTotal {
  name: string;
  seconds: number;
  games: number;
  goals: number;
  gkSeconds: number;
  pos: Record<string, number>;
}

export function seasonGoalsByName(history: HistoryGame[]): Map<string, number> {
  const goals = new Map<string, number>();
  history.forEach((h) =>
    (h.goals || []).forEach((g) => {
      if ((g.side || "us") !== "us") return;
      if (g.player == null || g.player === -1) return;
      const name =
        g.player_name || ((h.players || [])[g.player] || {}).name;
      if (name) goals.set(name, (goals.get(name) || 0) + 1);
    }),
  );
  return goals;
}

export function computeSeasonTotals(history: HistoryGame[]): SeasonTotal[] {
  const totals = new Map<string, SeasonTotal>();
  history.forEach((h) =>
    (h.players || []).forEach((p) => {
      const t = totals.get(p.name) || {
        name: p.name,
        seconds: 0,
        games: 0,
        goals: 0,
        gkSeconds: 0,
        pos: {} as Record<string, number>,
      };
      t.seconds += p.seconds || 0;
      t.gkSeconds += p.gkSeconds || 0;
      if (p.present) t.games += 1;
      Object.entries(p.posSeconds || {}).forEach(([k, v]) => {
        t.pos[k] = (t.pos[k] || 0) + v;
      });
      totals.set(p.name, t);
    }),
  );
  const seasonGoals = seasonGoalsByName(history);
  totals.forEach((t) => {
    t.goals = seasonGoals.get(t.name) || 0;
  });
  return [...totals.values()].sort((a, b) => b.seconds - a.seconds);
}

/* ---------- CSV exports ---------- */

export function csvCell(v: unknown): string {
  return '"' + String(v).replace(/"/g, '""') + '"';
}

export function isoDateOf(h: HistoryGame): string {
  if (h.dateISO) return h.dateISO;
  const m = String(h.date || "").match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m
    ? m[3] + "-" + m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0")
    : String(h.date || "");
}

export function goalRowsForCsv(h: HistoryGame): (string | number)[][] {
  return displayGoals(h.goals).map((g) => [
    g.player === -1
      ? "Own goal"
      : g.player == null
        ? "Unknown scorer"
        : g.player_name ||
          ((h.players || [])[g.player] ? h.players[g.player].name : "?"),
    g.seconds == null ? "" : Math.floor(g.seconds / 60),
    g.side || "us",
  ]);
}

export function csvForGame(h: HistoryGame): string {
  const head = "Player,Present,Actual minutes,GK minutes,Goals,Positions\n";
  const lines = h.players.map((p) =>
    [
      p.name,
      p.present ? "yes" : "no",
      fmtMin(p.seconds),
      fmtMin(p.gkSeconds || 0),
      p.goals || 0,
      Object.entries(p.posSeconds || {})
        .map(([k, v]) => k + ":" + fmtMin(v))
        .join("; "),
    ]
      .map((v) => '"' + String(v).replace(/"/g, '""') + '"')
      .join(","),
  );
  return head + lines.join("\n") + "\n";
}

export function seasonCsv(history: HistoryGame[]): string {
  const totals = computeSeasonTotals(history);
  const head =
    ["Player", "Games played", "Avg minutes per game", "Total minutes", "GK minutes", "Goals", ...POSITIONS].join(",") + "\n";
  const lines = totals.map((t) => {
    const cells = [
      t.name,
      t.games,
      t.games ? ((t.seconds / 60) / t.games).toFixed(1) : "0.0",
      (t.seconds / 60).toFixed(1),
      (t.gkSeconds / 60).toFixed(1),
      t.goals,
      ...POSITIONS.map((k) => ((t.pos[k] || 0) / 60).toFixed(1)),
    ];
    return cells.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",");
  });
  return head + lines.join("\n") + "\n";
}

export function allHistoryCsv(
  history: HistoryGame[],
  teamName: string,
  matchMinutes: number,
): string {
  const teamLine = "Team," + csvCell(teamName) + "\n";
  const gamesHead =
    "\nGames\nGame date,Our score,Their score,Match minutes,Played seconds,Starting lineup (GK;RB;LB;RM;CM;LM;ST)\n";
  const gamesRows = history
    .map((h) => {
      const lineup = (h.lineup || [])
        .map((i) => (i == null ? "" : (h.players || [])[i] ? h.players[i].name : ""))
        .join("; ");
      return [
        isoDateOf(h),
        h.ourScore,
        h.theirScore,
        h.matchMinutes || matchMinutes || 50,
        h.playedSeconds || 0,
        lineup,
      ]
        .map(csvCell)
        .join(",");
    })
    .join("\n");
  const playersHead =
    "\nPlayers\nGame date,Our score,Their score,Player,Present,Actual minutes,GK minutes,Goals,Positions\n";
  const playerRows: string[] = [];
  history.forEach((h) => {
    (h.players || []).forEach((p) => {
      playerRows.push(
        [
          isoDateOf(h),
          h.ourScore,
          h.theirScore,
          p.name,
          p.present ? "yes" : "no",
          fmtMin(p.seconds),
          fmtMin(p.gkSeconds || 0),
          p.goals || 0,
          Object.entries(p.posSeconds || {})
            .map(([k, v]) => k + ":" + fmtMin(v))
            .join("; "),
        ]
          .map(csvCell)
          .join(","),
      );
    });
  });
  const goalsHead = "\nGoals\nGame date,Our score,Their score,Scorer,Minute,Side\n";
  const goalRows: (string | number)[][] = [];
  history.forEach((h) => {
    goalRowsForCsv(h).forEach((r) =>
      goalRows.push([isoDateOf(h), h.ourScore, h.theirScore, ...r]),
    );
  });
  return (
    teamLine +
    gamesHead +
    gamesRows +
    "\n" +
    playersHead +
    playerRows.join("\n") +
    "\n" +
    goalsHead +
    goalRows.map((r) => r.map(csvCell).join(",")).join("\n") +
    (goalRows.length ? "\n" : "")
  );
}

export function rosterCsv(
  roster: { name: string; present: boolean; tired: boolean; prefs: string[]; note: string }[],
): string {
  const head = "Player,Available,Tired,GK,RB,LB,RM,CM,LM,ST,Note\n";
  const lines = roster.map((r) =>
    [
      r.name,
      r.present ? "yes" : "no",
      r.tired ? "yes" : "no",
      ...POSITIONS.map((p) => (r.prefs.includes(p) ? "yes" : "no")),
      r.note || "",
    ]
      .map(csvCell)
      .join(","),
  );
  return head + lines.join("\n") + "\n";
}

export function downloadCsv(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
