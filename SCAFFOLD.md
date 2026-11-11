# Soccer Substitution Manager — Prism Scaffold

**Status: verified empty Next.js shell. No Sub Manager screens or logic yet.**
The placeholder page (`apps/web/app/page.tsx`) is a Prism smoke test only —
replace it when porting. No roster data, no real player names, no team name,
no Supabase keys anywhere in this repo.

## What this is

- Consumer app generated with `prism generate --static` (see § Commands).
- Layout: repo root + `apps/web/` (Next.js app, workspace name `web`) +
  `prism/` git submodule (Prism core monorepo).
- Static export: `apps/web/next.config.ts` has `output: "export"` and
  `images: { unoptimized: true }`. Build output is `apps/web/out/`.
- Supabase JS client is installed (`@supabase/supabase-js@2.119.0`) for the
  port. No database/auth/AI Prism packages were added.

## Toolchain (verified on this VM)

- Node **v24.22.1** (do NOT upgrade — the generator writes `.nvmrc` = `24.11.1`
  for consumer apps; 24.22.1 satisfies it. Prism's README says Node >= 25 but
  the generated app targets Node 24).
- pnpm **10.28.0** (`npm install -g pnpm@10.28.0`).
- Next **16.2.7**, React **19.2.7**, Tailwind CSS **4**, TypeScript 6.
- Prism submodule SHA: **`d5a0f7defdad76415bf74d1caccde48e743b2dfc`**
  (`heads/main`, 2026-11-09, "HOOKS - Use flat lint-staged config for
  non-apps/web consumers"). Pinned here after a verified build; do not float
  the submodule without re-running the build.

## Commands run (exact)

```bash
# 1. pnpm (README version)
npm install -g pnpm@10.28.0

# 2. Prism checkout used to run the generator (NOT part of this repo)
git clone https://github.com/thushana/prism.git ~/workspace/prism-study
cd ~/workspace/prism-study
# pnpm install, with the version-switch disabled (see VM quirks):
npm_config_manage_package_manager_versions=false pnpm install \
  --config.manage-package-manager-versions=false

# 3. Generate (exact generator invocation; matches the recon decision)
./node_modules/.bin/tsx tools/app/tools.ts generate soccer-sub-manager \
  --path ../soccer-sub-manager-prism --static

# 4. Submodule — the generator's own `git submodule add` failed (see Deviations),
#    so it was added manually. This is the step the task asked for:
cd ~/workspace/soccer-sub-manager-prism
git submodule add https://github.com/thushana/prism.git prism
git submodule update --init --recursive
git submodule status   # -> d5a0f7defdad76415bf74d1caccde48e743b2dfc prism (heads/main)

# 5. Install + build (from repo root)
npm_config_manage_package_manager_versions=false pnpm install
pnpm --filter web run build        # -> apps/web/out/ (verified, see below)
```

Raw logs of the generator run and the final passing build:
`~/workspace/prism-generate.log`, `~/workspace/prism-build-final.log`.

## Build / serve locally

```bash
cd ~/workspace/soccer-sub-manager-prism
pnpm --filter web run build     # static export -> apps/web/out/
pnpm --filter web run dev       # dev server on :3000 (uses --webpack, not Turbopack)
# Serve the static export (next start does NOT work with output: "export"):
npx serve apps/web/out
# or: python3 -m http.server -d apps/web/out
```

Last verified build: `pnpm --filter web run build` exits 0,
`✓ Compiled successfully`, routes `/` and `/_not-found` static,
`apps/web/out/` = 2.4 MB with `index.html`. The built `index.html` contains
the placeholder copy; the built CSS contains Prism tokens (`--color-*`,
`--font-satoshi`), proving Tailwind 4 + Prism theme load.

## Entry points (for the porting agent)

- `apps/web/app/layout.tsx` — root layout. Imports the Prism fonts
  (`satoshi`, `sentient`, `zodiak` from `@ui`), `../ui/styles/globals.css`,
  and `../config/button-presets`. Metadata title is already
  "Soccer Substitution Manager". It still contains the Material Symbols
  Google Fonts `<link>` — see Open decision below.
- `apps/web/ui/styles/globals.css` — Tailwind 4 entry: imports `tailwindcss`,
  `tw-animate-css`, and Prism's `globals-prism.css` from the submodule;
  `@source` globs cover `../**/*` and `../../app/**/*`. Keep new app files
  under those globs or Tailwind classes will silently not exist.
- `apps/web/app/page.tsx` — placeholder only (PrismCard + PrismTypography +
  PrismButton smoke test). Replace with the real screens.
- `apps/web/config/button-presets.ts` — registers app-specific PrismButton
  presets (empty by default); layout imports it.
- `apps/web/config.prism.json` / `config.app.json` — Prism app config.
- `apps/web/library/config/` — Zod loaders for the Prism configs. There is no
  `library/authentication/` and no `database/` — the static scaffold omits
  them by design.

## Import paths (all resolve to the `prism/` submodule)

```ts
import { PrismButton, PrismCard, PrismTypography, PrismDivider, PrismSelect } from "@ui";
import { PrismIcon } from "@ui";                    // prefer iconStyle="lucide"
import { /* pickers */ } from "@ui/pickers";       // NOT needed — do not import
import { /* maps */ } from "@ui/map";              // NOT needed — do not import
import { createClient } from "@supabase/supabase-js";
```

Aliases live in `apps/web/next.config.ts` (webpack `resolve.alias`, used by
the `--webpack` build) and `apps/web/tsconfig.json` (`paths`). The build uses
webpack, not Turbopack (`turbopack: {}` in next.config).

## Dependencies changed after generation

- Removed from `apps/web/package.json` (unused, recon-flagged):
  `mapbox-gl@^3.16.0` and `@types/google.maps@^3.64.0`. Rebuild re-verified
  after removal. Note: `mapbox-gl` still appears in `pnpm-lock.yaml` only as
  a transitive optional peer of Prism's own `ui` package (dynamic-imported by
  `PrismMap`, which we do not use) — that is Prism's declaration, not the
  app's, and it is not installed into `apps/web/node_modules`.
