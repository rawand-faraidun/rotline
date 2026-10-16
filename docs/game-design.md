# Game design

How Rotline plays. **Every number here is a starting value** kept in `packages/game-data` (validated data files), not in code, and tuned through playtests.

The in-game currency is called **Salvage**.

## 1. Core loop

Lobby → choose class and loadout → pick a mission and difficulty (with optional modifiers) → fight and complete objectives (checkpoints along the way) → results screen (XP, Salvage, score, items found, mastery) → back to the lobby to upgrade, buy, claim contracts, and go again.

Target session shapes: one campaign mission takes 10–15 minutes; a zone (5 missions + boss) takes about 1.5 hours on first clear.

## 2. Modes

| Mode | Players | Description |
|---|---|---|
| Campaign | 1–4 | 5 zones × (5 missions + 1 boss mission). Each mission has 2–3 checkpoints |
| Special events | 1–4 | A campaign mission with unusual rules (e.g. "all Cinders", "lights out", "double-speed horde"), switched on in the admin panel, with event cosmetics as rewards |
| Survival | 1–4 | Endless rounds on one map, rising difficulty, leaderboard per map and season |
| Firing range | 1 (or the party) | Practice area, no progression |

### Zones

| # | Zone | Setting | Boss |
|---|---|---|---|
| 1 | Ashgate | Ruined city streets | **The Warden** (a riot-armoured colossus) |
| 2 | Kessler Labs | Research laboratory | **Specimen Zero** (multi-stage mutation) |
| 3 | The Undercroft | Sewers and storm drains | **The Brood Queen** |
| 4 | Fort Halberd | Military base | **Iron Maw** (fused with a tank) |
| 5 | Greyline Station | Power station | **The Conductor** (electrical) |

## 3. Classes

One profile per player; class is switched in the lobby only. Per class: level, XP, skill points, skill tree, ability slots. Shared: Salvage, inventory, upgrades, loadout, cosmetics.

| Base stat | Assault | Medic | Heavy |
|---|---|---|---|
| Health | 100 | 100 | 140 |
| Move speed (m/s) | 5.4 | 5.0 | 4.4 |
| Sprint multiplier | 1.45 | 1.35 | 1.25 |
| Revive time (s) | 4.0 | 2.5 | 4.0 |
| Armour effectiveness | 100 % | 100 % | 120 % |
| Ability slots | 2 (3 at level 20) | 2 (3 at level 20) | 2 (3 at level 20) |

**Levels:** 1–50 per class. XP to reach level *n* = `round(1000 × 1.12^(n−2))` (level 2 costs 1,000 XP, level 10 about 2,500, level 30 about 24,000). Each level grants 1 skill point; levels 10, 20, 30, 40, 50 grant 2. Total 55 points, against about 70 points of nodes per tree, so builds are real choices.

**Respec:** 2,500 Salvage per class (about 35 minutes of play at Veteran), refunding all points.

**Tier rule:** a tier opens after 5 points in the branch's earlier tiers (tier 5 needs 20). Each branch has 22 nodes and 24 ranks; most nodes have one rank, a few two. Node ids, effects and ranks are in `packages/game-data/data/skills/`.

**Earning XP (until missions arrive):** each kill gives class XP by zombie type (Drudge 4, Bolter 6, Swell 15) plus score converted at 1 XP per 20 score, and every wave cleared gives 40 XP and 25 Salvage. XP goes to the class the player deployed with.

## 4. Skill trees

Each class has three branches of 22 nodes in five tiers. A tier unlocks after 5 points in the branch's previous tiers. Each branch has 2 active abilities and 1 capstone passive.

