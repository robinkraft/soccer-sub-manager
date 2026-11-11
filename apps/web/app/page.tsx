"use client";

// Soccer Substitution Manager — Prism port.
// Single client component: all screens render from the Engine's in-memory
// state (spec ~/workspace/soccer-sub-manager-prism-spec.md). No router,
// no server data: query params are read client-side after mount.

import { useEffect, useRef, useState } from "react";
import { Download, LogIn, Play, Share2 } from "lucide-react";
import "./submanager/app.css";
// Registers the app's PrismButton presets (sm-primary etc.) in the CLIENT
// bundle. It must be imported here, not from layout.tsx: layout is a
// server component, so its side-effect import registered the presets only
// during prerender and never reached the browser — buttons silently fell
// back to Prism's default paint="background".
import "../config/button-presets";
import { Engine } from "./submanager/engine";
import {
  AppShell,
  Bench,
  Card,
  Divider,
  Field,
  H2,
  H3,
  HistoryView,
  LinkBtn,
  LoadingScreen,
  Muted,
  PBtn,
  RosterRows,
  Scoreboard,
  Tabs,
} from "./submanager/components";
import { ModalSheet } from "./submanager/modals";
import {
  autoLineup,
  benchPlayers,
  displayGoals,
  emptySpotsLabel,
  fairShareSec,
  fieldCount,
  flagFor,
  fmtClock,
  fmtMin,
  goalLabel,
  goalsFor,
  liveGkSec,
  projectedSec,
  totalSec,
} from "./submanager/logic";
import { POSITIONS } from "./submanager/types";

function inputValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  return el ? el.value : "";
}

