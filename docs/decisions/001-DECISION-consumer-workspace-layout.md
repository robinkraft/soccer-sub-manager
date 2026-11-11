# 001-DECISION-consumer-workspace-layout

Decision record (see [DOCS-Prism.md](../../prism/docs/DOCS-Prism.md): document **why**, not full **how**—implementation lives in code).

## Context

- **soccer-sub-manager** is a Prism consumer app: Next.js UI plus shared packages from the **`prism/`** git submodule.
- We need one deployable git repo, Vercel-friendly installs, and the same ergonomics as mature consumers (TimeTraveler, Porch Scope).
- Running `pnpm install` only inside `prism/` duplicates dependencies and breaks alignment with the app.

## Decision

- **Repo root** orchestrates scripts (`pnpm --filter web`, `prism:sync`, database commands).
- **Next.js app** lives at **`apps/web/`** (pnpm workspace package name `web`).
- **Prism** is a **git submodule** at **`prism/`** with `file:../../prism/packages/...` dependencies in `apps/web/package.json`.
- **Docs**: app mental model in `docs/ARCHITECTURE-SoccerSubManager.md`; ADRs in `docs/decisions/`.
- **Env**: `apps/web/.env.example` (committed) and `apps/web/.env` (gitignored, created on generate).

## Pros

- Matches Prism `generate` output and existing consumer repos — no flat-root layout drift.
- Vercel **Root Directory** `apps/web` with install `cd ../.. && pnpm install`.
- Submodule lets you commit Prism changes from the app repo when iterating on shared packages.

## Cons / Risks

- Contributors must learn to run commands from **repo root**, not only `apps/web/`.
- Git submodules require `submodules: recursive` in CI and on Vercel.

## Follow-Ups

- Add domain-specific ADRs as **`002-DECISION-…`**, **`003-DECISION-…`** under `docs/decisions/`.
- Flesh out `docs/ARCHITECTURE-SoccerSubManager.md` with your data flow and auth model.

## Where Implemented

- Scaffold: `prism generate` ([GENERATE-Prism.md](../../prism/docs/GENERATE-Prism.md))
- Workspace: `pnpm-workspace.yaml`, root `package.json`, `apps/web/package.json`
- Prism layout reference: [ARCHITECTURE-Prism.md](../../prism/docs/ARCHITECTURE-Prism.md)