| Class | Branch | Actives (cooldown) | Example passives | Capstone |
|---|---|---|---|---|
| Assault | **Vanguard** (mobility) | Adrenaline Burst: +30 % speed and fire rate for 6 s (40 s); Slide Dash: 6 m dash with i-frames (12 s) | +4 % move speed per rank (3 ranks); −8 % sprint stamina use | *Momentum*: each kill in a chain gives +1 % damage, up to 25 % |
| | **Demolition** (area) | Cluster Grenade: 5 bomblets, 90 damage each (25 s); Breaching Charge: cone blast, knock-back (30 s) | +6 % explosive damage per rank; +1 grenade carried | *Shrapnel*: explosive kills spray 3 fragments |
| | **Marksman** (precision) | Mark Target: +40 % damage taken for 8 s (20 s); Overwatch: next magazine pierces (35 s) | +5 % critical damage per rank; +4 % reload speed per rank | *Executioner*: +50 % damage to targets below 25 % health |
| Medic | **Field Surgeon** (healing) | Medkit Drop: heals 60 over 5 s in a 3 m radius (25 s); Healing Field: 20 HP/s for 6 s, 5 m radius (45 s) | +10 % healing per rank; −0.3 s revive time per rank (3 ranks) | *Second Wind*: revived allies get 3 s of 50 % damage reduction |
| | **Chemist** (chemical damage, control) | Toxin Grenade: 40 DPS cloud for 6 s (25 s); Antidote Shot: cleanse and 5 s immunity to status effects for the squad (60 s) | +8 % chemical damage per rank; slowed zombies take +5 % damage per rank | *Contagion*: chemical kills spread the poison |
| | **Combat Medic** (self-sufficiency) | Stim: self heal 40 and +20 % speed for 5 s (30 s); Defibrillator: revive from 8 m, once per checkpoint (90 s) | +5 % max health per rank; +15 % healing received at rank 3 | *Last Rites*: once per mission, survive a lethal hit with 1 HP |
| Heavy | **Bulwark** (toughness) | Deploy Barricade: 300 HP wall, 4 m (30 s); Taunt: pulls attention of zombies within 10 m for 5 s (35 s) | +6 % max health per rank; +5 % armour per rank | *Immovable*: immune to knock-back and stuns |
| | **Artillery** (area damage) | Aerial Bombardment: 8 shells over 3 s in a 10 m line (60 s); Mortar Shot: one 6 m blast at range (20 s) | +6 % explosive damage per rank; +10 % blast radius at rank 3 | *Aftershock*: explosions slow survivors by 40 % for 3 s |
| | **Suppressor** (crowd control) | Shock Pulse: stuns zombies in 6 m for 2 s (25 s); Minigun Spin-up: carry a minigun for 8 s (75 s) | +5 % LMG and minigun damage per rank; +10 % magazine size for LMGs | *Suppression*: zombies hit by your bullets move 15 % slower |

Coverage in a squad: Assault handles mobile threats and elites (Marksman), Medic keeps the squad alive and answers status effects (Grabber pins, Spitter acid, Shocker), Heavy holds chokepoints and crowds (Brutes, swarms). Every class can solo: each has a self-heal or survival tool (Assault: Adrenaline life-steal node; Medic: Stim; Heavy: high health and Barricade).

### Health and damage

Rotline uses health, not lives. What decides a fight is health, damage, armour, resistances, level and gear.

- **Player health**: class base health × (1 + 1 % per class level) plus skill bonuses. Health does not regenerate by itself; it comes back from medkit pickups, Medic abilities, Stim, revives, and in full at each checkpoint.
- **Player armour** (from the armour slot and skills) reduces incoming damage: `damage × (1 − armour / (armour + 60))`.
- **Damage dealt** = weapon damage at its upgrade level × skill bonuses × weak-point multiplier (×2, ×3 on elites' cores) × (1 − the target's resistance to that damage type) × the target's armour reduction.
- **Damage types**: ballistic, explosive, fire, shock, chemical. Every zombie type has its own resistances (for example Bulwark: 90 % from the front; Cinder: immune to fire; Hive: weak to fire), shown in the bestiary.
- **Enemy level**: every mission has an enemy level from its zone and difficulty. Enemy health grows by 6 % and enemy damage by 4 % per level. Each mission shows a recommended class level and gear level (the average upgrade level of the equipped items), so levelling up and upgrading gear is what makes harder missions possible.

## 5. Weapons, ammunition and gear

### Loadout

Two main weapons, one pistol, armour, two utility slots. Equipped items are shared by all classes.

