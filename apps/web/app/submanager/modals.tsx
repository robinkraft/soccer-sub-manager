// Bottom-sheet modals for the Sub Manager port (spec §7.9).
// All modals are bottom sheets; overlay click closes; native dialogs never used.

import { useState } from "react";
import type { Engine } from "./engine";
import { POSITIONS } from "./types";
import { editGoalLabel, goalLabel, isSampleRoster } from "./logic";
import { H2, Muted, PBtn } from "./components";

/** Shown in place of a player grid when a signed-in coach's roster is
    the fictional sample roster: the backend roster never loaded, and
    showing Mia/Liam/Sofia as if they were the team would let the coach
    record goals against fake players. Loud error + retry, never silent. */
function RosterLoadError({ eng }: { eng: Engine }) {
  return (
    <div>
      <p>
        <strong>Roster could not be loaded.</strong>
      </p>
      <Muted>
        You&apos;re signed in, but the real roster isn&apos;t available — the
        sample team is showing instead. Check your connection and try again.
      </Muted>
      <div className="row" style={{ marginTop: 8 }}>
        <PBtn
          label="Retry loading roster"
          kind="primary"
          onClick={() => void eng.reloadRoster()}
        />
      </div>
    </div>
  );
}

function Sheet({
  eng,
  title,
  children,
}: {
  eng: Engine;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) eng.closeModal();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true">
        {title ? <H2>{title}</H2> : null}
        {children}
      </div>
    </div>
  );
}

function inputValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
  return el ? el.value : "";
}

