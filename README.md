# soccer-sub-manager

Next.js app generated with **Prism** (`prism/` git submodule). The UI and API live in **`apps/web/`** — not at the repo root.

Architecture and conventions: **[DOCS-Prism.md](prism/docs/DOCS-Prism.md)**.

### Prerequisites

- **Node.js** **24.x** (`engines` in `package.json`)
- **pnpm** — version in `packageManager`. `corepack enable` then `pnpm -v`.

### Quick start

```bash
git submodule update --init --recursive
pnpm install
# Edit apps/web/.env (created from .env.example during generate)
pnpm run db:push
pnpm run dev
```

Open http://localhost:3000 (or the port in `apps/web/package.json`).

### Documentation

| Doc | Purpose |
| --- | --- |
| [ARCHITECTURE-SoccerSubManager.md](docs/ARCHITECTURE-SoccerSubManager.md) | Mental model — fill in your domain |
| [DATABASE-SoccerSubManager.md](docs/DATABASE-SoccerSubManager.md) | Schema / query notes |
| [CLI-SoccerSubManager.md](docs/CLI-SoccerSubManager.md) | App CLI (`soccer-sub-manager`) |
| [MILESTONES-SoccerSubManager.md](docs/MILESTONES-SoccerSubManager.md) | Delivery checklist |
| [docs/decisions/](docs/decisions/) | ADRs (`001` scaffolded) |
| [prism/docs/](prism/docs/) | Prism UI, admin, deployment, sync |

### Daily commands (repo root)

| Task | Command |
| --- | --- |
| Dev server | `pnpm run dev` |
| Build | `pnpm run build` |
| CI parity | `pnpm run quality:ci` |
| Lint / typecheck | `pnpm run lint` / `pnpm run typecheck` |
| Knip | `pnpm run knip` |
| Database | `pnpm run db:push` / `pnpm run db:studio` |
| Align with Prism | `pnpm run prism:sync` |
| Monthly health | `pnpm run chores` |

Do **not** run `pnpm install` only inside `prism/` — install once at repo root.

### Project health & CI

- **CI:** [.github/workflows/ci.yml](.github/workflows/ci.yml) — submodules, format, lint, knip, test, build
- **Dependabot:** [.github/dependabot.yml](.github/dependabot.yml) — root, `prism/`, submodule SHA
- **Commits:** Husky + lint-staged (`.lintstagedrc.cjs`)
- **CLI:** `pnpm run setup` then `soccer-sub-manager --help`

### Vercel

- **Root Directory**: `apps/web`
- **Install Command**: `cd ../.. && pnpm install`
- **Build Command**: `pnpm run build`
- Enable **submodules** on the Git integration

### Working on Prism

```bash
cd prism
# edit packages, commit, push to github.com/thushana/prism
cd ..
git add prism && git commit -m "Update Prism submodule"
```

See [GENERATE-Prism.md](prism/docs/GENERATE-Prism.md) and [DEPLOYMENT-Prism.md](prism/docs/DEPLOYMENT-Prism.md).