- Added to `apps/web/package.json`: `@supabase/supabase-js@^2.119.0`
  (dependency, for the port). No Supabase URL/key is in this repo — the
  porting agent must wire config from the existing app's config shape
  (`{ url, anonKey }`), never pasting a real key into source.

## Deviations from the recon plan (read before touching the generator)

1. **Generator's submodule add failed; added manually.** The generator
   printed "Failed to add Prism submodule automatically" and its `pnpm
   install` then failed (`ERR_PNPM_LINKED_PKG_DIR_NOT_FOUND`, because the
   `file:../../prism/packages/*` deps had no target). Running the exact
   command it suggested — `git submodule add
   https://github.com/thushana/prism.git prism` — in the new repo worked
   first try (exit 0). Cause unknown, likely a transient network/git race
   inside the generator; the manual add is the documented fallback.
2. **`--static` left server-mode files in place; they were deleted.**
   The static scaffold is supposed to omit auth/admin pages, but the
   generated app still contained `app/(auth)/`, `app/admin/`, `app/api/`,
   `app/system-sheet/`, `app/flags/`, `app/.well-known/`,
   `library/authentication/`, and `library/kysely-shim.ts`. The baseline
   build failed on them (`Module not found: Can't resolve 'authentication'`
   from the sign-in and admin pages; system-sheet is `force-dynamic`).
   All eight paths were deleted — nothing outside them referenced them
   (verified by grep). This matches the recon's statement that the static
   scaffold omits those pages; the generator just didn't. If Prism is
   re-generated later, expect to delete them again (or check whether a
   newer generator fixes it).