export function ModalSheet({ eng }: { eng: Engine }) {
  const modal = eng.modal;
  if (!modal) return null;
  const S = eng.S;

  if (modal.kind === "confirm") {
    return (
      <Sheet eng={eng} title={modal.title}>
        <p>{modal.body}</p>
        <div className="pin-bottom">
          <PBtn
            label={modal.confirmLabel}
            kind={modal.danger ? "danger" : "primary"}
            onClick={() => eng.confirmModal()}
          />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "picker") {
    const pos = modal.pos;
    const assigned = new Map<number, string>();
    S.lineup.forEach((p, i) => {
      if (p != null) assigned.set(p, POSITIONS[i]);
    });
    const present = S.roster.map((_, i) => i).filter((i) => S.roster[i].present);
    const prefFirst = present.filter((i) =>
      S.roster[i].prefs.includes(POSITIONS[pos]),
    );
    const others = present.filter(
      (i) => !S.roster[i].prefs.includes(POSITIONS[pos]),
    );
    const ordered = [...prefFirst, ...others];
    return (
      <Sheet eng={eng} title={POSITIONS[pos] + " — choose a player"}>
        <Muted>
          Preferences guide, never block. Anyone present can play any spot.
        </Muted>
        <div className="picker-grid">
          {ordered.map((i) => {
            const a = assigned.get(i);
            return (
              <button
                key={i}
                type="button"
                onClick={() => eng.pickPlayer(i, pos)}
              >
                {S.roster[i].name}
                {a ? <span className="sub">assigned: {a}</span> : null}
                {!S.roster[i].prefs.includes(POSITIONS[pos]) ? (
                  <span className="sub">outside preferred positions — allowed</span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div className="pin-bottom">
          <PBtn label="Leave spot empty" onClick={() => eng.clearSpot(pos)} />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "scorer") {
    const side = modal.side;
    const idx = S.roster
      .map((_, i) => i)
      .filter((i) => S.roster[i].present)
      .sort((a, b) => S.roster[a].name.localeCompare(S.roster[b].name));
    const half = Math.ceil(idx.length / 2);
    const colMajor = [...idx.slice(0, half), ...idx.slice(half)];
    const rosterBroken = !!eng.SB.authUser && isSampleRoster(S.roster);
    return (
      <Sheet eng={eng} title="Who scored?">
        <Stepper eng={eng} />
        <Muted center>Goal minute — adjust before confirming.</Muted>
        {rosterBroken ? (
          <RosterLoadError eng={eng} />
        ) : (
          <div className="picker-grid">
            {colMajor.map((i) => {
              const p = S.lineup.indexOf(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => eng.recordGoal(side, i)}
                >
                  {S.roster[i].name} · {p >= 0 ? POSITIONS[p] : "Bench"}
                </button>
              );
            })}
          </div>
        )}
        <div className="pin-bottom">
          <PBtn label="Own goal" onClick={() => eng.recordGoal(side, -1)} />
          <PBtn label="Skip · no scorer" onClick={() => eng.recordGoal(side, "skip")} />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "note") {
    const i = modal.player;
    return (
      <Sheet eng={eng} title={"Note — " + S.roster[i].name}>
        <Muted>Private reminder. Notes are never shared.</Muted>
        <textarea id="note-text" defaultValue={S.roster[i].note || ""} />
        <div className="row" style={{ marginTop: 8 }}>
          <PBtn
            label="Save note"
            kind="primary"
            grow
            onClick={() => eng.saveNote(i, inputValue("note-text"))}
          />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "more") {
    const i = modal.player;
    const r = S.roster[i];
    const setupOnly = S.screen === "setup" && !S.editingLive;
    return (
      <Sheet eng={eng} title={r.name}>
        <div className="pin-bottom">
          <PBtn
            label={r.note ? "Edit note" : "Add note"}
            onClick={() => {
              eng.modal = { kind: "note", player: i };
              eng.emit();
            }}
          />
          <PBtn
            label={r.tired ? "Untire" : "Mark tired"}
            onClick={() => eng.toggleTired(i)}
          />
          {setupOnly ? (
            <PBtn
              label="Position preferences"
              onClick={() => {
                eng.modal = { kind: "prefs", player: i };
                eng.emit();
              }}
            />
          ) : null}
          <PBtn
            label="Remove player"
            kind="danger"
            onClick={() =>
              eng.openConfirm(
                "Remove " + S.roster[i].name + "?",
                "Their minutes and any lineup spot are cleared.",
                "Remove player",
                true,
                () => eng.removePlayer(i),
              )
            }
          />
          <PBtn label="Close" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "managePreferred") {
    const ready = !!S.preferredLineup;
    return (
      <Sheet eng={eng} title="Preferred lineup">
        <Muted>
          {ready
            ? "A preferred starting lineup is saved with the roster."
            : "No preferred lineup saved yet — set a lineup on the field, then save it here."}
        </Muted>
        <div className="pin-bottom">
          {ready ? (
            <PBtn
              label="Use preferred lineup"
              onClick={() => eng.applyPreferredLineup()}
            />
          ) : null}
          <PBtn
            label="Save current lineup as preferred"
            onClick={() => eng.savePreferredLineup()}
          />
          {ready ? (
            <PBtn
              label="Clear preferred lineup"
              kind="danger"
              onClick={() => eng.clearPreferredLineup()}
            />
          ) : null}
          <PBtn label="Close" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "halftimePrefs") {
    const rows = S.roster
      .map((_, i) => i)
      .filter((i) => S.roster[i].present)
      .sort((a, b) => S.roster[a].name.localeCompare(S.roster[b].name));
    return (
      <Sheet eng={eng} title="Position preferences">
        <Muted>Preferred positions per player. Preferences guide, never block.</Muted>
        {rows.map((i) => (
          <div className="mrow" key={i}>
            <span className="name">{S.roster[i].name}</span>
            <span className="nums muted">{S.roster[i].prefs.join(" · ")}</span>
          </div>
        ))}
        <div className="pin-bottom">
          <PBtn label="Close" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "prefs") {
    const i = modal.player;
    const r = S.roster[i];
    return (
      <Sheet eng={eng} title={"Positions — " + r.name}>
        <Muted>Tap to toggle preferred positions.</Muted>
        <div className="chips">
          {POSITIONS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={r.prefs.includes(p)}
              onClick={() => eng.togglePrefEditor(i, p)}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <PBtn label="Done" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "rename") {
    const i = modal.player;
    return (
      <Sheet eng={eng} title="Rename player">
        <Muted>Rename this player.</Muted>
        <p>
          <label>
            Name{" "}
            <input
              type="text"
              id="rename-text"
              defaultValue={S.roster[i].name}
              maxLength={30}
            />
          </label>
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          <PBtn
            label="Save name"
            kind="primary"
            grow
            onClick={() => eng.saveRename(i, inputValue("rename-text"))}
          />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "addPlayer") {
    return (
      <Sheet eng={eng} title="Add player">
        <Muted>
          New players start with field positions preferred (no goalkeeper) —
          change them with Positions afterwards.
        </Muted>
        <p>
          <label>
            Name{" "}
            <input
              type="text"
              id="add-player-text"
              placeholder="Player name"
              maxLength={30}
            />
          </label>
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          <PBtn
            label="Save player"
            kind="primary"
            grow
            onClick={() => eng.saveAddPlayer(inputValue("add-player-text"))}
          />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "short") {
    return (
      <Sheet eng={eng} title="Play short (6v7)">
        <Muted>
          Choose one field slot to remove. Minutes are preserved; the player
          comes off to the bench.
        </Muted>
        <div className="picker-grid">
          {POSITIONS.map((p, i) =>
            S.removedPositions.includes(i) ? null : (
              <button key={p} type="button" onClick={() => eng.removePosition(i)}>
                Remove {p}
              </button>
            ),
          )}
        </div>
        <div className="pin-bottom">
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "editGoalsLive") {
    const rows = S.goals.map((g, gi) => {
      const isThem = (g.side || "us") === "them";
      return (
        <div className="mrow" key={gi}>
          <span className="name">
            {isThem
              ? editGoalLabel(g, S.roster)
              : goalLabel(g, S.roster) + " (US)"}
          </span>
          <span className="nums">
            {g.player == null && !isThem ? (
              <button
                type="button"
                className="small"
                onClick={() => {
                  eng.modal = { kind: "assignLive", gi };
                  eng.emit();
                }}
              >
                Assign…
              </button>
            ) : null}{" "}
            <button
              type="button"
              className="small"
              onClick={() => eng.goalMinuteAdjust(gi, -1)}
            >
              −1′
            </button>{" "}
            <button
              type="button"
              className="small"
              onClick={() => eng.goalMinuteAdjust(gi, 1)}
            >
              +1′
            </button>{" "}
            <button
              type="button"
              className="small danger"
              onClick={() => eng.goalRemoveLive(gi)}
            >
              Remove
            </button>
          </span>
        </div>
      );
    });
    const addOppBtn = (
      <div className="row" style={{ marginBottom: 4 }}>
        <PBtn
          label="Add goal"
          onClick={() => {
            eng.scorerMinute = Math.floor(S.elapsed / 60);
            eng.modal = { kind: "addGoalLive" };
            eng.emit();
          }}
        />
        <PBtn
          label="Add opponent goal"
          onClick={() => {
            eng.scorerMinute = Math.floor(S.elapsed / 60);
            eng.modal = { kind: "addOpponentGoalLive" };
            eng.emit();
          }}
        />
      </div>
    );
    if (!S.goals.length) {
      return (
        <Sheet eng={eng} title="Edit goals">
          <p>No goals recorded yet in this game.</p>
          {addOppBtn}
          <div className="pin-bottom">
            <PBtn label="Close" kind="ghost" onClick={() => eng.closeModal()} />
          </div>
        </Sheet>
      );
    }
    return (
      <Sheet eng={eng} title="Edit goals — live game">
        {addOppBtn}
        {rows}
        <div className="pin-bottom">
          <PBtn label="Done" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "editGoalsPast") {
    const h = S.history[modal.hi];
    if (!h) return null;
    const hi = modal.hi;
    return (
      <Sheet eng={eng} title="Edit goals — past game">
        <Muted>Backfill a scorer with an optional minute, or remove one.</Muted>
        <div className="row">
          <PBtn
            label="Add goal…"
            onClick={() => {
              eng.modal = { kind: "backfill", hi };
              eng.emit();
            }}
          />
          <PBtn
            label="Add opponent goal"
            onClick={() => {
              const mm = h.matchMinutes || 50;
              eng.scorerMinute = Math.min(
                mm,
                Math.floor((h.playedSeconds || 0) / 60),
              );
              eng.modal = { kind: "addOpponentGoalPast", hi };
              eng.emit();
            }}
          />
        </div>
        {h.goals.map((g, gi) => {
          const isThem = (g.side || "us") === "them";
          return (
            <div className="mrow" key={gi}>
              <span className="name">
                {isThem ? editGoalLabel(g, h.players) : goalLabel(g, h.players)}
              </span>
              {g.player == null && !isThem ? (
                <button
                  type="button"
                  className="small"
                  onClick={() => {
                    eng.modal = { kind: "assignHist", hi, gi };
                    eng.emit();
                  }}
                >
                  Assign…
                </button>
              ) : null}
              {isThem ? (
                <>
                  <button
                    type="button"
                    className="small"
                    onClick={() => eng.goalMinuteAdjustPast(hi, gi, -1)}
                  >
                    −1′
                  </button>{" "}
                  <button
                    type="button"
                    className="small"
                    onClick={() => eng.goalMinuteAdjustPast(hi, gi, 1)}
                  >
                    +1′
                  </button>{" "}
                </>
              ) : null}
              <button
                type="button"
                className="small danger"
                onClick={() => eng.removeGoalPast(hi, gi)}
              >
                Remove
              </button>
            </div>
          );
        })}
        {!h.goals.length ? <Muted>No goals yet.</Muted> : null}
        <div className="pin-bottom">
          <PBtn label="Done" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "addGoalLive") {
    const idx = S.roster
      .map((_, i) => i)
      .filter((i) => S.roster[i].present)
      .sort((a, b) => S.roster[a].name.localeCompare(S.roster[b].name));
    const half = Math.ceil(idx.length / 2);
    const colMajor = [...idx.slice(0, half), ...idx.slice(half)];
    const rosterBroken = !!eng.SB.authUser && isSampleRoster(S.roster);
    return (
      <Sheet eng={eng} title="Add goal">
        <Stepper eng={eng} />
        <Muted center>Goal minute — adjust before confirming.</Muted>
        {rosterBroken ? (
          <RosterLoadError eng={eng} />
        ) : (
          <div className="picker-grid">
            {colMajor.map((i) => {
              const p = S.lineup.indexOf(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => eng.addGoalLive(i)}
                >
                  {S.roster[i].name} · {p >= 0 ? POSITIONS[p] : "Bench"}
                </button>
              );
            })}
          </div>
        )}
        <div className="pin-bottom">
          <PBtn label="Own goal" onClick={() => eng.addGoalLive(-1)} />
          <PBtn label="Skip · no scorer" onClick={() => eng.addGoalLive("skip")} />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "addOpponentGoalLive") {
    return (
      <Sheet eng={eng} title="Add opponent goal">
        <Stepper eng={eng} />
        <Muted center>Opponent goal minute — adjust before confirming.</Muted>
        <div className="pin-bottom">
          <PBtn
            label="Add opponent goal"
            onClick={() => eng.addOpponentGoalLive()}
          />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "addOpponentGoalPast") {
    const hi = modal.hi;
    return (
      <Sheet eng={eng} title="Add opponent goal">
        <Stepper eng={eng} />
        <Muted center>Opponent goal minute — adjust before confirming.</Muted>
        <div className="pin-bottom">
          <PBtn
            label="Add opponent goal"
            onClick={() => eng.addOpponentGoalPast(hi)}
          />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "assignLive") {
    const gi = modal.gi;
    const rosterBroken = !!eng.SB.authUser && isSampleRoster(S.roster);
    return (
      <Sheet eng={eng} title="Assign scorer">
        {rosterBroken ? (
          <RosterLoadError eng={eng} />
        ) : (
          <div className="picker-grid">
            {S.roster.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  const g = S.goals[gi];
                  if (g) {
                    g.player = i;
                    g.player_name = S.roster[i].name;
                    // A corrected goal is no longer a fresh live moment.
                    g.liveMoment = false;
                  }
                  eng.modal = { kind: "editGoalsLive" };
                  eng.emit(true);
                }}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
        <div className="pin-bottom">
          <PBtn
            label="Own goal"
            onClick={() => {
              const g = S.goals[gi];
              if (g) {
                g.player = -1;
                g.player_name = "Own goal";
                // A corrected goal is no longer a fresh live moment.
                g.liveMoment = false;
              }
              eng.modal = { kind: "editGoalsLive" };
              eng.emit(true);
            }}
          />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "assignHist") {
    const { hi, gi } = modal;
    const h = S.history[hi];
    if (!h) return null;
    const rosterBroken = !!eng.SB.authUser && isSampleRoster(S.roster);
    return (
      <Sheet eng={eng} title="Assign scorer">
        {rosterBroken ? (
          <RosterLoadError eng={eng} />
        ) : (
          <div className="picker-grid">
            {S.roster.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => {
                  const g = h.goals[gi];
                  if (g) {
                    const idx = (h.players || []).findIndex(
                      (p) => p.name === S.roster[i].name,
                    );
                    g.player = idx === -1 ? null : idx;
                    g.player_name = S.roster[i].name;
                  }
                  void eng.syncHistoryGame(h);
                  eng.closeModal();
                }}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
        <div className="pin-bottom">
          <PBtn
            label="Own goal"
            onClick={() => {
              const g = h.goals[gi];
              if (g) {
                g.player = -1;
                g.player_name = "Own goal";
              }
              void eng.syncHistoryGame(h);
              eng.closeModal();
            }}
          />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  if (modal.kind === "backfill") {
    const hi = modal.hi;
    const h = S.history[hi];
    if (!h) return null;
    const rosterBroken = !!eng.SB.authUser && isSampleRoster(S.roster);
    return (
      <Sheet eng={eng} title="Add goal — backfill">
        <Muted>Minute is optional; leave it blank for “name only”.</Muted>
        {rosterBroken ? (
          <RosterLoadError eng={eng} />
        ) : (
          <div className="picker-grid">
            {S.roster.map((r, i) => (
              <button
                key={i}
                type="button"
                onClick={() => eng.addGoalPast(hi, i)}
              >
                {r.name}
              </button>
            ))}
          </div>
        )}
        <div className="pin-bottom">
          <PBtn
            label="Own goal"
            onClick={() => eng.addGoalPast(hi, -1)}
          />
          <PBtn label="Cancel" kind="ghost" onClick={() => eng.closeModal()} />
        </div>
      </Sheet>
    );
  }

  return null;
}

function Stepper({ eng }: { eng: Engine }) {
  const [, setTick] = useState(0);
  const step = (d: number) => {
    // Upper bound is a generous 120, NOT matchMinutes: the opener sets the
    // minute to the current/final minute, which is already AT matchMinutes
    // for a full-length past game (or a game into overtime) — clamping to
    // matchMinutes made + a no-op exactly then, so the stepper looked
    // dead. A youth game never runs 2 hours; the cap only stops runaway taps.
    eng.scorerMinute = Math.max(0, Math.min(120, eng.scorerMinute + d));
    setTick((t) => t + 1);
  };
  return (
    <div className="stepper">
      <button type="button" onClick={() => step(-1)} aria-label="One minute earlier">
        −
      </button>
      <span className="min-val">{eng.scorerMinute}′</span>
      <button type="button" onClick={() => step(1)} aria-label="One minute later">
        +
      </button>
    </div>
  );
}
