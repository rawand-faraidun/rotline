# Build brief: Rotline, a browser top-down co-op zombie shooter

> **Game name:** Rotline
> **Slogan:** Hold the line against the rot.
> **Brand files:** in `/brand`. Read `/brand/README.md` before building any interface.
> **Hosting:** one Cloud VPS 6 (6 shared vCPUs, 12 GB RAM, 100 GB NVMe, 300 Mbit/s, unlimited traffic), set up entirely by Ansible, everything in Docker, player limit 32. Details in section 8.
> **Cloudflare:** used for the domain and DNS only, plus R2 for backup storage.
> **Where most players are:** `worldwide`

---

## 1. Your role and how we will work

You are the lead engineer and technical designer on this project. I am the owner. I know how I want the game to play, but I do not know how games like this are normally built: which engine, how the multiplayer works, which database, how it is hosted. I am relying on you to research that properly, recommend a setup, explain it to me in plain language, and then build it.

**Performance comes first.** I want Rotline to run as smoothly as possible for players and to use server resources efficiently. I suggested Node.js, Next.js and Tailwind CSS earlier. Those are suggestions, not requirements. If a different language, engine, framework or database performs better for any part of this game, choose it and show me the evidence. When choosing tools, rank by: (1) runtime performance and smoothness, (2) reliability, (3) how fast we can build and maintain it.

The work happens in two stages.

**Stage A: research and technical design. No production code.** You investigate how real-time multiplayer browser games are built today, choose the stack, and write the design documents listed in section 4.3. Then you stop and wait for my approval. Small throwaway experiments in a `/spikes` folder are expected when they settle a question with a measurement (for example, how many animated zombies a renderer can draw at 60 fps on a laptop). Nothing from `/spikes` becomes the product.

**Stage B: build in milestones.** Each milestone in section 13 ends with something I can run and play, plus a short report.

Rules for the whole project, with the reason for each:

- **Verify, don't recall.** Library versions, browser support and hosting prices change every few months. Check official documentation and release notes before recommending anything, and put the date and link next to each claim. If you could not verify something, say so.
- **Measure, don't guess.** Every performance claim that drives a decision is backed by a benchmark you ran, with the hardware and settings written down.
- **Tell me what is actually done.** At the end of each milestone, separate what you built and tested from what is stubbed, untested, or skipped. I would much rather hear "revive works in a 2-player test but I have not tested reconnecting while downed" than a clean-looking summary that hides it.
- **Ask before decisions that are expensive to undo.** Engine, rendering approach, netcode model, server language, database and hosting are in that category, which is why Stage A exists. For small decisions, pick the sensible option, write one line in `docs/decisions.md`, and keep going.
- **Keep balance numbers out of the code.** Weapons, zombies, skills, missions, prices and drop tables live in validated data files, so I can tune the game without touching logic. Every number in this brief is a starting value.
- **This is an original game.** SAS: Zombie Assault 4 and Call of Duty: Dead Ops Arcade are references for how it should look and feel. Do not copy their names, characters, maps, art, sounds, text or code. Use original assets or assets whose licence allows use in a web game, and record each one in `ASSETS_LICENSES.md`.
- **Secrets never appear in plain text in the repository.** Use environment variables, an encrypted Ansible Vault for server secrets, and commit a `.env.example`.
- **Nothing is done by hand on the server.** Every server change goes through the Ansible playbook, so the server can be rebuilt or replaced at any time (section 8.4).

---

## 2. The game in one paragraph

Rotline is a top-down shooter played in the browser, with a semi-realistic look in the spirit of SAS: Zombie Assault 4 and Call of Duty: Dead Ops Arcade. One to four players fight through objective-based missions against hordes of zombies that mutate as the campaign goes on. Between missions players sit in a lobby where they pick a class, spend skill points, upgrade weapons and gear, buy from a shop with currency earned in play, take on daily and weekly contracts, and invite friends. It should feel fast and readable in combat, and generous outside it: everything is earned by playing.

**Design pillars.** When two goals conflict, the earlier one wins.

1. Combat is smooth and responsive, even on an ordinary laptop and an ordinary home connection.
2. Co-op matters: classes, revives and bosses reward playing together, but solo play is always possible.
3. Progress is earned, never bought and never gambled.
4. The horde is the star: many enemies on screen, clearly different from each other, still running smoothly.

---

## 3. Fixed requirements

These are decided. Do not change them without asking me.

| Area | Requirement |
|---|---|
| Platform | Runs in a desktop browser with no install. Keyboard and mouse first, gamepad supported. |
| Players | Solo, or online co-op for up to 4 players. |
| Capacity | Launches on a single Cloud VPS 6 with a limit of 32 players online at once, and can grow to 500 or more by adding machines. When the limit is reached, new players wait on a queue page (section 8). |
| Infrastructure | The whole server is built by one Ansible playbook, everything runs in Docker, and the architecture is ready to scale from day one (section 8.4). |
| Backups | Point-in-time recovery for the last 7 days plus an independent daily backup, stored in Cloudflare R2 (section 8.5). |
| No uploads | Players cannot upload files of any kind. Avatars are generated (section 6). |
| Authority | The server decides everything that matters: damage, kills, drops, XP, currency, purchases, contract progress. The client only sends inputs and draws the result. Solo missions also run on the server, because they affect the persistent economy. |
| Sign-in | GitHub and Google OAuth only. No email-and-password accounts, no passwords stored, no guest accounts. |
| Money | No real-money transactions of any kind. One in-game currency, earned only by playing. |
| No luck in the economy | No loot boxes, gacha, spin wheels or random-roll purchases. The shop shows exactly what you get at a fixed price. Random drops during missions are fine because they are gameplay, not purchases. |
| No rarity | There are no common, rare or epic versions of an item. Each weapon and gear piece exists in one form, and it gets better only through upgrades. |
| Look | Semi-realistic top-down, in the spirit of SAS 4 and Dead Ops Arcade (section 7). |
| Brand | Use the logo, colours and fonts in `/brand` exactly as its README describes. |

---

## 4. Stage A: research and technical design

### 4.1 What to research

