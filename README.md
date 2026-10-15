# Rotline

Hold the line against the rot. A browser top-down co-op zombie shooter for one to four players.

## Run it locally

Requirements: Node.js 26 (`nvm use`), pnpm 11, Docker.

1. Start the dependencies from the setup templates (PostgreSQL with PgBouncer, Valkey, and the fake OAuth provider for local sign-in). Each template folder has a `docker-compose.yml`, a `.env.example` and a README:

   ```sh
   cd <templates>/postgres && cp .env.example .env   # set POSTGRES_PASSWORD
   docker compose up -d
   # same for <templates>/valkey and <templates>/oauth-mock
   ```

2. Configure and install:

   ```sh
   cp .env.example .env      # fill in the passwords and BETTER_AUTH_SECRET (openssl rand -base64 32)
   pnpm install
   pnpm db:migrate
   ```

3. Run the API and the website:

   ```sh
   pnpm dev
   ```

   Open <http://localhost:4321>. Without GitHub or Google credentials in `.env`, sign in with the **Test account** button: the fake provider accepts any username.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API on port 3100 and the website on port 4321 (the website proxies `/api`) |
| `pnpm lint` | Biome checks |
| `pnpm typecheck` | Type checks every package |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration tests (needs PostgreSQL and the OAuth mock running, and `.env` loaded) |
| `pnpm --filter @rotline/web test:e2e` | Browser tests against a running site |
| `pnpm build` | Production builds |
| `pnpm db:migrate` | Applies database migrations (uses `DATABASE_DIRECT_URL`) |

## Layout

```
apps/api        HTTP API: sign-in (Better Auth), player profile
apps/web        Static pages (Astro) and the game's React app
packages/db     Prisma schema, migrations and client
packages/ui     Interface components in the Rotline style
packages/constants  Shared rules and constants
tooling/        Shared Biome and TypeScript presets
brand/          Logo, icons, colours and fonts
docs/           Project documentation
```

## Documentation

- [Architecture](docs/architecture.md)
- [Netcode](docs/netcode.md)
- [Data model](docs/data-model.md)
- [Game design](docs/game-design.md)
- [Interface](docs/interface.md)

## Licence

Code: [MIT](LICENSE). Assets: see [ASSETS_LICENSES.md](ASSETS_LICENSES.md).
