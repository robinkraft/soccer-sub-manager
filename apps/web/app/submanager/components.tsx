// Presentational components for the Sub Manager port.
// Field/bench/queue/scoreboard styling follows the original's exact visual
// rules (spec §16); Prism components carry the shell (buttons, cards,
// typography, divider, spinner, layout) where they fit.

import type { ReactNode } from "react";
import {
  PrismButton,
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

/* ---------- Prism button ---------- */

type BtnKind = "primary" | "default" | "ghost" | "danger" | "apply";

// PBtn renders a real PrismButton from the app presets registered in
// config/button-presets.ts (pill, backgroundDark paints, no hover grow /
// no icon motion). Sizes are sideline-tuned (see button-presets.ts):
// regular buttons get a 16px font override (Prism regular is 14px, below
// the sideline floor; large's 21px is too big for dense rows), Apply uses
// preset size `large` as designed (~57px tall, spec 56px).
// labelMaxWidth="none": PrismButton caps labels at 12rem by default,
// which would truncate labels like "Return to full strength (7v7)".
const BTN_PRESET: Record<BtnKind, string> = {
  primary: "sm-primary",
  default: "sm-default",
  ghost: "sm-ghost",
  danger: "sm-danger",
  apply: "sm-apply",
};

// ONE BUTTON COLOUR — BLUE (Robin's pick, 2026-11-11). Every button in
// the app is blue: solid blue for primary/apply/danger actions, blue
// outline + light-blue text for secondary (default/ghost) actions.
// Disabled buttons keep their blue fill faded by PrismButton's own
// opacity (0.33) — never grey. The deep-orange Apply accent and the red
// danger accent are retired from buttons; queue/swap badges keep their
// existing amber/green/blue fills (those are state badges, not buttons).
const BTN_COLOR: Record<BtnKind, "blue"> = {
  primary: "blue",
  default: "blue",
  ghost: "blue",
  danger: "blue",
  apply: "blue",
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
  const isApply = kind === "apply";
  const minH = isApply
    ? "min-h-[56px]"
    : small
      ? "min-h-[36px]"
      : "min-h-[44px]";
  return (
    <PrismButton
      label={label}
      preset={BTN_PRESET[kind]}
      color={{ palette: "default", swatchPrimary: BTN_COLOR[kind] }}
      variant={Icon ? "icon" : "plain"}
      icon={Icon}
      size={isApply ? "large" : "regular"}
      spacing={isApply ? "regular" : small ? "compact" : "comfortable"}
      disabled={disabled}
      onClick={onClick}
      type={type}
      labelMaxWidth="none"
      className={(isApply ? "w-full " : "") + minH + (grow ? " flex-1" : "")}
      style={isApply ? undefined : { fontSize: small ? 14 : 16 }}
    />
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
        (danger ? "text-destructive" : "text-muted-foreground")
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
      size="small"
      as="h2"
      className="mb-1 mt-2"
    >
      {children}
    </PrismTypography>
  );
}

export function H3({ children }: { children: ReactNode }) {
  return (
    <PrismTypography
      role="title"
      size="large"
      as="h3"
      className="mb-1 mt-2"
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
        "my-1 text-muted-foreground" + (center ? " text-center" : "")
      }
    >
      {children}
    </PrismTypography>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <PrismCard className="my-1.5 gap-1.5 px-3 py-3">
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
    <div className="tabs mt-1 flex gap-[6px] rounded-[14px] p-1" role="tablist">
      {tabs.map(([k, label]) => (
        <button
          key={k}
          type="button"
          role="tab"
          aria-selected={current === k}
          onClick={() => onSelect(k)}
          className="min-h-[44px] flex-1 rounded-full border-2 px-2 text-[16px] font-bold"
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
        <h2 className="season-h2" style={{ marginBottom: 2 }}>Season totals</h2>
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
      <PrismSpinner
        size="regular"
        color={{ palette: "default", swatchPrimary: "blue", shade: 500 }}
      />
      <p className="muted" style={{ fontSize: 17 }}>
        Loading game…
      </p>
    </section>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <PrismLayoutMain className="mx-auto w-full max-w-[480px]">
      <main id="main" aria-live="polite" className="px-[10px] pb-6 pt-1">
        {children}
      </main>
    </PrismLayoutMain>
  );
}

export function Divider() {
  return <PrismDivider spacing="compact" tone="muted" />;
}
