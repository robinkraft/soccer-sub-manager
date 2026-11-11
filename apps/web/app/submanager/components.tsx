// Presentational components for the Sub Manager port.
// Field/bench/queue/scoreboard styling follows the original's exact visual
// rules (spec §16); Prism components carry the shell (buttons, cards,
// typography, divider, spinner, layout) where they fit.

import type { ReactNode } from "react";
import {
  PrismCard,
  PrismDivider,
  PrismLayoutMain,
  PrismSpinner,
  PrismTypography,
} from "@ui";
import type { LucideIcon } from "lucide-react";
import { Download, LogIn, Play } from "lucide-react";
import type { Engine } from "./engine";
import { POSITIONS } from "./types";
import {
  benchPlayers,
  computeSeasonTotals,
  displayGoals,
  fieldCount,
  flagFor,
  fmtClock,
  fmtMin,
  goalLabel,
  goalsFor,
  liveGkSec,
  projectedSec,
  totalSec,
} from "./logic";

export { Download, LogIn, Play };

/* ---------- Plain button ---------- */

type BtnKind = "primary" | "default" | "ghost" | "danger" | "apply";

// PBtn renders a plain <button> styled by app.css (button / button.primary /
// button.apply / button.ghost / button.danger / button.small) — exactly as
// the original does. PrismButton painted its sizes via inline style
// (14px font, 8px 14px padding) and the unlayered blanket `button` rule
// capped min-height at 44px, so Apply measured 44px/14px instead of the
// spec's 56px/18px and every primary measured 14px instead of 16px.
// The app.css kind classes carry the spec sizes, so a plain button
// measures correctly with no inline-style fight.
const BTN_CLASS: Record<BtnKind, string> = {
  primary: "primary",
  default: "",
  ghost: "ghost",
  danger: "danger",
  apply: "apply",
};

export function PBtn({
  label,
  onClick,
  kind = "default",
  disabled,
  grow,
  small,
  icon,
  type = "button",
}: {
  label: string;
  onClick?: () => void;
  kind?: BtnKind;
  disabled?: boolean;
  grow?: boolean;
  small?: boolean;
  icon?: LucideIcon;
  type?: "button" | "submit";
}) {
  const Icon = icon;
  const cls = [BTN_CLASS[kind], small ? "small" : "", grow ? "grow" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      className={cls}
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      {Icon ? (
        <span style={{ display: "inline-flex" }}>
          <Icon size={18} strokeWidth={2.5} />
        </span>
      ) : null}
      {label}
    </button>
  );
}

/** Small text link-button (Undo etc.). */
export function LinkBtn({
  label,
  onClick,
  danger,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "min-h-[28px] border-0 bg-transparent px-1 py-[2px] text-[13px] font-bold " +
        (danger ? "text-[#f87171]" : "text-[#94a3b8]")
      }
    >
      {label}
    </button>
  );
}