### Pistol rule

Pistols have **unlimited reserve ammunition**; their only limits are magazine size and reload time. They have no carried-ammunition stat.

### Starting weapon list (base stats, level 0)

| Weapon | Kind | Damage type | Damage | Fire rate (rpm) | Magazine | Max reserve | Reload (s) | Price |
|---|---|---|---|---|---|---|---|---|
| **P9 Service** | Pistol | Ballistic | 22 | 300 | 12 | unlimited | 1.2 | starter |
| **Halcyon .45** | Pistol | Ballistic | 38 | 180 | 8 | unlimited | 1.4 | 4,000 |
| **Vex-9** | SMG | Ballistic | 14 | 900 | 32 | 256 | 1.8 | starter |
| **K-71** | Assault rifle | Ballistic | 24 | 600 | 30 | 210 | 2.2 | starter |
| **Breacher 12** | Shotgun | Ballistic | 10 × 8 pellets | 75 | 6 | 48 | 0.5 per shell | 6,000 |
| **Mower** | LMG | Ballistic | 26 | 750 | 100 | 300 | 4.5 | 28,000 |
| **Longstride** | Sniper rifle | Ballistic, pierces 3 | 180 | 45 | 5 | 40 | 3.0 | 14,000 |
| **Kiln** | Flamethrower | Fire, 7 m cone | 160 per second | continuous | 100 fuel | 300 | 3.5 | 14,000 |
| **Thumper** | Grenade launcher | Explosive, 3.5 m | 220 | 60 | 6 | 24 | 3.2 | 28,000 |
| **Arclight** | Shock rifle | Shock, chains to 3 | 40 | 240 | 20 | 120 | 2.6 | 14,000 |
| **Viper** | Chemical sprayer | Chemical, slows | 90 per second | continuous | 80 | 240 | 3.0 | 14,000 |

Weapon tiers for pricing: tier 1 = 6,000, tier 2 = 14,000, tier 3 = 28,000.

### Upgrades

- 10 levels per item. Cost of level *n* = `tierBase × 1.4^(n−1)`, rounded to 10: starter items base 600 (all ten levels: 41,890), tier 1 base 800 (55,850), tier 2 base 1,400 (97,740), tier 3 base 2,200 (153,580). Starter items can be bought again for 1,500 if discarded.
- Each level raises the item's stats along its own curve, for example: damage +6 %, fire rate +2 %, reload speed +3 %, magazine +5 %, accuracy +3 %, **max carried ammunition +8 %** (main weapons only). The max ammo buff fills a weapon to its *upgraded* maximum.
- **Perk choices at levels 5 and 10**: pick one of two (the first choice is free), switchable later for a small fee (500). Example (K-71): level 5 "Extended mag (+25 % magazine)" or "Hollow points (+15 % damage to unarmoured)"; level 10 "Incendiary rounds (20 % of damage as fire)" or "Rapid chamber (+15 % fire rate)".

### Gear

| Slot | Items (examples) |
|---|---|
| Armour | Kevlar Vest (starter, 20 armour), Plated Carrier (40 armour, −5 % speed), Hazmat Suit (20 armour, 25 % fire and chemical resistance), Assault Rig (30 armour, +1 utility charge) |
| Utility (×2) | Frag grenades (3), Incendiary grenades (3), Shock grenades (3), Sticky mines (4), Decoy beacon (2), Mini-sentry (1, 30 s) |

Armour absorbs a share of incoming damage: `damage × (1 − armour / (armour + 60))`.

### Item drops in missions

- About **2–3 item drops per mission per player**, from elites (8 % chance each), objective completions (guaranteed one per mission from the final objective), and 1–2 hidden caches per map.
- Drops are **per player** (each player sees their own), are rolled by the server from data-driven drop tables, and are saved to the account at the next checkpoint for use in later missions.
- **Found items always arrive at level 0.** If the player does not own the item, it is a new unlock. If they own it (any level), it becomes a duplicate (`item_duplicate`) whose only action is **Discard for Salvage**: starter items 300, tier 1: 600, tier 2: 1,200, tier 3: 2,400.
- **Discarding owned items**: allowed for anything except the last pistol and the last two main weapons. Discarding an owned item pays the same amounts. Equipped or upgraded items require a second confirmation that shows the upgrade level and the Salvage that was spent on it; there is no refund for upgrades. An equipped item is replaced in the loadout by a spare one of the same kind.