export default function Home() {
  const engRef = useRef<Engine | null>(null);
  if (!engRef.current) {
    engRef.current = new Engine(() => setVersion((v) => v + 1));
  }
  const eng = engRef.current;
  const [, setVersion] = useState(0);
  const [, setNow] = useState(() => Date.now());

  // Mount: boot the engine, wire popstate + online/offline + visibility.
  useEffect(() => {
    const e = engRef.current!;
    void e.init();
    const onPop = () => {
      void e.routeFromUrl();
    };
    const onOffline = () => e.onOffline();
    const onOnline = () => {
      void e.onOnline();
    };
    const onVisible = () => {
      if (!document.hidden) {
        setNow(Date.now());
        e.emit();
      }
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = setInterval(() => {
      if (engRef.current && engRef.current.S.running) setNow(Date.now());
    }, 1000);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // After every render: wake lock + debounced live sync.
  useEffect(() => {
    eng.afterRender();
  });

  eng.syncClock();
  const S = eng.S;
  const SB = eng.SB;

  if (!eng.booted) {
    return (
      <AppShell>
        <LoadingScreen />
      </AppShell>
    );
  }

  const err = eng.takeError();
  const errorLine = err ? (
    <div className="error" role="alert">
      {err}
    </div>
  ) : null;
  const backendLine = SB.backendError ? (
    <div className="error" role="alert">
      {SB.backendError}
    </div>
  ) : null;
  const offlineLine = SB.offline ? (
    <div className="error" role="alert">
      Offline — changes will sync when signal returns.
    </div>
  ) : null;
  const banner =
    SB.viewerMode && !SB.authUser ? (
      <div className="banner banner-viewer">
        <span>View-only — shared view.</span>
        <button type="button" className="banner-link" onClick={() => shareViewer(eng)}>
          Share this view
        </button>
        <button
          type="button"
          className="banner-link"
          onClick={() => {
            S.showSignin = true;
            eng.emit();
          }}
        >
          Sign in as a coach
        </button>
      </div>
    ) : null;

  let body: React.ReactNode;
  // Loading a game deep link: the neutral screen above, before the login
  // gate — a parent opening a shared link must never see the setup screen
  // or the sign-in form flash by while the game loads.
  if (S.screen === "loading") {
    body = <LoadingScreen />;
  } else if (eng.authGated()) {
    if (SB.viewerMode && !S.showSignin) {
      body = <ViewerScreens eng={eng} />;
    } else {
      body = S.showSignin ? (
        <LoginForm eng={eng} />
      ) : (
        <EntryScreen eng={eng} />
      );
    }
  } else if (S.screen === "viewer") {
    body = <ViewerScreens eng={eng} />;
  } else if (S.screen === "setup") {
    body = <SetupScreen eng={eng} />;
  } else if (S.screen === "review") {
    body = <ReviewScreen eng={eng} />;
  } else if (S.screen === "live") {
    body =
      SB.viewerMode && !SB.authUser ? (
        <ViewerGameView eng={eng} />
      ) : (
        <LiveScreen eng={eng} />
      );
  } else if (S.screen === "halftime") {
    body =
      SB.viewerMode && !SB.authUser ? (
        <ViewerGameView eng={eng} />
      ) : (
        <HalftimeScreen eng={eng} />
      );
  } else if (S.screen === "finished") {
    body = <FinishedScreen eng={eng} />;
  } else {
    body = <SetupScreen eng={eng} />;
  }

  return (
    <AppShell>
      {errorLine}
      {backendLine}
      {offlineLine}
      {banner}
      {body}
      <ModalSheet eng={eng} />
      {eng.toast ? (
        <div className="live-toast show" aria-live="polite">
          {eng.toast}
        </div>
      ) : null}
    </AppShell>
  );
}

async function shareViewer(eng: Engine): Promise<void> {
  let url = "";
  try {
    url = window.location.href;
  } catch {
    /* ignore */
  }
  if (url) {
    await eng.copyText(url);
    eng.showToast("Link copied");
  } else if (eng.SB.viewerJoinedCode) {
    await eng.copyText(eng.viewerLinkUrl(eng.SB.viewerJoinedCode));
    eng.showToast("Link copied");
  }
}

function leaveViewer(eng: Engine): void {
  const home = eng.homeUrl();
  eng.leaveLiveGame();
  eng.pushUrl(home);
}

/* ---------- Entry / sign-in ---------- */

function LoginForm({ eng }: { eng: Engine }) {
  const SB = eng.SB;
  const signIn = async () => {
    const email = inputValue("auth-email").trim();
    const password = inputValue("auth-password");
    if (!email || !password) {
      SB.authError = "Enter your email and password.";
      eng.emit();
      return;
    }
    const ok = await eng.signInWithPassword(email, password);
    if (ok) await eng.enterApp();
  };
  return (
    <section aria-label="Sign in">
      <H2>Sign in to Sub Manager</H2>
      <Muted>
        Coaches only — sign in to see history, the roster, and drive a game.
        Watching a live game needs no sign-in: enter its code above.
      </Muted>
      {SB.authError ? (
        <div className="error" role="alert">
          {SB.authError}
        </div>
      ) : null}
      <Card>
        <label htmlFor="auth-email">Email</label>
        <input
          type="email"
          id="auth-email"
          autoComplete="email"
          placeholder="you@example.com"
          defaultValue={SB.authLastEmail}
        />
        <p>
          <label htmlFor="auth-password">Password</label>
          <input
            type="password"
            id="auth-password"
            autoComplete="current-password"
            placeholder="Password"
          />
        </p>
        <div className="row">
          <PBtn label="Sign in" kind="primary" grow icon={LogIn} onClick={() => void signIn()} />
        </div>
      </Card>
      <p className="muted small">You stay signed in on this device until you sign out.</p>
    </section>
  );
}

function EntryScreen({ eng }: { eng: Engine }) {
  const joinViewer = async () => {
    const code = inputValue("join-code").trim().toUpperCase();
    if (!code) {
      eng.S.error = "Enter the 4-letter view code first.";
      eng.emit();
      return;
    }
    await eng.joinViewerCode(code);
    eng.emit();
  };
  return (
    <section aria-label="Watch or sign in">
      <H2>Watch a live game</H2>
      <Card>
        <H3>Join a shared view</H3>
        <Muted>
          Enter the 4-letter view code from the coach’s shared link. No account
          needed — you watch live and see history, view-only.
        </Muted>
        <div className="row">
          <input
            type="text"
            id="join-code"
            placeholder="View code"
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            style={{ width: 110, textTransform: "uppercase" }}
          />
          <PBtn label="Watch" kind="primary" icon={Play} onClick={() => void joinViewer()} />
        </div>
      </Card>
      <LoginForm eng={eng} />
    </section>
  );
}

/* ---------- Setup ---------- */

function SetupScreen({ eng }: { eng: Engine }) {
  const S = eng.S;
  const SB = eng.SB;
  if (SB.authUser && !SB.activeGamesLoaded && !SB.activeGamesLoading) {
    void eng.loadActiveGames();
  }
  const activeNote =
    !S.editingLive && SB.authUser
      ? (SB.activeGames || [])
          .filter((g) => g && g.id !== SB.liveId)
          .map((g) => {
            const st = (g.state as Record<string, unknown>) || {};
            const score =
              "US " +
              ((st.ourScore as number) || 0) +
              " – " +
              ((st.theirScore as number) || 0) +
              " THEM";
            return (
              <Card key={g.id as string}>
                <strong>There’s a live game in progress</strong>
                <div className="muted">
                  {score} · {fmtClock(eng.activeGameElapsed(st))}
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <PBtn
                    label="Join"
                    kind="primary"
                    grow
                    onClick={() => void eng.joinActiveGame(g)}
                  />
                  <PBtn
                    label="Shut down"
                    kind="danger"
                    small
                    onClick={() => eng.goShutdownGame(g.id as string)}
                  />
                </div>
              </Card>
            );
          })
      : null;

  if (S.editingLive) {
    return (
      <section aria-label="Edit lineup">
        <div className="field-wrap">
          <Field
            eng={eng}
            lineup={S.lineup}
            names={S.roster.map((r) => r.name)}
            removedPositions={S.removedPositions}
          />
        </div>
        <Muted center>Tap a spot to choose a player</Muted>
        <div className="row">
          <PBtn label="Auto-generate lineup" onClick={() => eng.autoRefreshLineup()} />
          <PBtn label="Refresh lineup" onClick={() => eng.autoRefreshLineup()} />
          <PBtn label="Return to live game" kind="primary" grow onClick={() => eng.backToLive()} />
        </div>
        <details>
          <summary>
            Attendance ({S.roster.filter((r) => r.present).length} present)
          </summary>
          <div className="attend">
            {S.roster.map((r, i) => (
              <button
                key={i}
                type="button"
                className={r.present ? "" : "absent"}
                onClick={() => eng.toggleAttend(i)}
              >
                {r.name}
                {r.present ? "" : " — absent"}
              </button>
            ))}
          </div>
          <Muted>
            Marking a bench player absent leaves the starting seven untouched.
            Marking a starter absent clears only their spot.
          </Muted>
        </details>
        <details>
          <summary>Team &amp; positions</summary>
          {(eng.rosterSourceLabel() || SB.rosterError) && (
            <Muted>
              {eng.rosterSourceLabel()}
              {SB.rosterError ? " " + SB.rosterError : ""}
            </Muted>
          )}
          <RosterRows eng={eng} />
          <div className="row">
            <PBtn
              label="Add player"
              onClick={() => {
                eng.modal = { kind: "addPlayer" };
                eng.emit();
              }}
            />
            {SB.configured && SB.authUser ? (
              <PBtn
                label="Save roster"
                onClick={async () => {
                  const ok = await eng.saveRosterToBackend();
                  if (!ok) eng.S.error = "Could not save the roster — try again.";
                  eng.emit();
                }}
              />
            ) : null}
          </div>
        </details>
      </section>
    );
  }

  const tabs: [string, string][] = [
    ["lineup", "Lineup"],
    ["roster", "Roster"],
    ["settings", "Settings"],
    ["history", "History"],
  ];
  let body: React.ReactNode = null;
  if (S.setupTab === "lineup") {
    const bench = S.roster
      .map((_, i) => i)
      .filter((i) => !S.lineup.includes(i) && S.roster[i].present);
    const emptyReview = emptySpotsLabel(S);
    body = (
      <>
        <Card>
          <H3>Join a live game</H3>
          <Muted>Enter the 4-letter game code from the driver’s phone.</Muted>
          <div className="row">
            <input
              type="text"
              id="join-code"
              placeholder="Game code"
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              style={{ width: 110, textTransform: "uppercase" }}
            />
            <PBtn
              label="Join live game"
              kind="primary"
              onClick={async () => {
                const code = inputValue("join-code").trim().toUpperCase();
                if (!code) {
                  eng.S.error = "Enter the 4-letter game code first.";
                  eng.emit();
                  return;
                }
                await eng.joinLiveGame(code);
              }}
            />
          </div>
        </Card>
        <Card>
          <div className="row spread">
            <span>
              <strong>Preferred lineup</strong>{" "}
              <span className="muted">· {S.preferredLineup ? "Ready" : "Not set"}</span>
            </span>
            <PBtn
              label="Manage"
              small
              onClick={() => {
                eng.modal = { kind: "managePreferred" };
                eng.emit();
              }}
            />
          </div>
          {S.lastLineup ? (
            <div className="row" style={{ marginTop: 8 }}>
              <PBtn label="Use last game’s lineup" onClick={() => eng.applyLastLineup()} />
            </div>
          ) : null}
        </Card>
        <div className="row">
          <PBtn label="Refresh lineup" kind="primary" grow onClick={() => eng.autoRefreshLineup()} />
          <PBtn
            label="Review & start"
            kind="primary"
            grow
            disabled={!!emptyReview}
            onClick={() => eng.goReview()}
          />
          <PBtn label="Clear" kind="ghost" small onClick={() => eng.clearLineup()} />
        </div>
        {emptyReview ? (
          <Muted>Fill {emptyReview} to review &amp; start.</Muted>
        ) : null}
        <div className="field-wrap">
          <Field
            eng={eng}
            lineup={S.lineup}
            names={S.roster.map((r) => r.name)}
            removedPositions={S.removedPositions}
          />
        </div>
        <Muted center>Tap a spot to choose a player</Muted>
        <p className="muted">
          <strong>OPENING BENCH</strong> —{" "}
          {bench.length ? bench.map((i) => S.roster[i].name).join(", ") : "none"}
        </p>
        {!SB.rosterLoaded ? (
          <p className="muted small">Roster: sample roster</p>
        ) : null}
      </>
    );
  } else if (S.setupTab === "roster") {
    body = (
      <>
        <H2>Attendance &amp; positions</H2>
        <Muted>Tap positions to toggle · keep at least one</Muted>
        {(eng.rosterSourceLabel() || SB.rosterError || !SB.rosterLoaded) && (
          <Muted>
            {eng.rosterSourceLabel() ||
              (SB.rosterLoaded ? "" : "Roster: sample roster")}
            {SB.rosterError ? " " + SB.rosterError : ""}
          </Muted>
        )}
        <RosterRows eng={eng} />
        <div className="row">
          <PBtn
            label="Add player"
            onClick={() => {
              eng.modal = { kind: "addPlayer" };
              eng.emit();
            }}
          />
          <PBtn label="Export roster" onClick={() => eng.downloadRosterCsv()} />
          {SB.configured && SB.authUser ? (
            <PBtn
              label="Save roster"
              onClick={async () => {
                const ok = await eng.saveRosterToBackend();
                if (!ok) eng.S.error = "Could not save the roster — try again.";
                eng.emit();
              }}
            />
          ) : null}
        </div>
        <Muted>Notes are private.</Muted>
      </>
    );
  } else if (S.setupTab === "settings") {
    body = (
      <>
        <H2>Match settings</H2>
        <Card>
          <p>
            <label>
              Match minutes{" "}
              <input
                type="number"
                defaultValue={S.settings.matchMinutes}
                min={10}
                max={120}
                onChange={(e) => eng.setSetting("matchMinutes", +e.target.value)}
              />
            </label>
          </p>
          <p>
            <label>
              Substitution cadence (min){" "}
              <input
                type="number"
                defaultValue={S.settings.cadence}
                min={1}
                max={30}
                onChange={(e) => eng.setSetting("cadence", +e.target.value)}
              />
            </label>
          </p>
          <p>
            <label>
              Subs per rotation{" "}
              <input
                type="number"
                defaultValue={S.settings.subsPerRotation}
                min={1}
                max={6}
                onChange={(e) => eng.setSetting("subsPerRotation", +e.target.value)}
              />
            </label>
          </p>
          <p>
            <label>
              Fair-time threshold (min){" "}
              <input
                type="number"
                defaultValue={S.settings.fairTimeThreshold}
                min={1}
                max={20}
                onChange={(e) => eng.setSetting("fairTimeThreshold", +e.target.value)}
              />
            </label>
          </p>
          <p>
            <label>
              <input
                type="checkbox"
                defaultChecked={S.settings.countGoalieTime}
                onChange={(e) => eng.setSettingCheck("countGoalieTime", e.target.checked)}
              />{" "}
              Count goalie time toward total game time
            </label>
            <br />
            <span className="muted">
              Off by default: totals count only non-goalie minutes. Goalie minutes
              are still tracked and shown.
            </span>
          </p>
          <p>
            <label>
              Team name{" "}
              <input
                type="text"
                key={S.teamName}
                defaultValue={S.teamName}
                onChange={(e) => eng.setTeamName(e.target.value)}
              />
            </label>
          </p>
          {SB.authUser ? (
            <>
              <p className="muted">Signed in as {SB.authUser.email || "coach"}</p>
              <div className="row">
                <PBtn label="Sign out" kind="ghost" onClick={() => void eng.signOutUser()} />
              </div>
            </>
          ) : null}
        </Card>
        <ShareViewCard eng={eng} />
      </>
    );
  } else {
    body = <HistoryView eng={eng} />;
  }
  return (
    <section aria-label="Setup">
      {activeNote}
      <div className="team-head">
        <h2>🔥⚽ {S.teamName}</h2>
      </div>
      <Tabs
        tabs={tabs}
        current={S.setupTab}
        onSelect={(k) => {
          S.setupTab = k as typeof S.setupTab;
          eng.emit();
        }}
      />
      {body}
    </section>
  );
}

function ShareViewCard({ eng }: { eng: Engine }) {
  const SB = eng.SB;
  if (!SB.authUser) return null;
  if (!SB.viewerCodeLoaded && !SB.viewerCodeLoading) {
    void eng.loadViewerCode();
  }
  const code = SB.viewerCode;
  return (
    <Card>
      <H3>Share a view link</H3>
      <Muted>
        Anyone with the link can watch live and see history — no account, no
        sign-in. Generating a new link turns off the old one.
      </Muted>
      {code ? (
        <>
          <p>
            Current code: <strong>{code}</strong>
          </p>
          <p className="muted small">{eng.viewerLinkUrl(code)}</p>
          <div className="row">
            <PBtn
              label="Copy viewer link"
              onClick={async () => {
                await eng.copyText(eng.viewerLinkUrl(code));
                eng.showToast("Link copied");
              }}
            />
            <PBtn label="Generate new link" onClick={() => void eng.generateViewerCode()} />
          </div>
        </>
      ) : (
        <>
          <Muted>{SB.viewerCodeLoaded ? "No view link yet." : "Loading…"}</Muted>
          <div className="row">
            <PBtn label="Generate view link" onClick={() => void eng.generateViewerCode()} />
          </div>
        </>
      )}
    </Card>
  );
}

/* ---------- Review ---------- */

function ReviewScreen({ eng }: { eng: Engine }) {
  const S = eng.S;
  const empty = emptySpotsLabel(S);
  return (
    <section aria-label="Kickoff review">
      <H2>Kickoff review</H2>
      <Muted>Check the field and bench, then start the clock.</Muted>
      {empty ? (
        <p className="error" role="alert">
          Fill {empty} to start. Go back to setup and tap an empty spot to choose a
          player.
        </p>
      ) : null}
      <div className="field-wrap">
        <Field
          eng={eng}
          lineup={S.lineup}
          names={S.roster.map((r) => r.name)}
          removedPositions={S.removedPositions}
          readonly
        />
      </div>
      <H3>Bench</H3>
      <Bench eng={eng} />
      <div className="row">
        <PBtn
          label="Start game"
          kind="primary"
          grow
          icon={Play}
          disabled={!!empty}
          onClick={() => eng.startGame()}
        />
        <PBtn label="Back to setup" onClick={() => eng.backToSetup()} />
      </div>
    </section>
  );
}

/* ---------- Live (coach) ---------- */

function LiveScreen({ eng }: { eng: Engine }) {
  const S = eng.S;
  const SB = eng.SB;
  const tabs: [string, string][] = [
    ["actions", "Actions"],
    ["minutes", "Minutes"],
    ["team", "Team"],
  ];
  if (SB.role === "viewer" && SB.liveId) tabs.push(["history", "History"]);

  let body: React.ReactNode = null;
  if (S.liveTab === "history") {
    body = (
      <>
        <H2>History</H2>
        <HistoryView eng={eng} />
      </>
    );
  } else if (S.liveTab === "actions") {
    const benchHint = S.selection && S.selection.kind === "in"
      ? S.roster[S.selection.player].name + " selected · tap a field player to sub them on"
      : S.queue.length
        ? S.queue.length + " queued · tap field or bench to add another"
        : "tap a player to start a sub";
    body = (
      <>
        <div className="field-wrap">
          <Field
            eng={eng}
            lineup={S.lineup}
            names={S.roster.map((r) => r.name)}
            removedPositions={S.removedPositions}
            showMinutes
            live
            swapOverlay={S.swapPair.length === 2 && !S.queue.length}
          />
        </div>
        <div className="bench-head">
          <h3>Bench</h3>
          <span className="muted small">{benchHint}</span>
        </div>
        <Bench eng={eng} interactive />
        <div className="apply-slot">
          {S.queue.length ? (
            <PBtn
              label={"Apply " + S.queue.length + " now"}
              kind="apply"
              onClick={() => eng.applyQueue()}
            />
          ) : null}
        </div>
        <div className="queue-area">
          {S.queue.length ? (
            <>
              <h3>Next change</h3>
              <p className="muted">
                {S.queue.length} ready ·{" "}
                <button
                  type="button"
                  className="small ghost"
                  onClick={() => {
                    S.queue = [];
                    S.selection = null;
                    eng.emit(true);
                  }}
                >
                  Clear
                </button>
              </p>
              {S.queue.map((q, qi) => (
                <div className="queue-item" key={qi}>
                  <span className="q-num">{qi + 1}</span>
                  <span>
                    ↓ {S.roster[q.out].name} ({POSITIONS[q.pos]})
                  </span>
                  <span className="arrow">→</span>
                  <span>↑ {S.roster[q.in].name}</span>
                  <PBtn
                    label="Remove"
                    small
                    onClick={() => {
                      S.queue.splice(qi, 1);
                      eng.emit(true);
                    }}
                  />
                </div>
              ))}
              <div className="row">
                <PBtn label="Suggest rotation" onClick={() => eng.suggestRotation()} />
              </div>
            </>
          ) : (
            <>
              <Muted>
                No substitutions queued. Tap a field player, then a bench player —
                or a bench player first, then a field player.
              </Muted>
              <div className="row">
                <PBtn label="Suggest rotation" onClick={() => eng.suggestRotation()} />
              </div>
            </>
          )}
        </div>
        <div className="row actions-row">
          <PBtn label="Edit lineup" onClick={() => eng.goEditLineup()} />
          {S.shortMode ? (
            <PBtn label="Return to full strength (7v7)" onClick={() => eng.fullStrength()} />
          ) : (
            <PBtn
              label="Play short (6v7)"
              onClick={() => {
                eng.modal = { kind: "short" };
                eng.emit();
              }}
            />
          )}
          <PBtn
            label="Edit goals"
            onClick={() => {
              eng.modal = { kind: "editGoalsLive" };
              eng.emit();
            }}
          />
        </div>
      </>
    );
  } else if (S.liveTab === "minutes") {
    body = (
      <>
        <H2>Minutes — actual &amp; projected</H2>
        <Muted>
          Fair share: {fmtMin(fairShareSec(S))} min · threshold ±
          {S.settings.fairTimeThreshold} min ·{" "}
          {S.settings.countGoalieTime
            ? "goalie time counts"
            : "goalie time excluded from totals"}
          .
        </Muted>
        <div id="live-minutes-inline">
          <MinutesRows eng={eng} />
        </div>
        <H3>Goals</H3>
        {displayGoals(S.goals).length ? (
          displayGoals(S.goals).map((g, i) => (
            <p key={i}>
              {goalLabel(g, S.roster)} ({g.side === "us" ? "US" : "THEM"})
            </p>
          ))
        ) : (
          <Muted>No goals yet.</Muted>
        )}
        <div className="row">
          <PBtn
            label="Edit goals"
            onClick={() => {
              eng.modal = { kind: "editGoalsLive" };
              eng.emit();
            }}
          />
        </div>
      </>
    );
  } else if (S.liveTab === "team") {
    body = (
      <>
        <H2>Team — player status</H2>
        <Muted>Alphabetical. Notes are private.</Muted>
        <RosterRows eng={eng} />
        <H3>Starting lineup (read-only)</H3>
        <div className="field-wrap" style={{ position: "static" }}>
          <Field
            eng={eng}
            lineup={S.startingLineup || S.lineup}
            names={S.roster.map((r) => r.name)}
            removedPositions={[]}
            readonly
          />
        </div>
      </>
    );
  }

  return (
    <section aria-label="Live game">
      <Scoreboard eng={eng} />
      {S.undoStack.length ? (
        <div className="game-actions">
          <LinkBtn
            label={"Undo " + S.undoStack[S.undoStack.length - 1].label}
            onClick={() => eng.undoLast()}
          />
        </div>
      ) : null}
      <Tabs
        tabs={tabs}
        current={S.liveTab}
        onSelect={(k) => {
          S.liveTab = k as typeof S.liveTab;
          eng.emit();
        }}
      />
      {body}
      <div className="row" style={{ marginTop: 12 }}>
        <PBtn label="Halftime" kind="primary" grow onClick={() => eng.goHalftime()} />
        <PBtn label="End game" grow onClick={() => eng.goEndGame()} />
      </div>
      {SB.role === "driver" && SB.liveId ? (
        <p className="muted small" style={{ textAlign: "center" }}>
          Game code <strong>{SB.liveCode}</strong> — the other coach enters this
          code on setup to join.
        </p>
      ) : null}
    </section>
  );
}

function MinutesRows({ eng }: { eng: Engine }) {
  const S = eng.S;
  const present = S.roster
    .map((_, i) => i)
    .filter((i) => S.roster[i].present)
    .sort((a, b) => totalSec(S, b) - totalSec(S, a));
  return (
    <>
      {present.map((i) => {
        const f = flagFor(S, i);
        const g = goalsFor(S, i);
        const gk = liveGkSec(S, i) > 0;
        return (
          <div className="mrow" key={i}>
            <div>
              <span className="name">{S.roster[i].name}</span>
              {g ? <span title="Goals"> ⚽ {g}</span> : ""}
              {S.roster[i].tired ? <span className="tired-dot"> ● tired</span> : ""}
              {gk ? (
                <span className="flag gk">GK {fmtMin(liveGkSec(S, i))}</span>
              ) : null}
            </div>
            <div className="nums">
              {fmtMin(totalSec(S, i))} min · proj {fmtMin(projectedSec(S, i))}{" "}
              <span className={"flag " + f.cls}>{f.label}</span>
            </div>
            <PBtn
              label={S.roster[i].tired ? "Untire" : "Tired"}
              small
              onClick={() => eng.toggleTired(i)}
            />
          </div>
        );
      })}
    </>
  );
}

/* ---------- Halftime ---------- */

function HalftimeScreen({ eng }: { eng: Engine }) {
  const S = eng.S;
  const halfBoundary = S.settings.matchMinutes * 30;
  const snapNeeded = S.elapsed !== halfBoundary;
  if (!S.plannedLineup) {
    // Auto-generate the plan favouring low minutes (spec §9.5).
    S.plannedLineup = autoLineup(S, true);
  }
  const firstHalf = S.roster
    .map((_, i) => i)
    .filter((i) => S.roster[i].present)
    .sort((a, b) => totalSec(S, a) - totalSec(S, b));
  const filled = S.plannedLineup.filter((x) => x != null).length;
  return (
    <section aria-label="Halftime planner" className="halftime-head">
      <span className="badge-pill">HALFTIME</span>
      <h2>Reset the balance.</h2>
      <Muted>
        The suggestion favors players with fewer first-half minutes, then maps the
        next rotation.
      </Muted>
      <div className="two-col">
        {firstHalf.map((i) => (
          <div className="mrow" key={i}>
            <span className="name">{S.roster[i].name}</span>
            <span className="nums">{fmtMin(totalSec(S, i))} min</span>
          </div>
        ))}
      </div>
      <div className="row">
        <PBtn
          label="Position preferences"
          onClick={() => {
            eng.modal = { kind: "halftimePrefs" };
            eng.emit();
          }}
        />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <PBtn label="Refresh lineup" kind="primary" grow onClick={() => eng.planRefresh()} />
        <span className="muted">Lineup {S.planCount || 1}</span>
      </div>
      <H3>Second-half {S.shortMode ? "6v7" : "7v7"} lineup</H3>
      <Muted>
        {filled}/{fieldCount(S)} filled · tap a player to change
      </Muted>
      <div className="field-wrap" style={{ position: "static" }}>
        <Field
          eng={eng}
          lineup={S.plannedLineup}
          names={S.roster.map((r) => r.name)}
          removedPositions={S.removedPositions}
        />
      </div>
      <div className="row">
        <PBtn label="Start second half" kind="primary" grow onClick={() => eng.startSecondHalf()} />
        {snapNeeded ? (
          <PBtn
            label={"Set clock to " + fmtClock(halfBoundary)}
            onClick={() => eng.snapClock()}
          />
        ) : null}
        <PBtn label="Back to live (no change)" onClick={() => eng.backToLive()} />
      </div>
    </section>
  );
}

/* ---------- Finished ---------- */

function FinishedScreen({ eng }: { eng: Engine }) {
  const S = eng.S;
  const last = S.history[S.history.length - 1];
  if (!last) return <p>No finished game yet.</p>;
  return (
    <section aria-label="Finished game">
      <H2>
        Full time — US {last.ourScore} – {last.theirScore} THEM
      </H2>
      {S.saveNote ? <Muted>{S.saveNote}</Muted> : null}
      <div className="field-wrap" style={{ position: "static" }}>
        <Field
          eng={eng}
          lineup={last.lineup}
          names={last.players.map((p) => p.name)}
          removedPositions={[]}
          readonly
        />
      </div>
      <p>
        {displayGoals(last.goals).length
          ? "Scorers: " +
            displayGoals(last.goals)
              .map((g) => goalLabel(g, last.players))
              .join(", ")
          : "No goals recorded."}
      </p>
      <div className="row">
        <PBtn
          label="Close and view history"
          kind="primary"
          onClick={() => {
            const home = eng.homeUrl();
            eng.closeFinishedGame();
            eng.pushUrl(home);
          }}
        />
        <PBtn
          label="Download CSV"
          icon={Download}
          onClick={() => eng.downloadLastGameCsv()}
        />
        <PBtn
          label="Edit goals"
          onClick={() => {
            eng.modal = { kind: "editGoalsPast", hi: S.history.length - 1 };
            eng.emit();
          }}
        />
      </div>
      <div className="row">
        <PBtn
          label="Start new game"
          onClick={() => {
            eng.startNewGame();
            eng.pushUrl(eng.homeUrl());
          }}
        />
        <PBtn label="Discard this game" kind="danger" onClick={() => eng.discardFinishedGame()} />
      </div>
      <H3>Minutes</H3>
      {last.players.map((p, i) => (
        <div className="mrow" key={i}>
          <span className="name">{p.name}</span>
          <span className="nums">
            {fmtMin(p.seconds)} min
            {p.gkSeconds ? " (GK " + fmtMin(p.gkSeconds) + ")" : ""}
            {p.goals ? " ⚽ " + p.goals : ""}
          </span>
        </div>
      ))}
      <Divider />
      <H3>History</H3>
      <HistoryView eng={eng} />
    </section>
  );
}

/* ---------- Viewer screens ---------- */

function ViewerScreens({ eng }: { eng: Engine }) {
  const S = eng.S;
  const SB = eng.SB;
  if (S.screen === "live" || S.screen === "halftime") {
    return <ViewerGameView eng={eng} />;
  }
  const tabs: [string, string][] = [
    ["game", "Game"],
    ["history", "History"],
  ];
  const shareRow = (
    <div className="row">
      <PBtn label="Share this view" icon={Share2} onClick={() => void shareViewer(eng)} />
      <PBtn label="Leave shared view" onClick={() => leaveViewer(eng)} />
    </div>
  );
  if (S.viewerTab === "history") {
    return (
      <section aria-label="Shared view">
        <H2>Shared view</H2>
        <Tabs
          tabs={tabs}
          current={S.viewerTab}
          onSelect={(k) => {
            S.viewerTab = k as typeof S.viewerTab;
            eng.emit();
          }}
        />
        <H3>History</H3>
        <HistoryView eng={eng} />
        {shareRow}
      </section>
    );
  }
  const lives = SB.viewerLives || [];
  return (
    <section aria-label="Shared view">
      <H2>Shared view</H2>
      <Tabs
        tabs={tabs}
        current={S.viewerTab}
        onSelect={(k) => {
          S.viewerTab = k as typeof S.viewerTab;
          eng.emit();
        }}
      />
      {lives.length ? (
        lives.map((g) => {
          const st = (g.state as Record<string, unknown>) || {};
          const score =
            "US " +
            ((st.ourScore as number) || 0) +
            " – " +
            ((st.theirScore as number) || 0) +
            " THEM";
          return (
            <Card key={g.id as string}>
              <strong>There’s a live game in progress</strong>
              <div className="muted">
                {score} · {fmtClock(eng.activeGameElapsed(st))}
              </div>
              <div className="row" style={{ marginTop: 8 }}>
                <PBtn
                  label="Join"
                  kind="primary"
                  grow
                  onClick={() => eng.joinViewerGame(g.id as string)}
                />
              </div>
            </Card>
          );
        })
      ) : (
        <Muted>
          No live game right now. When the coach starts a game, it appears here
          live.
        </Muted>
      )}
      {shareRow}
    </section>
  );
}

function ViewerGameView({ eng }: { eng: Engine }) {
  const S = eng.S;
  const tabs: [string, string][] = [
    ["game", "Game"],
    ["history", "History"],
  ];
  const shareRow = (
    <div className="row">
      <PBtn label="Share this view" icon={Share2} onClick={() => void shareViewer(eng)} />
      <PBtn label="Leave shared view" onClick={() => leaveViewer(eng)} />
    </div>
  );
  if (S.viewerTab === "history") {
    return (
      <section aria-label="Shared view">
        <H2>Shared view</H2>
        <Scoreboard eng={eng} readonly />
        <Tabs
          tabs={tabs}
          current={S.viewerTab}
          onSelect={(k) => {
            S.viewerTab = k as typeof S.viewerTab;
            eng.emit();
          }}
        />
        <H3>History</H3>
        <HistoryView eng={eng} />
        {shareRow}
      </section>
    );
  }
  const bench = benchPlayers(S);
  return (
    <section aria-label="Live game">
      <Scoreboard eng={eng} readonly />
      {S.screen === "halftime" ? (
        <p className="muted" style={{ textAlign: "center" }}>
          Halftime
        </p>
      ) : null}
      <Tabs
        tabs={tabs}
        current={S.viewerTab}
        onSelect={(k) => {
          S.viewerTab = k as typeof S.viewerTab;
          eng.emit();
        }}
      />
      <div className="field-wrap">
        <Field
          eng={eng}
          lineup={S.lineup}
          names={S.roster.map((r) => r.name)}
          removedPositions={S.removedPositions}
          showMinutes
          readonly
        />
      </div>
      <div className="bench-head">
        <h3>Bench</h3>
      </div>
      {bench.length ? (
        <div className="bench v-bench">
          {bench.map((i) => (
            <div className="v-bench-row" key={i}>
              <span className="b-name">{S.roster[i].name}</span>
              <span className="b-mins v-mins">
                {Math.round(totalSec(S, i) / 60)}m
              </span>
            </div>
          ))}
        </div>
      ) : (
        <Muted>Bench is empty — everyone present is on the field.</Muted>
      )}
      <H3>Goals</H3>
      {displayGoals(S.goals).length ? (
        displayGoals(S.goals).map((g, i) => (
          <p key={i}>
            {goalLabel(g, S.roster)} ({g.side === "us" ? "US" : "THEM"})
          </p>
        ))
      ) : (
        <Muted>No goals yet.</Muted>
      )}
      {shareRow}
    </section>
  );
}
