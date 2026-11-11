# MILESTONES-SoccerSubManager

Discrete, testable milestones for **soccer-sub-manager**. Philosophy: [DOCS-Prism.md](../prism/docs/DOCS-Prism.md).

## Milestone 1: Foundation

_Goal: App runs locally with database and Prism auth wired._

- [ ] `pnpm install` at repo root, submodule initialized
- [ ] `apps/web/.env` configured (Neon + `PRISM_KEY_*`)
- [ ] `pnpm run db:push` / migrations applied
- [ ] `pnpm run dev` — app loads at localhost
- [ ] `pnpm run quality:ci` passes locally

## Milestone 2: Domain core

_Goal: Describe your primary user flow._

- [ ] …

## Milestone 3: Production

_Goal: Vercel deploy with submodules._

- [ ] Root Directory `apps/web`, install `cd ../.. && pnpm install`
- [ ] CI green on `main`

Add checkboxes as you ship; keep **why** in `docs/decisions/` when choices are non-obvious.