### Starter kit

Vex-9 SMG, K-71 assault rifle, P9 Service pistol, Kevlar Vest, frag grenades.

## 6. Economy

Earning (Veteran difficulty, 4-player squad, per player):

| Source | Amount | Per 12-minute mission (typical) |
|---|---|---|
| Kills | 0.5–40 per kill by type (Drudge 0.5, Ram 15, Colossus 40) | 250 |
| Objectives | 100 per primary, 150 per optional | 300 |
| Mission completion | 250 × difficulty multiplier | 350 |
| Score bonus | 1 per 1,000 score | 80 |
| Contracts | daily 1,500, weekly 8,000 | (outside the mission) |
| Discarded duplicates | 600–2,400 | (variable) |

That is about **830 Salvage per mission, roughly 4,200 per hour** before contracts. Difficulty multipliers on rewards: Recruit ×0.7, Veteran ×1.0, Nightmare ×1.35, Apocalypse ×1.8.

Hours of play per purchase (at 4,200/hour, no contracts):

| Purchase | Price | Hours |
|---|---|---|
| Tier 1 weapon | 6,000 | 1.4 |
| Tier 2 weapon | 14,000 | 3.3 |
| Tier 3 weapon | 28,000 | 6.7 |
| Mid armour | 12,000 | 2.9 |
| Respec one class | 2,500 | 0.6 |
| Tier 1 item, levels 1–10 | 55,850 | 13.3 |
| Tier 2 item, levels 1–10 | 97,740 | 23.3 |
| Tier 3 item, levels 1–10 | 153,580 | 36.6 |

A player who plays 1 hour a day and completes dailies (+1,500) earns about 5,700 a day: a new tier 2 weapon every 2–3 days, a fully upgraded tier 3 weapon in about a month. The spreadsheet lives with the game data (`packages/game-data/economy.csv`) and is regenerated by a script from the same files the game uses, so it cannot drift.

The shop sells specific weapons, gear, consumables (grenade refills between missions, 200) and upgrades at fixed, visible prices. Nothing random is ever sold.

## 7. Missions and objectives

An objective is a data record (type, parameters, triggers, rewards) plus one small logic module per type. The mission script is a list of objectives with checkpoints between them.

| Objective type | Rules (starting values) |
|---|---|
| **Rescue** | Find 1–3 VIPs (60 HP, follow the nearest player within 6 m, panic and stop if a zombie is within 2 m), escort to extraction. Fail if all die |
| **Restore power** | Activate 2–4 generators in sequence; each takes 20 s to start (hold interact not needed; defend it), triggers a wave while starting, and has 400 HP |
| **Defend** | Hold 2–3 barricades for 90–150 s; barricades have 600 HP; repairing costs 2 s per 100 HP |
| **Retrieve** | Collect 3–5 samples; the carrier cannot sprint and moves 20 % slower; dropping a sample leaves it for 30 s before it returns to its spawn |
| Destroy nests | Destroy 3–6 nests (800 HP, spawn Wrigglers until destroyed) |
| Hold terminal | Stand in a 5 m zone while a 120 s upload runs; the timer pauses when the zone is empty |
| Escort vehicle | A slow APC (2 m/s, 3,000 HP) that stops when no player is within 10 m |
| Timed extraction | Reach the exit in 90 s |
| Boss hunt | Find and kill a named elite |

Missions combine one primary objective chain with 1–2 optional objectives that pay extra. **Interactive environment**: explosive barrels (150 damage, 4 m), doors that can be sealed or welded (weld takes 4 s, a welded door has 500 HP), powered turrets and floodlights that need a generator, spike and electric traps (activated by interact, 30 s cooldown), destructible cover (crates 200 HP, sandbags 400 HP).

## 8. Zombies