For each topic below, compare at least two realistic options, cite your sources with dates, recommend one, state the trade-off, and say what would make you change your mind. Write for someone who is new to game infrastructure.

1. **Rendering approach and engine.** This is the biggest decision for both looks and performance. Compare at least these two approaches with a spike for each:
   - **2D with pre-rendered sprites**, the way SAS 4 looks: 3D models rendered into sprite sheets from several directions, with normal maps so 2D lights and shadows still react. Candidate renderers include Phaser and PixiJS.
   - **Real 3D with a fixed overhead camera**, the way Dead Ops Arcade looks. Candidate engines include Three.js, Babylon.js and PlayCanvas. Hundreds of animated zombies will need GPU instancing and baked animation (for example vertex animation textures) rather than ordinary skinned meshes.

   Also consider an export from a full engine such as Godot. Each spike draws one lit map with 300 animated zombies, muzzle flashes and blood decals. Measure frame rate on a mid-range laptop with integrated graphics, download size, memory, and how much work it takes to produce art in that pipeline. Check WebGL2 and WebGPU support. The game simulation must be able to run on the server without the renderer.
2. **Multiplayer model.** Explain authoritative server simulation, client-side prediction with reconciliation, interpolation of other entities, and lag compensation for shots. Recommend a simulation tick rate and a snapshot rate. Most importantly, explain how you will synchronise hundreds of zombies to four clients cheaply: interest management, delta compression, quantisation, lower update rates for distant enemies, binary encoding.
3. **Transport.** WebSocket, WebTransport and WebRTC data channels: current browser support, behaviour under packet loss, and the fallback plan.
4. **Game server language and framework.** Choose by measured performance. Benchmark a full 4-player room with 300 zombies, pathfinding and collisions in at least two candidates, for example TypeScript on Node.js or Bun (possibly with a room framework such as Colyseus), Go, and Rust. Report the time per tick and the memory per room. One requirement constrains this choice: client-side prediction has to run the same movement and weapon logic as the server. Explain how each option shares that code. Examples are TypeScript on both sides, or a Rust core compiled to native code for the server and to WebAssembly for the browser.
5. **Database and storage.** A relational database (PostgreSQL is the default assumption) against the alternatives, the query layer, and connection pooling. Also decide what an in-memory store such as Redis or Valkey handles: presence, the queue, matchmaking, the room registry, rate limits, messaging between server instances. Cover migrations. Use PostgreSQL 18 unless you find a strong reason not to, because the backup design in section 8.5 needs version 17 or newer.
6. **Authentication.** How to do GitHub and Google OAuth cleanly with the chosen web stack. Compare the current libraries (Better Auth and Auth.js are the usual pair for Next.js; check their current status and which is recommended for new projects). Design the handshake that lets a signed-in web user open an authenticated connection to the game server, for example a short-lived signed ticket. Cover safe account linking when the same person signs in with both providers; do not link automatically on an unverified email.
7. **Web application.** Choose the framework for the website and the menus (lobby, armory, shop, friends). Next.js with Tailwind CSS is my suggestion; replace it if something performs better. Decide which pages are static, which are server-rendered, how the game is loaded separately so the landing page stays light, and how the interface and the game engine exchange state for the HUD.
8. **Hosting, deployment and operations.** The launch host is decided: one Cloud VPS 6, set up by Ansible, running everything in Docker (sections 8.2 and 8.4). Design the container layout, resource limits and deployment for it, and choose between Docker Compose run by Ansible and Kamal. Choose a data-centre region close to where most players are (see the header), and measure real ping from there. Cover how a player is routed to the server holding their room, and how to deploy without killing live matches. Cloudflare is used only for the domain. Tell me whether turning on Cloudflare's proxy for the website would help (caching, DDoS protection, hiding the server's address), and measure whether game connections are better through it or direct. I will decide. Also research the monitoring service (section 8.6) and verify the Databasus questions in section 8.5.
9. **Capacity, queue and cost.** Check the starting hardware in section 8 against your benchmarks and correct it. Design the queue in section 8. The launch server is fixed (section 8.2). Give the monthly cost of the setup you would grow into at 100 and at 500 concurrent players, with the assumptions shown.
10. **Performance techniques.** For the client: texture atlases or instancing, batching, object pooling, culling, compressed textures (for example KTX2 or Basis), audio sprites, lazy loading, quality presets and dynamic resolution. For the server: spatial partitioning for collisions, flow-field or similar shared pathfinding so hundreds of zombies do not each run their own search, and lower update rates for far-away enemies.
11. **Art production.** A semi-realistic look needs real models, animations, textures and sound. Research where these can come from: licensed asset marketplaces, animation libraries, commissioned work, generated or photogrammetry sources. Check every licence carefully. A web game sends its assets to the player's browser, and some licences forbid exactly that. Tell me what budget, if any, the art plan needs.
12. **Anti-cheat and abuse.** Input validation, rate limiting, an append-only ledger for every currency change, idempotent reward grants, and what you will deliberately not try to solve in version 1.
13. **Testing and observability.** Unit tests for the simulation and economy, headless bot clients for load testing, end-to-end tests for sign-in, queue and lobby flows, error tracking, and server metrics such as tick duration, room count, connected players and queue length.
14. **Privacy basics.** What we store from OAuth (keep it minimal), a privacy page, and account deletion.

### 4.2 Starting sketch, to confirm or replace

This is only a sketch. Replace any part your research shows can be done better.

```
repo/
  apps/web/            Website and menus: landing, sign-in, queue page, lobby, armory, shop, friends, admin
  apps/game-server/    Authoritative room server, fixed-tick simulation
  packages/sim/        Engine-free game simulation, shared with the client for prediction
  packages/game-data/  Weapons, zombies, skills, missions, contracts, achievements as validated data
  packages/protocol/   Message schemas and binary encoding shared by both sides
  packages/db/         Schema, migrations, queries
  infra/ansible/       Playbook, roles, inventories (production, staging), encrypted vault
  .github/workflows/   GitHub Actions: checks, tests, security, build, deploy
  .claude/agents/      Helper agents (or your tool's equivalent); copies in docs/agents/
  biome.json           Lint and format rules for JS, TS, JSON and CSS
  brand/               The Rotline brand pack (provided)
  spikes/              Throwaway experiments from Stage A
  docs/                Everything in 4.3
```

