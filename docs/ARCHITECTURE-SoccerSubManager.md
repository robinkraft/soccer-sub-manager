# ARCHITECTURE-SoccerSubManager

Mental model for **soccer-sub-manager**: a Prism consumer app with the submodule at `prism/`.

This matches [ARCHITECTURE-Prism.md](../prism/docs/ARCHITECTURE-Prism.md) and apps like Porch Scope / TimeTraveler:

- **`pnpm install` at repo root** — not only inside `prism/`
- **Next.js app** under **`apps/web/`**
- **Dependencies**: `file:../../prism/packages/...` in `apps/web/package.json`
- **TypeScript paths**: `../../prism/packages/*/source` in `apps/web/tsconfig.json`
- **Next.js**: `--webpack` dev/build; `transpilePackages` + webpack aliases in `apps/web/next.config.ts`; keep `experimental.optimizePackageImports` for `ui`, `lucide-react`, and `gsap` so layout chrome stays out of first-load JS (see [UI-Prism.md](../prism/docs/UI-Prism.md))
- **Styles**: Prism globals imported from `apps/web/ui/styles/globals.css`

## Layout

```
soccer-sub-manager/
  prism/                 # git submodule
  apps/
    web/                 # Next.js App Router (pnpm workspace name: web)
      app/
      database/
      intelligence/tasks/
      ui/styles/
      config/
      cli/
      scripts/
      tests/
      docs/              # in-app notes (MDX)
  docs/                  # ARCHITECTURE-*, DATABASE-*, CLI-*, MILESTONES-*, decisions/
  knip.config.ts
  .github/               # ci.yml, dependabot.yml
  package.json           # pnpm --filter web, prism:sync, quality:ci, …
  pnpm-workspace.yaml
```

## Decisions

Architecture decision records live under **`docs/decisions/`** (`NNN-DECISION-short-slug.md`). See [DOCS-Prism.md](../prism/docs/DOCS-Prism.md).

## Customize

Describe your domain, data flow, and auth model here. Link to `prism/docs/` for Prism-owned behavior (admin, UI, flags, database patterns).