Eighteen types. Each is recognisable from above by silhouette, size and an accent colour or glow (readability beats realism).

| # | Name | Role | Health (Veteran) | Speed (m/s) | Behaviour | Player answer | Readability cue |
|---|---|---|---|---|---|---|---|
| 1 | **Drudge** | Shambler | 60 | 1.2 | Slow, numerous | Any weapon | Grey, hunched |
| 2 | **Bolter** | Runner | 35 | 4.2 | Sprints straight in | Keep moving, shotguns | Thin, long stride, red eyes |
| 3 | **Gutter** | Crawler | 45 | 2.0 | Low, emerges from vents and gaps | Watch the floor, splash damage | Flat silhouette, wet sheen |
| 4 | **Swell** | Bloater | 150 | 1.0 | Explodes on death (60 damage, 3 m) leaving an 8 s acid pool | Kill at range | Huge round body, green veins |
| 5 | **Retcher** | Spitter | 80 | 1.6 | Lobs acid (25 + puddle) from 12 m | Move, break line of sight | Hunched, glowing yellow throat |
| 6 | **Ram** | Brute | 600 | 1.5, charges 7 | Straight-line charge, 1.5 s stun on hit | Sidestep, shoot its back | Twice human size, bone plates |
| 7 | **Howler** | Screamer | 120 | 2.0 | Screams: summons 6–10 and +25 % speed to zombies in 12 m for 6 s | Priority target | Open jaw, pulsing white ring |
| 8 | **Shade** | Stalker | 90 | 3.2 | 10 % visible beyond 6 m | Flashlights, Shock reveals | Shimmer distortion |
| 9 | **Vaulter** | Leaper | 70 | 3.0 | Jumps barricades and gaps (8 m leaps) | Area denial, don't rely on walls | Long limbs, crouched |
| 10 | **Bulwark** | Shieldbearer | 300 | 1.4 | Front armour absorbs 90 % | Flank, explosives over the shield | Door-shaped shield |
| 11 | **Delver** | Burrower | 200 | 3.5 underground | Tunnels (visible dust trail), surfaces under players (40 damage, knock-up) | Keep moving when the trail heads to you | Dust trail, armoured head |
| 12 | **Hive** | Carrier | 180 | 1.3 | On death releases 8 Wrigglers (10 HP parasites) | Fire and area damage | Swollen back sacs |
| 13 | **Cinder** | Igniter | 160 | 2.2 | On fire, leaves burning trail (15 DPS), immune to fire | Ballistic or shock | Orange glow, flames |
| 14 | **Arc** | Shocker | 140 | 2.0 | Pulse every 8 s: disables abilities and turrets in 6 m for 3 s | Kill from range | Blue sparks |
| 15 | **Matron** | Broodmother | 900 | 0.8 | Spawns 2 Wrigglers every 3 s until killed | Focus fire | Huge, egg clusters |
| 16 | **Mender** | Reanimator | 200 | 1.5 | Raises up to 5 dead zombies within 10 m every 10 s | Kill first; burn corpses | Purple glow, staff-like arm |
| 17 | **Clutch** | Grabber | 150 | 2.5 | Pins a player; teammate frees with interact (1.5 s) or the player breaks out with 15 taps | Stay grouped, Medic antidote | Long arms, hooked hands |
| 18 | **Colossus** | Juggernaut (elite) | 2,500 | 1.6 | Heavy armour, 3 glowing weak points (×3 damage) | Aim for weak points, Marksman | Huge, armour plates, orange cores |

Plus **Wriggler** (parasite, 10 HP, from Hive and Matron) as a sub-enemy. Health and counts scale by difficulty (section 13).

### Mutation system