### 4.3 What to deliver at the end of Stage A

Put these in `docs/`:

- `00-research.md`: findings for every topic in 4.1, with sources and benchmark results.
- `01-tech-stack.md`: one table of every chosen technology, its version, what it is for, and the alternative you rejected.
- `02-architecture.md`: system diagram, request and data flows, deployment layout. Use Mermaid diagrams.
- `03-netcode.md`: tick and snapshot rates, message types, prediction and reconciliation, reconnect behaviour, bandwidth budget.
- `04-data-model.md`: entity-relationship diagram and table definitions.
- `05-game-design.md`: section 5 of this brief expanded into a full design with concrete numbers.
- `06-performance-budget.md`: targets from section 10 and how each will be measured.
- `07-art-direction.md`: the chosen rendering approach, spike results with screenshots, the asset pipeline and the asset sources.
- `08-capacity-and-queue.md`: the hardware plan, the load-test plan, the queue design and the monthly cost.
- `09-milestones.md`: section 13 refined, with estimates and risks.
- `10-open-questions.md`: anything you need me to decide.
- `11-infrastructure-and-operations.md`: the Ansible design, the deploy tool choice, CI, backups and point-in-time recovery (including the answers to the Databasus questions), monitoring and alerts, security, and the outline of the runbooks.
- `12-engineering-workflow.md`: the GitHub Actions pipeline, the Biome setup, test strategy and coverage targets, and the helper agents you will create.

Then give me a one-page summary and stop. Do not begin Stage B until I approve.

---

## 5. Game design

### 5.1 Core loop

Lobby, then choose class and loadout, then pick a mission, then fight and complete objectives, then a results screen showing XP, currency and any items found, then back to the lobby to upgrade and go again.

### 5.2 Modes

- **Campaign.** Objective-based missions grouped into zones, playable solo or with up to 4 players. Each zone ends with a boss. Missions have checkpoints.
- **Special events.** Time-limited missions with unusual rules or modifiers, switched on from the admin panel. Rewards are earned by playing; nothing is sold.
- **Survival.** Endless rounds on a single map with rising difficulty, built around the score multiplier, with a leaderboard. This comes after the campaign works.

### 5.3 Classes

There are three classes: **Assault** (damage and mobility), **Medic** (healing, revives, team support) and **Heavy** (toughness, crowd control, area damage).

- A player has one profile, not character slots. The class is a switch they flip while in the lobby. It cannot be changed during a mission.
- **Per class:** level, XP, skill points and the skill tree. Levelling the Medic does nothing for the Assault.
- **Shared across classes:** currency, the whole inventory of weapons and gear, their upgrade levels, and what is currently equipped. Switching class changes abilities and stats only; the equipped weapons and gear stay as they were.
- Any class can use any weapon. Class identity comes from skills.

### 5.4 Skill trees

Playing a class earns XP for that class. Each level grants skill points to spend in that class's tree.

- **Active abilities** are equipped in a small number of slots and have cooldowns. Examples: Medic drops a medkit or a healing field; Heavy calls in an aerial bombardment or deploys a barricade; Assault triggers an adrenaline burst or throws a cluster grenade.
- **Passive nodes** give permanent bonuses: maximum health, critical damage, reload speed, revive speed, movement speed, ability cooldown.
- Starting shape, to be refined: three branches per class, roughly 20 to 25 nodes each, with later nodes requiring earlier ones. Offer a respec for in-game currency so players can experiment.
- Design each tree so that the three classes cover each other's weaknesses in a 4-player squad, and so that every class can still finish missions solo.

### 5.5 Weapons, ammunition and gear

- No rarity tiers. Each weapon is a single design with its own behaviour: SMG, assault rifle, shotgun, LMG, sniper rifle, flamethrower, launcher, pistols and so on.
- **Loadout: two main weapons and a pistol.** The player carries two main weapons and one pistol, chosen in the lobby. That is what they start the mission with. Gear goes in separate slots; propose the gear slot layout (a reasonable start is armour plus one or two utility slots for grenades or similar).
- **Ammunition for main weapons.** Each main weapon has a magazine size and a maximum amount of reserve ammunition the player can carry for it. Reserve ammunition runs out and is refilled by ammo pickups and the max ammo buff.
- **The pistol never runs out.** It has unlimited reserve ammunition. Its only limits are magazine size and reload time.
- **Upgrades** cost in-game currency and raise an item's stats level by level. Upgradeable stats include damage, fire rate, reload speed, magazine size, accuracy and, for main weapons, **maximum carried ammunition**. Pistols have no carried-ammunition stat to upgrade. The max ammo buff fills a weapon to its upgraded maximum. Consider letting the player choose between two perks at certain upgrade levels, which adds depth without adding rarity.
- **Damage types** (for example ballistic, explosive, fire, shock, chemical) exist so that zombie resistances and mutations mean something.
- **Item drops in missions.** A mission yields only a few weapon or gear drops, around two or three, from sources such as elite enemies, objectives or hidden caches. Drops are per player, so nobody competes for them. They are saved to the player's account inventory for use in later missions, not in the mission where they drop.
- **Found items always arrive at base level with no upgrades.** If the player does not own that item yet, it is a new unlock. If they already own it, upgraded or not, the found copy is a duplicate whose only use is to be discarded. Discarding gives a small fixed amount of currency.
- Players can discard items they own. Guard against accidentally discarding an upgraded or equipped item.
- New accounts begin with a starter kit: two basic main weapons, a pistol and basic armour.

### 5.6 Economy and shop

- One currency, earned from kills, objectives, mission completion, score, contracts and discarded duplicates.
- The shop sells specific weapons, gear, consumables and upgrades at fixed, visible prices.
- Every currency change is written to an append-only ledger on the server, inside the same transaction as the thing it paid for or rewarded.
- Build a simple economy simulation or spreadsheet so we can see how many hours of play each purchase costs.

### 5.7 Missions and environments

