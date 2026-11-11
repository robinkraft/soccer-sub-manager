// Shared types + constants for the Soccer Substitution Manager port.
// Behaviour spec: ~/workspace/soccer-sub-manager-prism-spec.md

export const POSITIONS = ["GK", "RB", "LB", "RM", "CM", "LM", "ST"] as const;
export type Position = (typeof POSITIONS)[number];
export const TEAM_DEFAULT = "Sample Team";

export interface Player {
  name: string;
  prefs: string[];
  present: boolean;
  tired: boolean;
  note: string;
}

export interface Goal {
  /** roster index, -1 = own goal, null = unknown scorer */
  player: number | null;
  seconds: number | null;
  side: "us" | "them";
  player_name?: string;
}

export interface GamePlayer {
  name: string;
  present: boolean;
  /** counted total, seconds */
  seconds: number;
  gkSeconds: number;
  goals: number;
  posSeconds: Record<string, number>;
}

export interface HistoryGame {
  backendId?: string;
  backendPending?: boolean;
  date: string;
  dateISO: string;
  teamName: string;
  ourScore: number;
  theirScore: number;
  playedSeconds: number;
  matchMinutes: number;
  /** kickoff lineup, indices into players[] (GK…ST) */
  lineup: (number | null)[];
  players: GamePlayer[];
  goals: Goal[];
}

export interface Settings {
  matchMinutes: number;
  cadence: number;
  subsPerRotation: number;
  fairTimeThreshold: number;
  countGoalieTime: boolean;
}

export interface QueuedSub {
  out: number;
  in: number;
  pos: number;
}

export interface Selection {
  kind: "out" | "in";
  player: number;
  pos: number;
}

export interface Stint {
  start: number;
  pos: number;
}

export interface UndoEntry {
  label: string;
  snap: string; // JSON snapshot
}

export type Screen =
  | "setup"
  | "review"
  | "live"
  | "halftime"
  | "finished"
  | "viewer"
  | "loading";

export interface LiveState {
  teamName: string;
  settings: Settings;
  roster: Player[];
  lineup: (number | null)[];
  removedPositions: number[];
  shortMode: boolean;
  elapsed: number;
  running: boolean;
  clock: {
    elapsed_seconds_at_anchor: number;
    anchor_started_at: number | null;
    running: boolean;
  };
  stints: (Stint | null)[];
  ourScore: number;
  theirScore: number;
  minutesSec: number[];
  gkSec: number[];
  posSec: Record<string, number>[];
  goals: Goal[];
  queue: QueuedSub[];
  swapPair: number[];
  plannedLineup: (number | null)[] | null;
  halftimeDone: boolean;
  startingLineup: (number | null)[] | null;
}

export interface AppState {
  screen: Screen;
  setupTab: "lineup" | "roster" | "settings" | "history";
  liveTab: "actions" | "minutes" | "team" | "history";
  viewerTab: "game" | "history";
  expandedHistory: Record<number, boolean>;
  planCount: number;
  teamName: string;
  settings: Settings;
  roster: Player[];
  lineup: (number | null)[];
  removedPositions: number[];
  shortMode: boolean;
  elapsed: number;
  running: boolean;
  clockBase: number;
  clockAnchorAt: number | null;
  minutesSec: number[];
  gkSec: number[];
  posSec: Record<string, number>[];
  stints: (Stint | null)[];
  goals: Goal[];
  queue: QueuedSub[];
  swapPair: number[];
  selection: Selection | null;
  undoStack: UndoEntry[];
  history: HistoryGame[];
  startingLineup: (number | null)[] | null;
  lastLineup: (number | null)[] | null;
  preferredLineup: (number | null)[] | null;
  plannedLineup: (number | null)[] | null;
  editingLive: boolean;
  halftimeDone: boolean;
  showSignin: boolean;
  error: string;
  saveNote: string;
  ourScore: number;
  theirScore: number;
}

/** Fictional 13-player sample roster ONLY. Never use real player names. */
export const DEFAULT_ROSTER: { name: string; prefs: string[] }[] = [
  { name: "Mia", prefs: ["ST", "RM", "CM", "LM", "RB", "LB"] },
  { name: "Liam", prefs: ["ST", "RM", "CM", "LM", "RB", "LB"] },
  { name: "Sofia", prefs: ["ST", "RM", "LM", "GK"] },
  { name: "Noah", prefs: ["RM", "LM"] },
  { name: "Ava", prefs: ["ST", "RM", "LM", "RB", "LB"] },
  { name: "Mateo", prefs: ["ST", "RM", "LM", "RB", "LB"] },
  { name: "Chloe", prefs: ["ST", "RM", "CM", "LM", "RB", "LB"] },
  { name: "Ethan", prefs: ["GK"] },
  { name: "Maya", prefs: ["ST", "RM", "LM"] },
  { name: "Lucas", prefs: ["ST", "RM", "LM"] },
  { name: "Zoe", prefs: ["ST", "RM", "LM", "RB", "LB"] },
  { name: "Oliver", prefs: ["ST", "RM", "CM", "LM", "RB", "LB"] },
  { name: "Grace", prefs: ["GK", "RB", "LB", "RM", "CM", "LM", "ST"] },
];

export function cloneRoster(
  src: { name: string; prefs: string[]; note?: string }[] = DEFAULT_ROSTER,
): Player[] {
  return src.map((p) => ({
    name: p.name,
    prefs: [...p.prefs],
    present: true,
    tired: false,
    note: p.note || "",
  }));
}

export function freshState(): AppState {
  const roster = cloneRoster();
  const n = roster.length;
  return {
    screen: "setup",
    setupTab: "lineup",
    liveTab: "actions",
    viewerTab: "game",
    expandedHistory: {},
    planCount: 1,
    teamName: TEAM_DEFAULT,
    settings: {
      matchMinutes: 50,
      cadence: 5,
      subsPerRotation: 2,
      fairTimeThreshold: 5,
      countGoalieTime: false,
    },
    roster,
    lineup: [null, null, null, null, null, null, null],
    removedPositions: [],
    shortMode: false,
    elapsed: 0,
    running: false,
    clockBase: 0,
    clockAnchorAt: null,
    minutesSec: Array(n).fill(0),
    gkSec: Array(n).fill(0),
    posSec: Array.from({ length: n }, () => ({})),
    stints: Array(n).fill(null),
    goals: [],
    queue: [],
    swapPair: [],
    selection: null,
    undoStack: [],
    history: [],
    startingLineup: null,
    lastLineup: null,
    preferredLineup: null,
    plannedLineup: null,
    editingLive: false,
    halftimeDone: false,
    showSignin: false,
    error: "",
    saveNote: "",
    ourScore: 0,
    theirScore: 0,
  };
}
