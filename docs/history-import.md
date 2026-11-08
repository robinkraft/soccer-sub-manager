# History import — private app's 10 past games → Supabase `game_history`

Status: **done — 10 games imported 2026-11-07.** Robin ran the
regenerated `import.sql` in the Supabase SQL Editor and confirmed
"Got everything in." Season totals still to be verified against the
private app. The private app now has the same **Export all history**
and **Export roster** buttons as this app, so its export is the
migration source.

**Roster seeding:** `roster.sql` in the import folder (generated from
the private app's roster export: 13 players with preferred positions
and notes, plus the preferred lineup) seeds the single
`team_roster` row. Run order in the SQL Editor: (1)
`supabase/add-private-parity.sql` (adds `preferred_lineup`), (2)
`roster.sql`, (3) `import.sql`.

## Why a CSV import (not a direct read)

The private artifact's saved server state is not readable by the agent
(`getstate` returns `authorized: false`), so there is no direct
extraction path. The private app's all-history export is the verified
source.

## What lives where

- **This repo:** this doc only. No import data, no real names.
- **Outside the repo:** `~/workspace/soccer-sub-manager-history-import/`
  — `import-history.mjs` (dependency-free Node script), `README.md`
  (the exact steps), `manifest.example.json`, and a `data/` folder for
  the exported CSVs. That folder is never pushed to GitHub; it contains
  the real roster and team name by design.

## Steps (summary — the import folder's README is authoritative)

**Primary path — one file.** In the app that holds the history,
History tab → **Export all history** — one file with every game,
lineups and goal minutes. Dry-run:
`node import-history.mjs --all-history all-history.csv --out import.sql`
(no manifest needed — team name and lineups come from the file).
Then Supabase SQL Editor: paste `import.sql`, run.

**Fallback path — per-game files + manifest.** In the private app,
History tab: save the **Full season CSV** (verification reference),
then each game's **Export this game CSV** (10 files) into the import
folder's `data/`. Fill in `manifest.json` (copy the example): per
game — `date`, `our_score`, `their_score`, `csv`, plus
`starting_lineup` (7 names in GK,RB,LB,RM,CM,LM,ST order) and
`goals` with minutes when known. Dry-run:
`node import-history.mjs --manifest manifest.json --out import.sql`.

Re-running the SQL is safe (each INSERT skips a game already present:
same `game_date` + score). Verify: portable app → History tab →
Season totals must match the dry-run's printed totals **and** the
private app's Season totals screen (same games played, avg/game,
counted total, per-position breakdown with goalie minutes included).
If a number differs, do not re-run the import — report the game and
the number.

## Shape notes (for the implementer)

- The script writes the **backend** shape the portable app reads:
  players as `{name, roster_index, present, total_minutes,
  goalie_minutes, goals, minutes_by_position}` (minutes, not seconds),
  goals as `{player_index, player_name, seconds, side}`, plus
  `game_date, team_name, match_minutes, elapsed_seconds, our_score,
  their_score, starting_lineup`.
- The per-game CSV's "Actual minutes" is the counted total
  (goalie-adjusted per the private app's setting, OFF by default);
  "GK minutes" stays separate; the per-position breakdown keeps goalie
  minutes — the goalie-time rule, applied to imported history too.
- **Goal minutes and starting lineups** come from the all-history
  export itself (its Games section carries the lineup; its Goals
  section carries scorer, minute and side). In the per-game fallback
  path they come from the manifest (`goals`, `starting_lineup`).
  Without manifest `goals`, goals import scorer-only (`seconds:
  null`); backfill minutes later with **Edit goals** in the portable
  app (which re-saves the row and updates Season totals). In the
  all-history path, `elapsed_seconds` is the file's played time; in
  the per-game path it is 0 (unknown for old games).
- **Unknown-scorer goals:** the import tops up only the US side
  against the score — opponent goals are never recorded as unknown
  entries (there is no scorer to assign), and the app does not list
  unknown opponent goals anywhere (Goals list, Edit goals, CSV
  Goals sections). The score itself carries the full tally.
- **Export roster** is a roster backup / transfer file only — the
  import script does not import rosters (the roster lives in
  Supabase `team_roster` and is edited in the app).
- The script was tested end-to-end on fictional data (2 games, sample
  roster): totals math, SQL shape and dedupe all verified; test files
  were removed afterwards.