- **Stages**: each type has three mutation stages unlocked by zone progress and difficulty (stage 1 from zone 2 or Nightmare, stage 2 from zone 4 or Apocalypse, stage 3 Apocalypse zone 4+). A stage adds one ability, a resistance, or an attack pattern, and a visible change (growths, colour, glow). Example, Retcher: stage 1 spits twice; stage 2 acid slows; stage 3 spits a burst of three.
- **Adaptive mutations**: the server tracks the squad's damage by type and behaviour (turret share, time spent stationary, average distance to zombies) over the last two checkpoints. If one damage type exceeds 55 % of damage, later spawns shift toward a strain with resistance to it; if the squad camps, more Vaulters and Delvers; if it kites, more Bolters and Clutches.
- **Fairness**: resistances are capped at 35 % (never immunity, except the Cinder's inherent fire immunity); at most two adaptive strains active at once; every strain is announced in the HUD ("Strain adapted: fire-hardened") and shown on the zombie (a coloured crust); there is always a counter (another damage type, an ability, a utility).
- **Spawn director**: tracks an intensity score (damage taken, zombies within 10 m, time since last peak) and cycles build-up (60–90 s) → peak (20–40 s) → relief (20–30 s). Enemy budget per second scales with squad size and difficulty; specials have per-type cooldowns.

### Bosses

Three phases each (at 100 %, 66 %, 33 % health), telegraphed attacks (ground markings 0.8–1.5 s before impact), weak points, and one coordination mechanic. Health = `base × (0.55, 0.75, 0.9, 1.0)` for 1–4 players × difficulty multiplier.

Example, **The Warden** (zone 1): base 25,000 health. Phase 1: shield charge (telegraphed line), riot-baton slam (circle). Phase 2: calls Bulwarks; its back armour breaks only when hit from two sides within 3 s (solo: a decoy beacon counts as the second side). Phase 3: enraged, faster charges, tear gas zones. Weak point: the exposed spine after armour breaks.

## 9. Temporary buffs

The server rolls drops: 2 % chance per kill, at most one buff every 30 s per squad, higher from elites and caches. Team-wide buffs apply to the whole squad.

| Buff | Effect | Duration | Team |
|---|---|---|---|
| **Screen nuke** | Kills all non-elite zombies on screen; elites and bosses take 25 % of max health | instant | yes |
| **Max ammo** | Fills all main weapons to their upgraded maximum | instant | yes |
| **Double XP** | Doubles class XP earned | 60 s | yes |
| **Minigun** | Replaces your weapon with a minigun (45 damage, 1,200 rpm, unlimited ammo) | 20 s | no |
| Instakill | Every hit kills non-elites | 15 s | yes |
| Speed boost | +30 % move speed | 15 s | yes |
| Shield bubble | Stationary 5 m bubble that blocks zombies and projectiles | 10 s | yes |
| Freeze pulse | Freezes zombies within 15 m | 6 s | yes |
| Sentry | Deploys a turret (25 damage, 600 rpm) | 30 s | no |

## 10. Score multiplier

- A kill within **2.5 s** of the previous kill extends the chain. The chain sets the multiplier: ×1 (0–9 kills), ×2 (10), ×3 (25), ×4 (50), ×5 (100), ×6 (200).
- The chain lapses after 2.5 s without a kill and **resets when the player goes down**.
- Score per kill = zombie score value × multiplier (Drudge 10 … Colossus 1,000); objectives give flat score.
- Score converts to bonus class XP at mission end: 1 XP per 20 score.
- Score thresholds (25,000, 75,000, 150,000, then every 150,000) pay a Salvage bonus (100 each) and heal the player by 30 % of their maximum health.
- HUD: multiplier and chain timer in the top centre, large, with a draining bar.

## 11. Downed and revive

There are no lives or hearts. A player's health reaching zero is what matters.

| Rule | Value |
|---|---|
| Zero health in co-op | The player is **downed**: crawls slowly, can use the pistol, and a bleed-out timer starts |
| Bleed-out timer | 30 s, minus 5 s for each earlier down this checkpoint (minimum 15 s) |
| Revive (hold interact within 1.5 m) | 4 s, Medic 2.5 s, skills down to 1.5 s; taking damage does not cancel it |
| Revived health | 30 % |
| Bled out | The player is out and spectates teammates; they return at the next checkpoint with full health (Survival: end of round) |
| Zero health solo | The run returns to the last checkpoint with full health; checkpoints come every 3–5 minutes |
| Squad wipe | Everyone downed or out at once: restart from the last checkpoint (Survival: the run ends) |

## 12. Contracts and bounties

- **3 daily contracts** rotate at 00:00 UTC (1,500 Salvage each); **3 weekly contracts** rotate Monday 00:00 UTC (8,000 each). A countdown is shown.
- Examples: "Kill 200 zombies with shotguns", "Finish a mission with nobody bleeding out", "Revive 5 teammates", "Destroy 10 nests on Nightmare".
- **Bounties**: a named elite (e.g. *Old Ironjaw*, a mutated Ram) that appears in one mission at one difficulty this week; reward 5,000 and a title.
- Progress is counted by the server from match events. Missing a day costs nothing: no streaks, no penalties.

## 13. Lobby, difficulty and matchmaking

- Private lobbies by invite link, 6-character code, or the friends list; public quick match by mission and difficulty.
- The lobby shows each player's class, class level, loadout and avatar, with a ready check (all ready, or the host starts after a 10 s countdown).
- Disconnect grace period: 120 s (see `netcode.md`).
- Idle in lobby: warning at 10 minutes, seat released at 12 minutes (queue rules in `architecture.md`).
- Communication: ping wheel (8 pings: here, enemy, defend, loot, help, revive me, go, wait) and 12 quick-chat phrases. No free text chat in version 1.

| Difficulty | Enemy health | Enemy count | Mutation stage offset | Rewards |
|---|---|---|---|---|
| Recruit | ×0.8 | ×0.8 | +0 | ×0.7 |
| Veteran | ×1.0 | ×1.0 | +0 | ×1.0 |
| Nightmare | ×1.5 | ×1.25 | +1 | ×1.35 |
| Apocalypse | ×2.2 | ×1.5 | +2 | ×1.8 |

Squad-size scaling of enemy count: 1 player ×0.5, 2 ×0.7, 3 ×0.85, 4 ×1.0. A 4-player Apocalypse peak is capped at **300 zombies alive**.

## 14. Friends list

- Add by unique player name or an invite link (valid 7 days); accept, decline, remove, block.
- Status: online in lobby, in a mission (name), in the queue, in the firing range, offline (last seen).
- Invite to lobby; join a friend's lobby if it has a free slot.
- Recent players: the last 50 people you finished a mission with, with an "add friend" button.
- Presence is pushed (Valkey pub/sub → the player's push channel), never polled.

## 15. Firing range

A small map reached from the lobby. Dummy targets (static, moving, armoured with weak points), a spawner for any zombie type the player has already killed (with any mutation stage they have seen), damage numbers, and a DPS meter. Abilities have no cooldown here. Nothing earned counts toward progression. It runs on the server like everything else, at low priority.

## 16. Bestiary

An entry unlocks on a player's first kill of a type: the model (rotatable), behaviour notes, weaknesses and resistances, every mutation stage and adaptive strain the player has seen, and their kill count.

## 17. Achievements and cosmetics

About 60 achievements at launch (milestones, feats, mastery, bestiary completion). Rewards are cosmetics only: titles, profile banners, weapon skins, armour colours, extra DiceBear avatar styles. Cosmetics never change stats and are never sold.

## 18. Mission mastery

| Rating | Requirement (per mission, any difficulty from Veteran up) |
|---|---|
| Bronze | Complete |
| Silver | Complete under par time and at least 1 optional objective |
| Gold | Complete under 80 % of par, all optional objectives, score above target, and no more than 1 down across the squad |

Shown on the mission select map.

## 19. Mission modifiers

Switched on before a mission; the reward bonus is shown clearly and capped at **+60 %** total.

| Modifier | Effect | Reward bonus |
|---|---|---|
| Friendly fire | Your shots hurt teammates (50 %) | +15 % |
| Hardened strains | Mutation stage +1 | +20 % |
| Scarce ammunition | Ammo pickups −50 %, no max-ammo buffs | +15 % |
| Blackout | Darkness; flashlights only | +20 % |
| Fragile | −30 % max health | +25 % |
| Swarm | Enemy count ×1.3 | +15 % |