Missions are built from reusable objective types rather than "survive N waves". Build an objective framework so new types are data plus a small amount of logic. Required types:

- **Rescue.** Find VIPs and escort them to extraction while keeping them alive.
- **Restore power.** Activate generators or grid nodes, often in sequence, each one triggering an attack while it starts up.
- **Defend.** Hold barricades for a set time; barricades take damage and can be repaired.
- **Retrieve.** Collect biological samples and carry them out; the carrier is slowed or cannot sprint.

Suggested additions: destroy nests, hold a terminal while it uploads, escort a slow vehicle, timed extraction, and boss hunts. Missions combine a primary objective with optional secondary ones that pay extra.

**Interactive environments.** Maps include things players can use: explosive barrels, doors that can be sealed or welded shut and broken down by zombies, turrets and lights that need power, traps, and destructible cover.

### 5.8 Zombies

The game needs **at least 17 clearly distinct zombie types**. Distinct means a different silhouette, behaviour and correct player response, not a recolour. The list below describes roles; give them original names.

| # | Role | What makes it different |
|---|---|---|
| 1 | Shambler | Slow, numerous, the baseline |
| 2 | Runner | Fast and fragile, punishes standing still |
| 3 | Crawler | Low and hard to spot, comes out of vents and gaps |
| 4 | Bloater | Explodes on death and leaves a damaging pool |
| 5 | Spitter | Ranged attacker that forces movement |
| 6 | Brute | Large, charges in a straight line, stuns |
| 7 | Screamer | Calls reinforcements and speeds up nearby zombies; a priority target |
| 8 | Stalker | Nearly invisible until close |
| 9 | Leaper | Jumps barricades and gaps |
| 10 | Shieldbearer | Armoured from the front, must be flanked |
| 11 | Burrower | Travels underground and surfaces beneath players |
| 12 | Carrier | Releases a swarm of small parasites when killed |
| 13 | Igniter | On fire, leaves burning trails, immune to fire |
| 14 | Shocker | Electrical pulse that briefly disables abilities and turrets |
| 15 | Broodmother | Continuously spawns small enemies until killed |
| 16 | Reanimator | Raises dead zombies unless it is killed first |
| 17 | Grabber | Pins a player, who must be freed by a teammate or by breaking out |
| 18 | Juggernaut | Elite with heavy armour and weak points |

**Mutation system.** As the campaign progresses, zombies evolve.

- Each type has mutation stages that unlock with campaign progress and difficulty, adding abilities, resistances and attack patterns.
- **Adaptive mutations:** the server tracks what the squad relies on, such as one damage type, turret camping or constant kiting, and shifts later spawns toward strains that answer it, for example fire-resistant strains against a fire-heavy squad.
- Keep it fair. Mutations are visible on the zombie and announced in the HUD, resistances are capped and never make a strategy useless, and there is always a counter available.
- A spawn director controls pacing so that pressure rises and falls instead of staying flat.

**Bosses.** Each zone ends with a large mutated boss. A boss fight has several phases, weak points, attacks that are telegraphed and must be dodged by positioning, and at least one mechanic that rewards coordinated fire, such as armour that breaks only under focused damage or from two sides at once. Boss health and mechanics scale with player count and remain beatable solo.

### 5.9 Temporary buffs

Zombies and caches sometimes drop short-lived pickups. Required: **screen nuke** (kills or heavily damages everything on screen, once), **max ammo**, **double XP** for a limited time, and a **minigun** for a limited time. Suggested additions: instant-kill damage, a speed boost, a shield bubble, a freeze pulse, and a temporary sentry turret. Team-wide buffs apply to the whole squad no matter who picks them up. The server rolls and owns every drop.

### 5.10 Score multiplier

- Kills in quick succession build a chain, and the chain raises a score multiplier in steps. The chain lapses after a short gap without a kill and resets when the player goes down.
- A higher multiplier means more score. Score converts into bonus class XP at the end of the mission, and reaching score thresholds awards **extra lives**.
- Show the multiplier and the chain timer prominently in the HUD; it is the main source of moment-to-moment excitement.

### 5.11 Downed, revive and respawn

- At zero health a player is **downed**, not dead. A bleed-out timer starts, and a teammate can revive them by holding an interact key next to them. Medics revive faster.
- If the timer runs out the player is **dead** and spectates teammates. They return at the next mission checkpoint, or at the end of the current round in Survival.
- An **extra life** lets a dead player redeploy near the squad after a short delay instead of waiting.
- In solo play there is nobody to revive you, so going down spends a life to get back up. Solo players start with more lives.
- If the entire squad is down or dead at once with no lives left, the mission restarts from the last checkpoint. In Survival the run ends.

### 5.12 Contracts and bounties

- **Daily and weekly contracts** rotate on a server clock and pay in-game currency. Examples: kill 200 zombies with shotguns, finish a mission without anyone bleeding out, revive five teammates.
- **Bounties** are specific hunts, such as a named elite that appears in one mission at a given difficulty.
- Progress is counted on the server from real match events. Show a countdown to the next rotation. Do not add streak penalties or anything else that punishes a player for missing a day.

### 5.13 Lobby and matchmaking

- Private lobbies joined by invite link, short code or directly from the friends list, and public quick match by mission and difficulty.
- The lobby shows each player's class, level and loadout, with a ready check. Players can change class, skills and loadout here.
- A player who disconnects mid-mission has a grace period to rejoin the same room and continue.
- Difficulty tiers raise enemy health, numbers and mutation stage, and raise rewards to match. Enemy numbers scale with squad size.
- Communication in version 1 is a ping system and quick-chat phrases. Free text chat needs a profanity filter, mute, block and report, so treat it as optional.

### 5.14 Friends list (required)

- Add friends by unique player name or invite link. Players accept or decline requests, and can remove and block.
- Show online status and what each friend is doing: in the lobby, in a mission (which one), in the queue, offline.
- Invite a friend to your lobby, or join a friend's lobby when it has a free slot.
- Keep a recent-players list from past squads, so players can add people they enjoyed playing with.
- Presence updates must be cheap: push changes rather than having every client poll.

### 5.15 Firing range

