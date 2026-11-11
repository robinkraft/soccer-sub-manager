# DATABASE-SoccerSubManager

Quick reference for schema shape and query patterns. **Canonical columns and types:** `apps/web/database/schema.ts` — verify there first.

See [ARCHITECTURE-SoccerSubManager.md](./ARCHITECTURE-SoccerSubManager.md) for the mental model and [DATABASE-Prism.md](../prism/docs/DATABASE-Prism.md) for Prism database patterns.

## Stack

- **Drizzle ORM** with **PostgreSQL** (Neon) by default
- Env: `DATABASE_URL` / `DATABASE_URL_UNPOOLED` in `apps/web/.env`

## Commands (repo root)

```bash
pnpm run db:generate
pnpm run db:migrate
pnpm run db:push
pnpm run db:studio
pnpm run db:seed
```

## Customize

Document your tables, relationships, and indexing choices here. Link domain ADRs under `docs/decisions/` when schema choices need a **why**.
