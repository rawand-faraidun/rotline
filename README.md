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

3. Create the game-ticket keys once (they sign the connection from the website to the game server):

   ```sh
   pnpm --silent --filter @rotline/ticket keys >> .env
   ```

4. Run the API, the queue, the game server and the website:

   ```sh
   pnpm dev
   ```

   Open <http://localhost:4321>. Without GitHub or Google credentials in `.env`, sign in with the **Test account** button: the fake provider accepts any username.

   In a mission: WASD to move, the mouse to aim, click to fire, R to reload, 1 2 3 for weapons, Q to swap, Esc to leave.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development: API on port 3100, queue on 3300, game server on 3200 and the website on 4321 (the website proxies `/api`, `/api/queue` and `/game`), reloading on changes |
| `pnpm start` | The production builds on the same ports: applies migrations, builds what changed, then runs each app's `start` |
| `pnpm lint` | Biome checks |
| `pnpm typecheck` | Type checks every package |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration tests (needs PostgreSQL and the OAuth mock running, and `.env` loaded) |
| `pnpm --filter @rotline/web test:e2e` | Browser tests against a running site |
| `pnpm build` | Production builds |
| `pnpm db:migrate` | Applies database migrations (uses `DATABASE_DIRECT_URL`) |
| `pnpm changeset` | Describes a change for the next release (see below) |
| `pnpm --filter @rotline/game-server bench` | Server tick benchmark with full rooms |
| `pnpm --filter @rotline/bots bots` | Headless bot players against a running game, for network and load tests |

## Layout

```
apps/api        HTTP API: sign-in (Better Auth), player profile, squads, friends, game tickets
apps/queue      Seats and the queue for the player limit
apps/game-server  Authoritative game server (uWebSockets.js, 30 Hz)
apps/bots       Headless bot players for network and load tests
apps/web        Static pages (Astro) and the game's React app
packages/sim    Deterministic game simulation shared by server and browser
packages/protocol  Binary messages and snapshot encoding
packages/client  3D renderer, input, prediction and interpolation (three.js)
packages/game-data  Weapons, zombies, maps and waves as validated data
packages/ticket  Signed game connection tickets
packages/db     Prisma schema, migrations and client
packages/auth   Better Auth setup shared by the API and the queue
packages/state  Squads, seats, presence and the game-server registry in Valkey
packages/ui     Interface components in the Rotline style
packages/constants  Shared rules and constants
tooling/        Shared Biome and TypeScript presets
brand/          Logo, icons, colours and fonts
docs/           Project documentation
```

## Releases

Versions are managed with [Changesets](https://github.com/changesets/changesets). With a change that players or operators would notice, run `pnpm changeset`, choose patch, minor or major, and describe it in a line or two; commit the file it creates. All `@rotline/*` packages share one version: the game's version.

When CI passes on a push to `main`, the Version workflow applies the pending changesets in a "Version packages" commit on `main` (version bump and changelogs), tags `vX.Y.Z`, and publishes versioned images and a GitHub release. There is no version pull request; a push without changesets releases nothing.

## Documentation

- [Architecture](docs/architecture.md)
- [Netcode](docs/netcode.md)
- [Data model](docs/data-model.md)
- [Game design](docs/game-design.md)
- [Interface](docs/interface.md)

## Licence

Code: [MIT](LICENSE). Assets: see [ASSETS_LICENSES.md](ASSETS_LICENSES.md).