A practice area reached from the lobby. Players try weapons, upgrades and abilities on dummy targets, and spawn any zombie type they have already met to practise against. Nothing earned there counts toward progression.

### 5.16 Bestiary

Each zombie type gets an entry the first time a player kills one. Entries show the model, behaviour, weaknesses and resistances, and every mutation the player has seen, plus their kill count for that type.

### 5.17 Achievements and cosmetics

Achievements for milestones and feats, rewarding cosmetics earned only by play: titles, profile banners, weapon skins, armour colours. Cosmetics never change stats and are never sold.

### 5.18 Mission mastery

Each mission has a mastery rating (for example bronze, silver and gold) based on completion time, score and how many times the squad went down, shown on the mission select screen.

### 5.19 Mission modifiers

Optional modifiers players switch on before a mission for higher rewards, for example friendly fire, tougher mutations, scarce ammunition, darkness, or no extra lives. Show the reward bonus clearly.

---

## 6. Website and interface

Pages: landing page (what the game is, a play button, sign-in), queue page, lobby hub, class and skill tree, armory (inventory, upgrades, discard), shop, contracts, friends, mission select with campaign map, firing range, bestiary, achievements and cosmetics, results screen, profile and statistics, leaderboards, settings, privacy and terms, and an admin panel.

**Admin panel** (owner only): see players online and the queue, change the player capacity, see server health and the last successful backup, rotate contracts, turn special events on and off, edit balance data with validation and a change history, and look up a player's ledger.

**Avatars, with no uploads.** Players cannot upload files anywhere in the game or on the site. Avatars are generated with DiceBear (or a similar generator, if you find a better fit):
- Use the DiceBear JavaScript library inside our own app, so we don't depend on an outside avatar service while running.
- Store only the style, seed and options for each player, never an image file.
- Players pick a style and customise or reroll their avatar for free in their profile. Extra styles or options can be unlocked as cosmetic rewards.
- The same avatar appears everywhere: profile, friends list, lobby cards, the queue page and in-game nameplates. Rendered avatars are cached.
- DiceBear's library is MIT-licensed, but each avatar style has its own licence. Prefer CC0 styles. If you use a CC BY style, add the required credit and record it in `ASSETS_LICENSES.md`.

Player names are the only text players choose, so check them against a profanity and impersonation filter.

**In-game HUD:** health and armour, ammunition (magazine and reserve, with the pistol shown as unlimited), ability cooldowns, the score multiplier and chain timer, objective tracker, teammate status including downed timers, active buff timers, mutation alerts, a minimap or objective arrows, and the ping wheel.

**Settings** must include graphics quality presets, key rebinding, gamepad support, audio sliders, interface scale, a screen-shake toggle, a gore toggle, a reduced-flash option for effects like the nuke, and colour choices that do not rely on telling red from green. Keep all interface text in translation files from the start.

The landing page must load fast and be indexable. The game bundle and assets load only after the player chooses to play.

---

## 7. Art direction

The target is a semi-realistic top-down look in the spirit of SAS: Zombie Assault 4 and Call of Duty: Dead Ops Arcade. Match the feel, not their actual art.

- **Camera:** high overhead view, close to straight down, pulled back far enough to see the horde coming. It may zoom slightly with the action.
- **Characters and zombies:** realistic proportions, materials and animation, with gritty textures. Every zombie type must be recognisable from above at a glance by silhouette, size, colour accents or glow. When realism and readability conflict, readability wins.
- **Lighting:** dynamic lights and shadows, including muzzle flash light, flashlights in dark missions, glowing pickups and hazards, and fire.
- **Effects:** tracers, shell casings, explosions, smoke, acid, sparks, blood splatter and decals that persist (with a cap), and dismemberment from explosives. All gore respects the gore toggle.
- **Game feel:** screen shake, brief hit-stop on heavy hits, impact flashes and punchy audio. Each weapon must sound and feel distinct.
- **Environments:** ruined city streets, laboratories, a military base, sewers, a power station and similar, built from reusable tiles and props.
- **Interface:** dark, military and hazard-themed, using the Rotline colours and fonts from `/brand`.
- **Quality presets:** low, medium and high, so the look scales down on weak machines without breaking readability.

Start with simple placeholder shapes until the game plays well, but make the rendering choice in Stage A with real test assets, because it decides the whole art pipeline.

---

## 8. Server, infrastructure, backups and the queue

### 8.1 Target

At launch, Rotline runs on **one VPS** with a limit of **32 concurrent players**. "Concurrent player" means a signed-in player connected to the game: in the lobby, in the firing range or in a mission. Browsing the landing page does not count.

The limit is deliberately lower than the server could probably handle. The website, the database and backups all share this machine, and none of them should ever cause lag in a match.

The architecture must be able to grow to 500 players and beyond by adding machines, without a rewrite. Moving the database or the game servers to their own machine later should only mean changing configuration (section 8.4).

### 8.2 The launch server: Cloud VPS 6

The server is already chosen: **Cloud VPS 6, with 6 shared vCPUs, 12 GB RAM, 100 GB NVMe (use the NVMe option, not the 200 GB SSD), a 300 Mbit/s port and unlimited traffic.** Everything runs on it in Docker containers: the website and API, the game servers, PostgreSQL 18, Redis or Valkey, nginx and Databasus. Cloudflare is used only for the domain and DNS, plus R2 as backup storage (section 8.5). No other Cloudflare products are used.

The split below is my estimate and must be checked against your benchmarks. It assumes about 2.5 players per room on average (roughly 13 rooms at 32 players), with the worst case of every player solo (32 smaller rooms). It also assumes a full 4-player room with 300 zombies takes no more than about 2 ms of CPU per tick, ticking 30 times a second.

| Service | vCPU | RAM | Notes |
|---|---|---|---|
| Game server processes | 3, pinned | 3–4 GB | One process per vCPU. These get priority over everything else. |
| PostgreSQL 18 with a connection pooler | 1 | 2–3 GB | Writes happen at checkpoints and mission end, so load is low |
| Website and API, Redis or Valkey, nginx, Databasus | 2 | about 3 GB | Serve static files and game assets with long cache headers and compression |
| System and spare | — | 2–3 GB | |

