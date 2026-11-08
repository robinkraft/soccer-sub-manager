# History import — private app's 10 past games → Supabase `game_history`

Status: **not yet run.** No historical rows have been inserted; the
portable Supabase history is currently empty (no games finished through
the portable app yet). The real season history (10 games: two on Nov 7,
then Oct 31, Oct 24, Oct 17, Oct 10, etc.) lives in the private app.

## Why a CSV import (not a direct read)

The private artifact's saved server state is not readable by the agent
(`getstate` returns `authorized: false`), so there is no direct
extraction path. The private app's per-game CSV exports are the only
verified source.

## What lives where

- **This repo:** this doc only. No import data, no real names.
- **Outside the repo:** `~/workspace/soccer-sub-manager-history-import/`
  — `import-history.mjs` (dependency-free Node script), `README.md`
  (the exact steps), `manifest.example.json`, and a `data/` folder for
  the exported CSVs. That folder is never pushed to GitHub; it contains
  the real roster and team name by design.

## Steps (summary — the import folder's README is authoritative)

1. In the private app, History tab: save the **Full season CSV**
   (verification reference), then each game's **Export this game CSV**
   (10 files) into the import folder's `data/`.
2. Fill in `manifest.json` (copy the example): per game — `date`,
   `our_score`, `their_score`, `csv`, plus `starting_lineup` (7 names
   in GK,RB,LB,RM,CM,LM,ST order) and `goals` with minutes when known.
3. Dry-run: `node import-history.mjs --manifest manifest.json --out import.sql`
   — prints a per-game summary and the expected season totals.
4. Supabase SQL Editor: paste `import.sql`, run. Safe to re-run
   (each INSERT skips a game already present: same `game_date` + score).
5. Verify: portable app → History tab → Season totals must match the
   dry-run's printed totals **and** the private app's Season totals
   screen (same games played, avg/game, counted total, per-position
   breakdown with goalie minutes included). If a number differs, do
   not re-run the import — report the game and the number.

## Shape notes (for the implementer)

- The script writes the **backend** shape the portable app reads:
  players as `{name, roster_index, present, total_minutes,
  goalie_minutes, goals, minutes_by_position}` (minutes, not seconds),
  goals as `{player_index, player_name, seconds, side}`, plus
  `game_date, team_name, match_minutes, elapsed_seconds (0 — unknown
  for old games), our_score, their_score, starting_lineup`.
- The per-game CSV's "Actual minutes" is the counted total
  (goalie-adjusted per the private app's setting, OFF by default);
  "GK minutes" stays separate; the per-position breakdown keeps goalie
  minutes — the goalie-time rule, applied to imported history too.
- Goal minutes are not in the per-game CSV. Without manifest `goals`,
  goals import scorer-only (`seconds: null`); backfill minutes later
  with **Edit goals** in the portable app (which re-saves the row and
  updates Season totals).
- The script was tested end-to-end on fictional data (2 games, sample
  roster): totals math, SQL shape and dedupe all verified; test files
  were removed afterwards.
