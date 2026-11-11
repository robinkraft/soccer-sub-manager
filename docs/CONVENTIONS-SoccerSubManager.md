# CONVENTIONS-SoccerSubManager

Project token for doc filenames: **SoccerSubManager** (`ARCHITECTURE-SoccerSubManager.md`, this file).

## Commands

Run from **repo root**: `pnpm run dev`, `pnpm run build`, `pnpm run quality:ci`, `pnpm run prism:sync`, `pnpm run chores`.

## Environment

- **`apps/web/.env`** — local secrets (gitignored)
- **`apps/web/.env.example`** — committed template

## Code layout

- App code only under **`apps/web/`**
- Shared Prism packages under **`prism/packages/`**
- Add app-owned packages under **`packages/`** when needed (update `pnpm-workspace.yaml`)

## Decision records

- Directory: **`docs/decisions/`**
- Filename: **`NNN-DECISION-short-slug.md`** (three-digit prefix, increasing)
- Document **why**, not full **how** — link to code paths under `Where Implemented`

See [DOCS-Prism.md](../prism/docs/DOCS-Prism.md) for documentation philosophy.