Network: about 15–25 KB/s down and 2–5 KB/s up per player, so under 10 Mbps at peak for 32 players.

**Shared vCPUs are the main risk.** Other customers on the same host can briefly take CPU time ("steal"), which shows up in a game as lag spikes. Track CPU steal time as a monitored metric and alert on it. Make the game server tolerate small hiccups without visible stutter, for example with a small interpolation buffer on clients and catching up on missed ticks rather than slowing the game clock. If steal regularly exceeds a few percent during play, tell me. The fix is moving the game server to dedicated cores.

Rules for running everything on one machine:

- **Protect the game servers.** Set CPU and memory limits on every container so a database query, a backup or a traffic spike on the website can never slow down game ticks. Pin the game server processes to their own vCPUs. Schedule full backups for the quietest hours.
- **Never build on the production server.** Images are built in hosted CI. The server only pulls and runs them.
- **Deploy without dropping matches.** New game-server processes take new rooms while old ones finish their current missions, then exit.
- **Snapshots are not backups.** The provider's snapshots are kept with the same provider; use them for quick rollbacks only.
- **Watch for the point to split.** Alert when the machine regularly passes about 60% CPU, tick times approach budget, steal time rises, or the queue is often full. The first step is moving PostgreSQL and Redis to a second VPS, leaving the Cloud VPS 6 for the game and website.

Before launch, prove it with a load test of **40 bot players** (32 plus about 20% headroom), playing real missions on the production VPS. Run it more than once at different times of day, because shared vCPUs behave differently when neighbours are busy. Measure tick time, CPU steal, memory, bandwidth and database load, plus how smooth the game feels to a real player who joins during the test. If the results leave room, recommend how far the limit can safely be raised.

### 8.3 The queue

When the number of concurrent players reaches the capacity, new players see a queue page instead of entering the lobby.

- The capacity is a setting in the admin panel, starting at 32. It should also lower itself automatically if server health degrades, for example when tick times exceed budget or CPU steal spikes.
- Admission is first come, first served. The queue page shows the player's position and an estimated wait, updated live through a lightweight push channel or infrequent polling.
- When a seat frees up, the next player gets a short-lived admission pass (for example 90 seconds) to enter. If they don't use it, the seat goes to the next person.
- A party queues together and is admitted when there are enough seats for all of its members.
- Players already connected keep their seat. A player who disconnects mid-mission keeps their seat during the reconnect grace period.
- Players idle in the lobby for a long time get a warning and then lose their seat, so idle players do not block the queue.
- The queue page must survive a rush of visitors: a small static page served and cached by nginx, backed by a very small queue service, with strict rate limits. It must keep working even if the game servers are struggling.
- While waiting, the queue page shows tips, bestiary entries and which friends are online.

### 8.4 Infrastructure as code

**Goal: a blank VPS becomes a fully running Rotline server with one command, and moving to a new server needs almost no manual work.** The only manual steps allowed are: buying the VPS, adding the SSH public key in the provider's panel, entering the Ansible Vault password, and changing the DNS record in Cloudflare. If any other manual step turns out to be necessary, list it in the runbook and work to remove it.

- **Ansible.** One playbook (`infra/ansible/site.yml`) built from roles: base system (updates, time sync, swap, log rotation), security (section 8.7), Docker, nginx with automatic TLS certificates and renewal, the application stack, PostgreSQL, Redis or Valkey, Databasus with its backup jobs fully configured, and the monitoring agent. Running it twice must change nothing the second time. Test the playbook in CI against a fresh virtual machine or container.
- **Docker for everything.** Choose between Docker Compose run by Ansible and Kamal, and explain the choice in Stage A. Whichever you choose must give: zero-downtime website deploys, draining for game servers, and one-command rollback to the previous version.
- **CI and versioned images.** Tests, builds and deploys run on GitHub Actions (section 12). Every image is tagged with the git commit it was built from and pushed to a container registry. The server runs pinned versions; rolling back means deploying the previous tag. Database migrations run as their own deploy step and are written to be backward compatible (add first, remove later), so a rollback never breaks the database.
- **Staging, ready but not running.** The Ansible inventory defines a `staging` environment alongside `production`, with its own secrets, its own backup location and smaller resource limits. Nothing is provisioned for it now, to save cost. Turning it on later must only mean buying a VPS, adding its address to the inventory and running the playbook. Document those steps.
- **Secrets.** Server secrets live in an encrypted Ansible Vault in the repository. The vault password exists only in my Bitwarden and in the CI secret store. Never print secrets in logs or CI output.
- **Recovery kit.** Write `docs/ops/recovery-kit.md`, listing every secret needed to rebuild everything from nothing and where each one is stored: the Ansible Vault password, the Databasus encryption key and admin login, the R2 credentials, the OAuth client secrets, the GitHub account and its Actions secrets, the registry token, the SSH keys and the Cloudflare login. List names and locations only, never values. I keep the values in Bitwarden.
- **Built for scaling from day one (required).**
  - All configuration comes from environment variables.
  - The website and API are stateless.
  - Game servers register their rooms in Redis, and players are routed through that registry.
  - The database is reached through a pooler, using a connection string from configuration.
  - The only data on the server's disk is the database and Redis volumes. There are no user uploads (section 6).

  Write `docs/ops/scaling.md` with exact steps for three changes: moving PostgreSQL and Redis to a second VPS, adding a second game server, and adding a second web instance.

### 8.5 Backups and point-in-time recovery

Player data must survive a crash or a server move. This section is required.