3. **No initial git commit.** The generator runs `git init` + `git add .` +
   `git commit`, but this VM has no git identity configured
   (`user.name`/`user.email` unset everywhere, including the portable repo),
   so the commit failed and the generator warned and continued. All files
   are staged; the repo is on branch `master` (git's default) with zero
   commits. Do not invent an identity — the branch/commit/push step belongs
   to the later stage, with Robin's identity. Note: the task's "do not
   create the branch yet" was honoured; `master` here is only git's local
   default, not a pushed branch.
4. **Next.js rewrote `apps/web/tsconfig.json`** on first build (added
   `.next/dev/types/**/*.ts` to `include`). Cosmetic, keep it.
5. **Root `package.json` still lists `db:*` scripts** (`db:generate`,
   `db:migrate`, `db:push`, `db:seed`, `db:studio`) even though the static
   scaffold has no `database/` dir. Harmless; the port uses Supabase, not
   Drizzle — do not run them.
6. **Pre-existing peer warning on install:** `eslint-plugin-react 7.37.5`
   wants `eslint@^3 || … || ^9.7`, found `10.14.0`. From the generator's own
   versions, not from our changes; install still exits 0.

## VM quirks (will bite the next pnpm run — do not "fix" by upgrading)

- **`/tmp` is a 512 MB tmpfs.** pnpm stages downloads in `/tmp/.pnpm-store`
  and fills it, failing with `ERR_PNPM_ENOSPC`. Workaround in place:
  `/tmp/.pnpm-store` is a symlink to `~/workspace/.pnpm-store-tmp`
  (home disk, ~1 GB). **Keep that symlink.** If it is gone, recreate it
  before running pnpm.
- **pnpm self-switch must stay disabled.** Prism's root `packageManager`
  says pnpm@11.5.0 while the README/generator use 10.28.0; pnpm 10 tries
  to download 11.5.0 and fails with `EPERM … chown`. Always run pnpm with
  `npm_config_manage_package_manager_versions=false pnpm … \
  --config.manage-package-manager-versions=false`, or the version in
  `packageManager` will be re-attempted.
- **setgid `nogroup` dirs break pnpm's atomic writes.** Directories under
  `~/workspace` are setgid `nogroup` (gid 65534, unmapped in this VM's user
  namespace), so files pnpm creates inherit gid 65534 and pnpm's
  `chown(tempfile, <target uid:gid>)` fails with `EPERM` (exit 255) when it
  rewrites `pnpm-lock.yaml` / `node_modules/.modules.yaml`. Fix applied in
  this repo: `chown 0:0` on `pnpm-lock.yaml` and
  `node_modules/.modules.yaml`, plus `chmod g-s` + `chgrp -R 0` on
  `node_modules/`. If a future pnpm command fails with the same EPERM on a
  different temp file, check the target file/dir's gid with `ls -ln` and
  `chown 0:0` it (plain `chown root:root` on a fresh file works; only
  chowning *to* gid 65534 fails).
- **The Prism checkout for the generator lives at
  `~/workspace/prism-study`** (~1 GB with node_modules; the recon's
  `/tmp/prism-study` was wiped by a VM restart, so the clone was redone on
  home disk at the same SHA `d5a0f7de`). Keep it for re-running the
  generator or `prism:sync`; the repo's `prism/` submodule is the durable
  copy.

## Open decisions for the porting agent

- **Icons: Lucide vs Material Symbols.** `layout.tsx` still loads Material
  Symbols Rounded from Google Fonts at runtime (PrismIcon's default).
  Recon recommendation: use `iconStyle="lucide"` everywhere and drop the
  `<link>` + the `material-symbols-font` metadata entry, so the sideline
  app has no runtime font dependency.
- **Shell details from the port spec (§2) are not applied yet:** viewport
  lock (`maximum-scale=1, user-scalable=no`), `theme-color #0b1526`,
  `manifest.webmanifest`, single `<main id="main">` render target. Apply
  them in the port.
- **GitHub Pages workflow is not updated yet.** The generated
  `.github/workflows/ci.yml` already checks out with
  `submodules: recursive` — mirror that in the Pages workflow when the
  preview branch is created, and point its build at
  `pnpm --filter web run build` with `apps/web/out/` as the published dir.
- **No branch, no push, no commit yet** — later stage, with Robin.

## What the porting agent should do next

1. Read `~/workspace/soccer-sub-manager-prism-spec.md` (the full behaviour
   spec) and build the screens from it. Do not copy source from
   `~/workspace/soccer-sub-manager-portable/`; read it only for reference.
2. Replace `apps/web/app/page.tsx` with the real app. Keep the Supabase
   contract from spec §15 (client-side JS, same tables/RPCs); config shape
   is `{ url, anonKey }` and keys never go in source.
3. Use only `PrismButton`, `PrismCard`, `PrismTypography`, `PrismDivider`,
   `PrismSelect` from `@ui` (per the recon); form controls beyond
   `PrismSelect` are built locally with Tailwind tokens. Do not import
   `@ui/pickers` or `@ui/map`.
4. Mind the static-export rules: no `useSearchParams` without a
   `<Suspense>` boundary, no `headers()`/`cookies()`, no server-only
   imports in app code. The app's own pages must be static-safe.
5. Rebuild after every step (`pnpm --filter web run build`) and keep the
   submodule SHA pinned here until a deliberate Prism upgrade.