export function H2({ children }: { children: ReactNode }) {
  return (
    <PrismTypography
      role="headline"
      size="regular"
      as="h2"
      className="mb-2 mt-[14px] text-[18px] font-bold text-[#f1f5f9]"
    >
      {children}
    </PrismTypography>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return (
    <PrismTypography
      role="title"
      size="regular"
      as="h3"
      className="mb-[6px] mt-3 text-[16px] font-bold text-[#f1f5f9]"
    >
      {children}
    </PrismTypography>
  );
}

export function Muted({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <PrismTypography
      role="body"
      size="small"
      as="p"
      className={
        "my-[6px] text-[14px] text-[#94a3b8]" + (center ? " text-center" : "")
      }
    >
      {children}
    </PrismTypography>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <PrismCard className="my-2 gap-2 rounded-[14px] border border-[#1e3a4f] bg-[#122636] px-3 py-3 text-[#f1f5f9] shadow-none">
      {children}
    </PrismCard>
  );
}

export function Tabs({
  tabs,
  current,
  onSelect,
}: {
  tabs: [string, string][];
  current: string;
  onSelect: (k: string) => void;
}) {
  return (
    <div className="tabs mt-[6px] flex gap-[6px] rounded-[14px] bg-[#0f2233] p-1" role="tablist">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={current === k}
          onClick={() => onSelect(k)}
          className={
            "min-h-[44px] flex-1 rounded-[12px] border-2 px-2 text-[16px] font-bold " +
            (current === k
              ? "border-[#f59e0b] bg-[#fef3c7] text-[#78350f] shadow-[0_0_0_2px_#f59e0b]"
              : "border-[#16283a] bg-[#16283a] text-[#cbd5e1]")
          }
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Field ---------- */

export function Field({
  eng,
  lineup,
  names,
  removedPositions,
  showMinutes,
  live,
  readonly,
  swapOverlay,
}: {
  eng: Engine;
  lineup: (number | null)[];
  names: string[];
  removedPositions: number[];
  showMinutes?: boolean;
  live?: boolean;
  readonly?: boolean;
  swapOverlay?: boolean;
}) {
  const S = eng.S;
  const spot = (pos: number) => {
    const p = lineup[pos];
    const removed = removedPositions.includes(pos);
    const queuedOff = live ? S.queue.find((q) => q.pos === pos) : undefined;
    const staged = live === true && S.swapPair.includes(pos);
    const sel =
      live === true &&
      S.selection &&
      S.selection.kind === "out" &&
      S.selection.pos === pos;
    let cls = "chip";
    let badge: ReactNode = null;
    if (removed) cls += " removed";
    else if (p == null) cls += " empty";
    else {
      if (S.roster[p] && S.roster[p].tired) cls += " tired";
      if (sel || staged) cls += staged ? " swap-staged" : " selected";
      if (queuedOff) {
        cls += " queued-off";
        badge = <span className="badge off">↓ {POSITIONS[pos]}</span>;
      }
    }
    const name = removed
      ? "Removed"
      : p == null
        ? POSITIONS[pos]
        : names[p] || "?";
    const mins =
      showMinutes && p != null && !removed
        ? Math.round(totalSec(S, p) / 60) + "m"
        : "";
    const pair = queuedOff ? "→ " + (names[queuedOff.in] || "?") : "";
    const inner = (
      <>
        <span>{name}</span>
        <span className="sub">
          <span className="mins">{mins}</span>
          <span className="pair">{pair}</span>
        </span>
      </>
    );
    return (
      <div className="spot" key={pos}>
        {badge}
        {readonly ? (
          <div className={cls}>{inner}</div>
        ) : (
          <button
            type="button"
            className={cls}
            onClick={() => eng.tapSpot(pos)}
            aria-label={POSITIONS[pos] + " " + (name || "empty")}
          >
            {inner}
          </button>
        )}
      </div>
    );
  };
  const row = (positions: number[], mid?: boolean) => (
    <div className={"f-row" + (mid ? " mid" : "")}>
      {positions.map((p) => spot(p))}
    </div>
  );
  return (
    <div className="field" role="group" aria-label="Field, 1-2-3-1">
      {row([6])}
      {row([3, 4, 5], true)}
      {row([1, 2])}
      <div className="gk-box">{row([0])}</div>
      {swapOverlay ? (
        <div className="field-swap">
          <PBtn label="Swap" kind="primary" onClick={() => eng.doSwap()} />
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Bench ---------- */

export function Bench({
  eng,
  interactive,
}: {
  eng: Engine;
  interactive?: boolean;
}) {
  const S = eng.S;
  const bench = benchPlayers(S);
  if (!bench.length)
    return <Muted>Bench is empty — everyone present is on the field.</Muted>;
  return (
    <div className="bench">
      {bench.map((i) => {
        const q = S.queue.find((x) => x.in === i);
        const sel =
          S.selection && S.selection.kind === "in" && S.selection.player === i;
        const cls = [
          "",
          S.roster[i].tired ? "tired" : "",
          sel ? "selected" : "",
          q ? "queued-on" : "",
        ].join(" ");
        const badge = q ? (
          <span className="b-badge">↑ {POSITIONS[q.pos]}</span>
        ) : null;
        return (
          <button
            key={i}
            type="button"
            className={cls}
            onClick={interactive ? () => eng.tapBench(i) : undefined}
          >
            {badge}
            <span className="b-name">
              {S.roster[i].name}
              {S.roster[i].tired ? <span className="tired-dot"> ●</span> : ""}
            </span>
            <span className="b-sub">
              <span className="b-mins">{Math.round(totalSec(S, i) / 60)}m</span>
              <span className="b-pair">
                {q ? "→ " + S.roster[q.out].name : ""}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Scoreboard ---------- */

export function Scoreboard({
  eng,
  readonly,
}: {
  eng: Engine;
  readonly?: boolean;
}) {
  const S = eng.S;
  if (readonly) {
    return (
      <div className="scoreboard">
        <div className="score-row">
          <div className="side">
            <div className="score-col">
              <span className="team-label">US</span>
              <span className="score-num">{S.ourScore}</span>
            </div>
          </div>
          <div className="clock-mid">
            <div className="clock">{fmtClock(S.elapsed)}</div>
          </div>
          <div className="side">
            <div className="score-col">
              <span className="team-label">THEM</span>
              <span className="score-num">{S.theirScore}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="scoreboard">
      <div className="score-row">
        <div className="side">
          <button type="button" onClick={() => eng.scoreAction("us-minus")} aria-label="US minus">
            −
          </button>
          <div className="score-col">
            <span className="team-label">US</span>
            <span className="score-num">{S.ourScore}</span>
          </div>
          <button type="button" onClick={() => eng.scoreAction("us-plus")} aria-label="US plus">
            +
          </button>
        </div>
        <div className="clock-mid">
          <div className="clock">{fmtClock(S.elapsed)}</div>
          <div className="clock-controls">
            <button type="button" className="pill" onClick={() => eng.plus2()}>
              +2:00
            </button>
            <button
              type="button"
              className="pill pause"
              onClick={() => eng.pauseToggle()}
            >
              {S.running ? "❚❚ PAUSE" : "RESUME"}
            </button>
          </div>
        </div>
        <div className="side">
          <button
            type="button"
            onClick={() => eng.scoreAction("them-minus")}
            aria-label="Them minus"
          >
            −
          </button>
          <div className="score-col">
            <span className="team-label">THEM</span>
            <span className="score-num">{S.theirScore}</span>
          </div>
          <button
            type="button"
            onClick={() => eng.scoreAction("them-plus")}
            aria-label="Them plus"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Roster rows ---------- */

export function RosterRows({ eng }: { eng: Engine }) {
  const S = eng.S;
  const idx = S.roster
    .map((_, i) => i)
    .sort((a, b) => S.roster[a].name.localeCompare(S.roster[b].name));
  const inGame = S.screen === "live" || S.screen === "halftime";
  const showSetupOnly = S.screen === "setup" && !S.editingLive;
  const showRename = showSetupOnly;
  const showPrefs = showSetupOnly;
  return (
    <>
      {idx.map((i) => {
        const r = S.roster[i];
        const pos = S.lineup.indexOf(i);
        const g = goalsFor(S, i);
        const where = pos >= 0 ? POSITIONS[pos] : "Bench";
        const status = r.present
          ? where +
            " · " +
            fmtMin(totalSec(S, i)) +
            " min" +
            (showPrefs ? " · " + r.prefs.length + " pos" : "")
          : "Absent" + (showPrefs ? " · " + r.prefs.length + " pos" : "");
        const chips = showPrefs
          ? POSITIONS.map((pp) => (
              <button
                key={pp}
                type="button"
                aria-pressed={r.prefs.includes(pp)}
                onClick={() => eng.togglePrefInline(i, pp)}
              >
                {pp}
              </button>
            ))
          : null;
        const arriveLeave = inGame ? (
          r.present ? (
            <button
              key="lv"
              type="button"
              className="xs"
              onClick={() => eng.playerLeaving(i)}
            >
              Leaving
            </button>
          ) : (
            <button
              key="ar"
              type="button"
              className="xs"
              onClick={() => eng.playerArrived(i)}
            >
              Arrived
            </button>
          )
        ) : null;
        const secondRow =
          chips || arriveLeave ? (
            <div className="pos-chips">
              {chips}
              {arriveLeave}
            </div>
          ) : null;
        return (
          <div className="card roster-row" key={i}>
            <div className="roster-top">
              <button
                type="button"
                className={"avail" + (r.present ? "" : " absent")}
                onClick={() => eng.toggleAttend(i)}
                aria-label={"Toggle availability for " + r.name}
              >
                {r.present ? "✓" : ""}
              </button>
              <div className="roster-id">
                <span className="name">{r.name}</span>
                {g ? <span> ⚽ {g}</span> : ""}
                <span className="muted small"> {status}</span>
              </div>
              {showRename ? (
                <button
                  type="button"
                  className="xs"
                  onClick={() => {
                    eng.modal = { kind: "rename", player: i };
                    eng.emit();
                  }}
                >
                  Rename
                </button>
              ) : null}
              <button
                type="button"
                className="xs"
                onClick={() => {
                  eng.modal = { kind: "more", player: i };
                  eng.emit();
                }}
              >
                More
              </button>
            </div>
            {r.note ? <div className="note-line">{r.note}</div> : null}
            {secondRow}
          </div>
        );
      })}
    </>
  );
}

/* ---------- History + season totals ---------- */

export function SeasonTotals({ eng }: { eng: Engine }) {
  const S = eng.S;
  if (!S.history.length) return null;
  const totals = computeSeasonTotals(S.history);
  const anonViewer = eng.isViewer();
  return (
    <>
      <div className="row spread" style={{ alignItems: "baseline" }}>
        <h2 style={{ marginBottom: 2 }}>Season totals</h2>
        {!anonViewer ? (
          <span>
            <button
              type="button"
              className="season-csv-link"
              onClick={() => eng.downloadSeasonCsv()}
            >
              ↓ Full season CSV
            </button>
            <button
              type="button"
              className="season-csv-link"
              onClick={() => eng.downloadAllHistoryCsv()}
            >
              ↓ Export all history
            </button>
          </span>
        ) : null}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {S.history.length} game{S.history.length === 1 ? "" : "s"} ·{" "}
        {S.settings.countGoalieTime
          ? "goalie time counts toward totals"
          : "totals exclude goalie time (shown in the breakdown)"}
      </p>
      {totals.map((t) => {
        const posLine = POSITIONS.filter(
          (k) => Math.round((t.pos[k] || 0) / 60) > 0,
        )
          .map((k) => k + " " + Math.round((t.pos[k] || 0) / 60) + "m")
          .join(" · ");
        const avg = t.games ? ((t.seconds / 60) / t.games).toFixed(1) : "0.0";
        return (
          <div className="card season-card" key={t.name}>
            <div className="row spread">
              <div>
                <span className="season-name">{t.name}</span>
              </div>
              <div style={{ textAlign: "right" }}>
                <div>
                  <span className="season-avg">{avg}</span>{" "}
                  <span className="muted">avg/game</span>
                </div>
                <div className="season-total">
                  {Math.round(t.seconds / 60)}{" "}
                  <span className="muted" style={{ fontSize: 15 }}>
                    min
                  </span>
                </div>
              </div>
            </div>
            <div>
              <strong>{t.games}</strong>{" "}
              <span className="muted">game{t.games === 1 ? "" : "s"}</span> ·{" "}
              <strong>{t.goals}</strong>{" "}
              <span className="muted">goal{t.goals === 1 ? "" : "s"}</span>
            </div>
            {posLine ? <div className="muted season-pos">{posLine}</div> : null}
          </div>
        );
      })}
    </>
  );
}

export function HistoryView({ eng }: { eng: Engine }) {
  const S = eng.S;
  const SB = eng.SB;
  let status: ReactNode = null;
  if (SB.configured) {
    if (SB.historyError) status = <Muted>{SB.historyError}</Muted>;
    else if (!SB.historyLoaded) status = <Muted>Loading history…</Muted>;
  } else {
    status = <Muted>Backend not configured</Muted>;
  }
  if (!S.history.length)
    return (
      <>
        {status}
        <Muted>No finished games yet.</Muted>
      </>
    );
  const anonViewer = eng.isViewer();
  return (
    <>
      {status}
      <H2>Past games</H2>
      {S.history.map((h, hi) => {
        const open = !!S.expandedHistory[hi];
        const played = h.playedSeconds ? fmtClock(h.playedSeconds) + " played" : "";
        const head = (
          <div className="row spread">
            <div>
              <strong>{h.date}</strong>
              <div className="muted">
                {played ? played + " · " : ""}US {h.ourScore} – {h.theirScore} THEM
              </div>
            </div>
            <PBtn
              label={open ? "Hide" : "Details"}
              small
              onClick={() => {
                S.expandedHistory[hi] = !S.expandedHistory[hi];
                eng.emit();
              }}
            />
          </div>
        );
        if (!open)
          return (
            <Card key={hi}>
              {head}
            </Card>
          );
        const goalLines =
          displayGoals(h.goals)
            .map((g) => goalLabel(g, h.players))
            .join(", ") || "No goals recorded";
        return (
          <Card key={hi}>
            {head}
            {!anonViewer ? (
              <div className="row" style={{ margin: "8px 0" }}>
                <PBtn
                  label="Export this game CSV"
                  small
                  onClick={() => eng.downloadGameCsv(hi)}
                />
                <PBtn
                  label="Edit goals"
                  small
                  onClick={() => {
                    eng.modal = { kind: "editGoalsPast", hi };
                    eng.emit();
                  }}
                />
              </div>
            ) : null}
            <H3>Goals</H3>
            <p>{goalLines}</p>
            {h.players.map((p, pi) => {
              const posLine = POSITIONS.filter((k) => (p.posSeconds || {})[k] > 0)
                .map((k) => k + " " + Math.round(((p.posSeconds || {})[k] || 0) / 60) + "m")
                .join(" · ");
              return (
                <div className="mrow" key={pi}>
                  <div style={{ minWidth: 0 }}>
                    <span className="name">{p.name}</span>
                    {p.goals ? " ⚽ " + p.goals : ""}
                    {posLine ? <div className="note-line">{posLine}</div> : null}
                  </div>
                  <div className="nums">{Math.round((p.seconds || 0) / 60)} min</div>
                </div>
              );
            })}
          </Card>
        );
      })}
      <SeasonTotals eng={eng} />
    </>
  );
}

/* ---------- Shell bits ---------- */

export function LoadingScreen() {
  return (
    <section
      aria-label="Loading game"
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
      }}
    >
      <PrismSpinner size="regular" />
      <p className="muted" style={{ fontSize: 17 }}>
        Loading game…
      </p>
    </section>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <PrismLayoutMain className="mx-auto w-full max-w-[480px]">
      <main id="main" aria-live="polite" className="px-[10px] pb-8 pt-2">
        {children}
      </main>
    </PrismLayoutMain>
  );
}

export function Divider() {
  return <PrismDivider spacing="compact" tone="muted" />;
}