- **PostgreSQL 18.** Databasus needs PostgreSQL 17 or newer for physical backups and WAL streaming.
- **Databasus** runs in Docker, installed and configured by Ansible, and stores backups in Cloudflare R2. Its backup jobs, schedules and retention are recreated by the playbook on a new server, not set up by hand.
- **Schedule 1, point-in-time recovery.** Physical full and incremental backups with continuous WAL streaming. The goal is to restore to any moment in the last 7 days and to lose at most a few seconds of committed data in a crash.
- **Schedule 2, independent daily backup.** A daily logical dump (pg_dump) stored separately from schedule 1, in its own bucket or folder. It restores into any PostgreSQL version and protects us if the physical backup chain ever breaks. Check whether Databasus can run two backup configurations on the same database. If it can't, use the cleanest alternative, such as a small separate container that runs pg_dump on a schedule, and tell me what you chose.
- **Retention is handled by Databasus, not by R2.** Keep backups for 7 days. The newest full backup and the WAL it needs are never deleted, even if backups have stopped. Do not add an R2 lifecycle rule that could delete the newest backup. If you add one as a safety net, set it to at least 30 days.
- **Encryption key.** Find out how Databasus creates and stores its encryption key, and whether a backup can be restored on a fresh Databasus install with only that key. Design the setup so the same key exists in my Bitwarden, in Ansible Vault and on the server. If Databasus accepts a key you supply, I will generate it in Bitwarden and you read it from the vault. If Databasus generates its own, the playbook must extract it once so I can save it, and must put it back when building a new server.
- **Storage credentials.** The R2 token can reach only the backup buckets.
- **Restore verification.** Turn on Databasus's automatic restore verification and alert me when it fails.
- **Restore drills.** Before launch, do a full drill. Build a fresh server with Ansible, restore to a chosen minute using only the secrets in Bitwarden and the backups in R2, check the data, and record how long each step took in the runbook. Repeat the drill every three months.
- **Accepted loss.** The game saves progress at checkpoints and at mission end. Losing the progress of a mission in progress during a crash is acceptable. Losing anything already saved is not.

### 8.6 Monitoring and email alerts

Research and choose a hosted monitoring service, plus an outside uptime check, that works with this setup, has a free or low-cost tier and can **email me** when something goes wrong. Keep the agents on the server light. Add error tracking for both the game client and the servers.

Email me when any of these happen:

- The website or game is down.
- A backup fails, WAL streaming falls behind, or a restore verification fails.
- Disk use passes 80%, or memory runs low.
- CPU steal is high, or game ticks go over budget.
- A TLS certificate is close to expiring.
- A container keeps restarting.
- The queue is full most of the day, which means it is time to scale.

The admin panel shows the same health summary, including the time of the last successful backup.

### 8.7 Server security and my SSH kit

- SSH by key only. No password login and no root login. Deployment uses a separate user with only the rights it needs.
- A firewall allows only web traffic, the game's port if it is separate, and SSH. Add brute-force protection on SSH.
- Automatic security updates for the operating system.
- PostgreSQL, Redis and Databasus are never reachable from the internet. Reach the Databasus dashboard through an SSH tunnel.
- Containers run as non-root users with only the permissions they need.

**SSH kit for me.** Produce `docs/ops/ssh/` and a downloadable zip containing:

- A plain-language guide to connecting from Windows, macOS and Linux.
- A script I run on my own computer to create my SSH key pair, so the private key never leaves my machine. The zip never contains private keys.
- An SSH config snippet with a short host alias.
- How to store the key in Bitwarden.
- How to open the Databasus dashboard through a tunnel.
- How to rotate keys.
- How to get back in through the VPS provider's web console if I lose my key.

### 8.8 Runbooks

Write and rehearse these before launch:

- `docs/ops/runbook-migration.md`: moving to a new server. The steps are: provision with Ansible, restore to the latest point from R2, verify, switch the old server to maintenance, sync the final changes, switch the Cloudflare DNS record, verify, then shut down the old server. The target is less than an hour of downtime, and the runbook records the real times from the rehearsal.
- `docs/ops/runbook-disaster-recovery.md`: the server is gone. Rebuild from nothing using only Bitwarden, the repository and R2.
- `docs/ops/runbook-deploy-and-rollback.md`: everyday deploys and how to roll back a bad one.

---

## 9. Out of scope for now

Do not build these until I ask: bots that fill squad slots, touch controls for tablets and phones, player-versus-player modes, voice chat, native mobile apps, user-made maps, and anything involving real money.

---

## 10. Quality targets

Confirm or adjust these in `06-performance-budget.md`, and explain how each will be measured.

- 60 frames per second on a mid-range laptop with integrated graphics at the medium preset, with at least 150 zombies on screen, and no collapse at 300.
- Smooth frame pacing: few frames take more than twice the target frame time, measured over a full mission.
- The game stays playable at 150 ms of latency with 2% packet loss. Your own movement and shooting feel immediate.
- The server finishes each simulation tick well inside its time budget with a full 4-player room at maximum enemy count, and with 32 players online on the launch VPS.
- A stated bandwidth budget per player.
- A stated limit for landing-page weight and for the time from clicking play to being in the lobby.

---

## 11. Brand

The `/brand` folder contains the logo in every variant as SVG and PNG, favicons, app icons, a social preview image, colour tokens (`tokens.json`, `tokens.css`) and a README with usage rules and an HTML head snippet. Use these files as they are. Do not redraw the logo, and do not recolour it beyond the variants provided. Self-host the two fonts named in the README.

---

## 12. Engineering workflow: tests, CI and helper agents

### 12.1 GitHub Actions: tests before every build

The code lives on GitHub, and CI and deployment run on GitHub Actions. The pipeline runs on every pull request and every push to `main`. Each stage runs only if the stages before it passed:

1. **Lint and format check.**
   - Biome for JavaScript, TypeScript, JSON and CSS.
   - The standard tools for anything else: for example rustfmt and Clippy for Rust, gofmt and golangci-lint for Go.
   - ansible-lint and yamllint for the playbook, hadolint for Dockerfiles, ShellCheck for scripts.
2. **Type check.**
3. **Unit tests**, especially for the simulation, the economy and ledger, data-file validation and the queue.
4. **Integration tests** against real PostgreSQL 18 and Redis or Valkey running as service containers. Cover migrations, ledger transactions, the queue and the room lifecycle.
5. **Security checks.**
   - A dependency vulnerability audit.
   - Secret scanning.
   - Static code analysis, for example CodeQL.
   - Checks on the Ansible and Docker configuration.
6. **Build the Docker images.** This happens only after every check above has passed.
7. **Check the built images.**
   - Scan them for vulnerabilities.
   - Start them together and run smoke and end-to-end tests (for example Playwright) covering sign-in, the queue, the lobby and joining a match.
8. **Push** the images, tagged with the commit, to a registry such as GitHub Container Registry.
9. **Deploy** to production. This happens only from `main` and only after everything has passed, with a manual approval step using GitHub environment protection.

Rules for the pipeline:

- Protect `main`: changes arrive through pull requests, all checks must pass, and nobody pushes directly.
- Keep pull-request checks fast, aiming for under 10 minutes, using caching and parallel jobs where steps don't depend on each other.
- Report test coverage. The simulation, economy, ledger and queue code must keep high coverage; propose the thresholds.
- Ansible changes also run the playbook against a fresh test machine or container in CI (for example with Molecule).
- Automate dependency updates with Dependabot or Renovate, grouped weekly. They go through the same pipeline.
- Add local git hooks that run Biome on staged files, so most problems are caught before a push.

### 12.2 Code style

- **Biome is the only linter and formatter** for JavaScript, TypeScript, JSON and CSS. Do not add ESLint or Prettier.
- Use one `biome.json` at the repository root with strict rules. CI fails on any issue.
- Commit editor settings so format-on-save uses Biome.
- If you choose another language for any part of the project, use that language's standard formatter and linter and enforce them in CI the same way.

### 12.3 Helper agents

Create specialised helper agents (subagents) for recurring review jobs, in the format your coding tool supports. For Claude Code, that is one file per agent in `.claude/agents/`; check the current documentation for the exact format. Also save each agent's instructions in `docs/agents/` so they don't depend on any one tool.

Each agent has four things defined:
- A clear scope.
- When it runs.
- What it may change. Most are read-only reviewers that report findings.
- A fixed output format: findings ranked by severity, each with the file, the line, the problem and the suggested fix.

Agents to create:

| Agent | Job |
|---|---|
| `security-reviewer` | OAuth and session handling, the game-server connection ticket, input validation, server authority and anti-cheat, rate limits, secrets, risky dependencies, Docker and server hardening, Ansible Vault use |
| `lint-and-style` | Runs Biome and the other linters, and fixes formatting and simple lint issues. Never changes behaviour. |
| `test-engineer` | Writes and maintains tests and finds untested paths in the simulation, economy, ledger and queue. Never weakens, skips or deletes a test to make it pass. |
| `performance-reviewer` | Frame time, tick budget, bandwidth, memory allocations in hot loops, bundle and asset size, all checked against section 10 |
| `multiplayer-reviewer` | Prediction and reconciliation correctness, desync risks, reconnect and room lifecycle |
| `database-reviewer` | Backward-compatible migrations, indexes, transactions and ledger integrity |
| `infra-reviewer` | Ansible idempotency, container resource limits, backup and point-in-time recovery configuration, alerts, and runbooks that still match reality |
| `game-rules-checker` | Checks code and data files against the fixed rules of this brief: no rarity, no luck in the economy, per-class progression with a shared inventory, the loadout and pistol ammunition rules, drop and duplicate rules, buff and revive rules |
| `ui-and-accessibility-reviewer` | Settings, contrast, keyboard and gamepad support, and correct use of `/brand` |
| `license-checker` | Licences of every dependency and asset, and that `ASSETS_LICENSES.md` is complete |
| `docs-keeper` | Keeps `docs/decisions.md`, the runbooks, the recovery kit and the scaling guide up to date |

How they are used:

- Run `lint-and-style`, `test-engineer` and `security-reviewer` before every pull request is merged.
- Run every relevant reviewer before each milestone report.
- Fix each finding, or record it in the milestone report as an accepted risk with a reason.
- The agents add to CI; they never replace it.
- Keep the set small and useful. If two agents overlap, propose merging them.

---

## 13. Stage B milestones

Each milestone ends with a playable build, passing tests, and a report with four parts: what was built, how to run it, what was verified and how, and known gaps.

1. **Foundation.** Monorepo with Biome, type checking and tests. The full GitHub Actions pipeline from section 12, with tests and security checks before every build and versioned images, plus the helper agents. The Ansible playbook provisioning the production VPS, with security, Docker and the deploy tool. PostgreSQL 18 with both backup schedules running to R2 and restore verification on. Monitoring with email alerts. The SSH kit. GitHub and Google sign-in, database schema and migrations, and a landing page with the Rotline brand, sign-in and an empty lobby, deployed to the production VPS but closed to the public. Backups exist from the first day player data does.
2. **Combat slice.** One player, one map, movement, aiming, two main weapons and the pistol with the ammunition rules, three zombie types, a basic HUD, using the rendering approach chosen in Stage A with test-quality art. It already runs through the authoritative server, even locally, so co-op is not a rewrite later.
3. **Online co-op and social.** Rooms, invite codes, four players, prediction and interpolation, downed and revive, reconnect, the friends list with presence and invites, the capacity limit and the queue page. Tested under simulated latency and packet loss.
4. **Progression.** Classes, XP and levels, skill trees with active and passive skills, inventory, upgrades including carried ammunition, discard, the shop, the currency ledger and the firing range.
5. **Missions.** The objective framework with the four required objective types, interactive environment pieces, checkpoints, item drops, temporary buffs, the score multiplier, extra lives, mastery ratings and the results screen.
6. **The horde.** All 17 or more zombie types, the mutation system, the spawn director, the bestiary and the first boss.
7. **Meta game.** Contracts and bounties, the full campaign map, special events, mission modifiers, Survival mode, leaderboards, achievements and cosmetics, and the admin panel.
8. **Hardening and launch.** The 40-bot load test on the production VPS, the full point-in-time restore drill and the migration rehearsal on a fresh server (section 8.8), a security and anti-cheat review, a performance pass against section 10, final art and audio, accessibility settings, privacy pages, account deletion and a launch checklist.

If a milestone turns out larger than expected, split it and tell me, rather than delivering something half-finished under the original name.

---

## 14. Start here

Begin Stage A now. Read this brief once more, list anything that is ambiguous or contradictory, then proceed with the most reasonable reading and record it in `10-open-questions.md`. Finish Stage A with the documents in 4.3 and a one-page summary, and wait for my approval.
