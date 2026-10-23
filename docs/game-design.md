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
| Survival | 1–4 | Endless rounds on one map, each harder than the last; a squad wipe ends the run. Leaderboard per map and season |
| Contracts | 1–4 | Short jobs of three or four minutes outside the campaign (hold out, carry supplies, pull data, defend a shipment), always open |
| Firing range | 1 (or the party) | Practice area, no progression |

### Choosing what to play

- The squad leader picks, in the lobby, either a mission and its difficulty, a contract and its difficulty, or Survival. The picker has two separate tabs, **Campaign** (the zones and their missions in order) and **Game modes** (Survival and the contracts); the lobby shows the game modes in their own group under the campaign. Changing the choice clears everyone's ready mark; a ready mark or a start counts only for the choice the player saw, so nobody deploys into something they did not agree to.
- The campaign so far is two zones of five missions each, every one a run against the clock (section 7): zone 1, **Ashgate**: **Landfall**, **Rail Yard**, **Blackout**, **Holdouts**, **Breakout**; zone 2, **Harrow**: **Airlift**, **Hive**, **Lifeline**, **The Minister**, **Cure**. The zone bosses are not in the game yet.
- Missions open in order: the first is always open, and each one opens when the player has completed the one before it at any difficulty (the next zone's first mission opens when the previous zone's last one is done). Locked missions are shown but cannot be chosen; the server checks when the leader chooses and again at the start, so a new leader who has not opened the squad's mission cannot start it.
- Survival is a mode of its own, always open and played at the Crossroads (section 15), not a mission.
- **Contracts** are short jobs of three or four minutes outside the campaign, all open from the start, paid and ranked like missions (difficulty, par, mastery): **Hotspot** (the Yard: kill all you can for three minutes with its nests awake), **Supply Run** (the Compound: carry three supply crates to the truck), **Data Grab** (the Compound: pull the data from four terminals, then get to the truck) and **Shipment** (the Compound: keep a weapons shipment in one piece for 150 s).
- Survival: rounds come one after another, each with more zombies and, from the third, more kinds of them. Every fifth round brings Brutes as well: one, and one more for every ten rounds survived. Each round cleared pays every player who played it. A squad wipe ends the run, and the results screen shows the rounds survived. Players who bled out come back at the start of the next round, but only if someone finishes the round.
- **Esc opens the pause menu.** In a room of one the game really pauses (for up to 10 minutes); with a squad the game goes on while that player stands still.
- **Abandon** from the pause menu or the lobby: a squad of one ends the mission; a member of a bigger squad leaves the mission and the squad. A player who abandons cannot start another mission for 30 seconds, so restarting cannot be used to farm the opening objectives. A player who simply goes back to the lobby can rejoin within the reconnect grace.
- A player can be in one squad room at a time; joining another one disconnects them from the first.

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
| Sprint multiplier (planned: no sprint yet) | 1.45 | 1.35 | 1.25 |
| Revive time (s) | 4.0 | 2.5 | 4.0 |
| Armour effectiveness | 100 % | 100 % | 120 % |
| Ability slots | 2 (3 at level 20) | 2 (3 at level 20) | 2 (3 at level 20) |

**Levels:** 1–50 per class. XP to reach level *n* = `round(1000 × 1.12^(n−2))` (level 2 costs 1,000 XP, level 10 about 2,500, level 30 about 24,000). Each level grants 1 skill point; levels 10, 20, 30, 40, 50 grant 2. Total 55 points, against about 70 points of nodes per tree, so builds are real choices.

**Respec:** 2,250 Salvage per class (about 32 minutes of play at Veteran), refunding all points.

**Tier rule:** a tier opens after 5 points in the branch's earlier tiers (tier 5 needs 20). Each branch has 22 nodes and 24 ranks; most nodes have one rank, a few two. Node ids, effects and ranks are in `packages/game-data/data/skills/`.

**Earning XP:** each kill gives class XP by zombie type (Drudge 4, Crawler 5, Bolter 6, Swell 15, Screamer 20, Brute 80); score converts at 1 XP per 20 score; each objective completed gives 100 XP and 100 Salvage, each optional objective 150 XP and 150 Salvage, and completing a mission 400 XP and 250 Salvage. In Survival every round cleared gives 40 XP and 25 Salvage. In missions all of it is multiplied by the difficulty's reward multiplier (section 13). XP goes to the class the player deployed with.

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

**Using abilities.** Equipped abilities sit on F, C and V; the two utility slots on G and T (rebinding comes with the settings screen). Cooldowns shrink with ability-cooldown skills. Thrown abilities and grenades land where the cursor is, up to their range (14 m for grenades, 25 m for the mortar). Utility charges refill when each Survival round starts, and in missions at every checkpoint and after a squad wipe.

The Defibrillator works once per Survival round, and once per checkpoint in missions (it is ready again at each checkpoint and after a wipe); with nobody downed in reach it does nothing and its cooldown is given back. A player can have at most 12 zones, mines, decoys, sentries and barricades at once; the oldest goes. A barricade is never built on the cells of a map prop (a door, cover, a barrel, a generator and so on).

**Statuses on zombies**: stunned (no movement or attacks), slowed, marked (takes more damage), poisoned (damage over time) and taunted (chases the Heavy or a decoy). They show on the zombie as a colour tint.

Coverage in a squad: Assault handles mobile threats and elites (Marksman), Medic keeps the squad alive and answers status effects (Grabber pins, Spitter acid, Shocker), Heavy holds chokepoints and crowds (Brutes, swarms). Every class can solo: each has a self-heal or survival tool (Assault: Adrenaline life-steal node; Medic: Stim; Heavy: high health and Barricade).

### Health and damage

Rotline uses health, not lives. What decides a fight is health, damage, armour, resistances, level and gear.

- **Player health**: class base health × (1 + 1 % per class level) plus skill bonuses. Health does not regenerate by itself; it comes back from medkit pickups, Medic abilities, Stim, revives, and in full at each checkpoint.
- **Player armour** (the sum of the five worn armour pieces, and skills) reduces incoming damage: `damage × (1 − armour / (armour + 60))`.
- **Damage dealt** = weapon damage at its upgrade level × skill bonuses × weak-point multiplier (×2, ×3 on elites' cores) × (1 − the target's resistance to that damage type) × the target's armour reduction.
- **Damage types**: ballistic, explosive, fire, shock, chemical. Every zombie type has its own resistances (for example Bulwark: 90 % from the front; Cinder: immune to fire; Hive: weak to fire), shown in the bestiary.
- **Enemy level**: every mission has an enemy level. Enemy health grows by 6 % and enemy damage by 4 % per level above 1, on top of the difficulty's multipliers (section 13). Each mission shows a recommended class level and gear level (the average upgrade level of the equipped items), so levelling up and upgrading gear is what makes harder missions possible.

## 5. Weapons, ammunition and gear

### Loadout

Two main weapons, one pistol, five armour pieces (head, torso, vest, legs, feet), two utility slots. Equipped items are shared by all classes, and the soldier wears what is equipped. Each class is its own person in their own clothes: the Assault is an operator in a combat shirt and trousers, the Medic a woman in a black tactical suit, the Heavy a shaven-headed man in a T-shirt and gloves. Helmets, vests and packs show on all three; torso, legs and feet pieces show on the Assault (as the shirt, trousers and boots), while the Medic and the Heavy keep their own clothes.

### Pistol rule

Pistols have **unlimited reserve ammunition**; their only limits are magazine size and reload time. They have no carried-ammunition stat.

### Starting weapon list (base stats, level 0)

| Weapon | Kind | Damage type | Damage | Fire rate (rpm) | Magazine | Max reserve | Reload (s) | Price |
|---|---|---|---|---|---|---|---|---|
| **G19** | Pistol | Ballistic | 22 | 300 | 12 | unlimited | 1.2 | starter |
| **Desert Eagle** | Pistol | Ballistic | 38 | 180 | 8 | unlimited | 1.4 | 3,600 |
| **Vector** | SMG | Ballistic | 14 | 900 | 32 | 256 | 1.8 | starter |
| **HK416** | Assault rifle | Ballistic | 24 | 600 | 30 | 210 | 2.2 | starter |
| **M4 Super 90** | Shotgun | Ballistic | 10 × 8 pellets | 75 | 6 | 48 | 0.5 per shell | 5,400 |
| **M249** | LMG | Ballistic | 26 | 750 | 100 | 300 | 4.5 | 25,200 |
| **AWP** | Sniper rifle | Ballistic, pierces 3 | 180 | 45 | 5 | 40 | 3.0 | 12,600 |
| **Kiln** | Flamethrower | Fire, 7 m cone | 160 per second | continuous | 100 fuel | 300 | 3.5 | 12,600 |
| **GL-06** | Grenade launcher | Explosive, 3.5 m | 220 | 60 | 6 | 24 | 3.2 | 25,200 |
| **AUG** | Shock rifle | Shock, chains to 3 | 40 | 240 | 20 | 120 | 2.6 | 12,600 |
| **Viper** | Chemical sprayer | Chemical, slows | 90 per second | continuous | 80 | 240 | 3.0 | 12,600 |

Weapon tiers for pricing: tier 1 = 5,400, tier 2 = 12,600, tier 3 = 25,200.

### Upgrades

- 10 levels per item. Cost of level *n* = `tierBase × 1.4^(n−1)`, rounded to 10: starter items base 540 (all ten levels: 37,700), tier 1 base 720 (50,280), tier 2 base 1,260 (87,960), tier 3 base 1,980 (138,230). Starter items can be bought again for 1,350 if discarded.
- Each level raises the item's stats along its own curve, for example: damage +6 %, fire rate +2 %, reload speed +3 %, magazine +5 %, accuracy +3 %, **max carried ammunition +8 %** (main weapons only). The max ammo buff fills a weapon to its *upgraded* maximum.
- **Perk choices at levels 5 and 10**: pick one of two (the first choice is free), switchable later for a small fee (450). Example (K-71): level 5 "Extended mag (+25 % magazine)" or "Hollow points (+15 % damage to unarmoured)"; level 10 "Incendiary rounds (20 % of damage as fire)" or "Rapid chamber (+15 % fire rate)".

### Gear

| Slot | Items (examples) |
|---|---|
| Armour (five places) | Head: Field Helmet (starter, 5), Ridge Helmet (8, explosive resistance), Visor Helmet (7, chemical and fire resistance), Bastion Helmet (12, −2 % speed). Torso: Field Shirt (starter, 2), Padded Jacket (4, fire resistance), Hazmat Suit (4, 25 % fire and chemical resistance). Vest: Kevlar Vest (starter, 10), Assault Rig (18, +1 utility charge), Plated Carrier (24, −5 % speed), Siege Plates (30, −8 % speed, explosive resistance). Legs: Field Trousers (starter, 2), Kneepad Trousers (4, +2 % speed), Armoured Trousers (7, −2 % speed). Feet: Field Boots (starter, 1), Runner Boots (1, +5 % speed), Steel-Toe Boots (4, explosive resistance). The starter set totals 20 armour |
| Utility (×2) | Frag grenades (3), Incendiary grenades (3), Shock grenades (3), Sticky mines (4), Decoy beacon (2), Mini-sentry (1, 30 s) |

Armour absorbs a share of incoming damage: `damage × (1 − armour / (armour + 60))`.

### Item drops in missions

- At most **4 item drops per mission per player**, with one place always kept for the final objective's guaranteed drop. Sources:
  - elites: 8 % chance each, rolled for every player who has played within the last 60 seconds;
  - the final objective: one guaranteed drop for every player who has played within the last 60 seconds;
  - hidden caches (1–2 per mission): hold interact within 1.6 m; each cache opens once per player.
- The item's tier is rolled with weights by difficulty:

  | Difficulty | Tier 1 | Tier 2 | Tier 3 |
  |---|---|---|---|
  | Recruit | 70 | 25 | 5 |
  | Veteran | 60 | 30 | 10 |
  | Nightmare | 45 | 35 | 20 |
  | Apocalypse | 30 | 40 | 30 |

- Drops are **per player**: only the finder is told about their item or cache. They are rolled by the server from a random stream of their own, seeded unpredictably and kept apart from the one the fight uses. They are saved to the account at the next checkpoint and at mission end; an item found after the last checkpoint by a player who leaves before the end is lost.
- A player who did not play for at least half the mission keeps their XP, Salvage and the items they found, but gets no mission result, completion reward or final drop.
- **Found items always arrive at level 0.** If the player does not own the item, it is a new unlock. If they own it (any level), it becomes a duplicate (`item_duplicate`) whose only action is **Discard for Salvage**: starter items 300, tier 1: 600, tier 2: 1,200, tier 3: 2,400.
- **Discarding owned items**: allowed for anything except the last pistol and the last two main weapons. Discarding an owned item pays the same amounts. Equipped or upgraded items require a second confirmation that shows the upgrade level and the Salvage that was spent on it; there is no refund for upgrades. An equipped item is replaced in the loadout by a spare one of the same kind.

### Starter kit

Vector SMG, HK416 assault rifle, G19 pistol, frag grenades, and a full set of basic armour: Field Helmet, Field Shirt, Kevlar Vest, Field Trousers and Field Boots.

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

That is about **830 Salvage per mission, roughly 4,200 per hour** before contracts. Difficulty multipliers on rewards: Recruit ×0.7, Veteran ×1.0, Nightmare ×1.35, Apocalypse ×1.8; they apply to everything a mission pays (kills, objectives, completion, score and score thresholds).

Who is paid:

- An objective pays (and scores) only the first time it is done; one redone after a squad wipe or a failed objective pays nothing. Its XP and Salvage are earned by every connected player who has moved, aimed or fired since the previous payment, and its score by every player active in the last 60 seconds, but all of it is held until the next checkpoint or the end of the mission and then paid only to those who have played at least half of the mission so far. A player who abandons, or whose reconnect grace runs out, before then loses what is held, so an abandoned mission pays only for its kills (and their score) and the objectives settled at earlier checkpoints.
- Objective score, elite drops and the final drop go only to players who have played within the last 60 seconds.
- The mission result, the completion reward and the final drop go only to players who were connected and playing for at least half the mission, whether or not they are connected at the end.

Hours of play per purchase (at 4,200/hour, no contracts):

| Purchase | Price | Hours |
|---|---|---|
| Tier 1 weapon | 5,400 | 1.3 |
| Tier 2 weapon | 12,600 | 3.0 |
| Tier 3 weapon | 25,200 | 6.0 |
| Mid armour | 10,800 | 2.6 |
| Respec one class | 2,250 | 0.5 |
| Tier 1 item, levels 1–10 | 50,280 | 12.0 |
| Tier 2 item, levels 1–10 | 87,960 | 20.9 |
| Tier 3 item, levels 1–10 | 138,230 | 32.9 |

A player who plays 1 hour a day and completes dailies (+1,500) earns about 5,700 a day: a new tier 2 weapon every 2–3 days, a fully upgraded tier 3 weapon in about a month. The spreadsheet lives with the game data (`packages/game-data/economy.csv`) and is regenerated by a script from the same files the game uses, so it cannot drift.

The shop sells specific weapons, gear, consumables (grenade refills between missions, 200) and upgrades at fixed, visible prices. Nothing random is ever sold.

## 7. Missions and objectives

An objective is a data record (type, parameters, triggers, rewards) plus one small logic module per type. A mission is a list of steps (objectives done in order) with checkpoints between them, plus optional objectives that run alongside the steps.

### The missions

| # | Mission | Map | Steps | Optional |
|---|---|---|---|---|
| 1 | **Landfall** | Landfall (46 × 150 m, four areas closed behind the squad) | a 12-minute run: carry the flight recorder from the burning wreck to the street gate; fight up the high street (a pharmacy behind a door holds a cache); restart the checkpoint generator; hold while the gate opens (25 s); burn three nests in the square; kill the Brute; hold the helipad 40 s; get on the bird (40 s) | kill 150 |
| 2 | **Rail Yard** | Rail Yard (56 × 128 m, four areas closed behind the squad) | an 11-minute run: carry the switch keys from the stationmaster's office to the platform gate; burn three nests in the container stacks; start the crane generator; hold while the gate grinds open (25 s); throw the points in the signal box; kill the Brute in the turntable pit; hold the convoy road 35 s; get on the trucks (40 s) | kill 150 |
| 3 | **Blackout** | Power Plant (60 × 136 m, four areas closed behind the squad) | a 13-minute run: reach the plant fence; start the backup generator that opens it; restart three generators in the transformer yard (each wakes a turret); burn two nests; defend the transformer 70 s; reroute the grid from the control room; kill the Brute in the turbine hall; get out past the cooling towers (75 s) | kill 180 |
| 4 | **Holdouts** | Food Depot (96 × 64 m, three sections behind gates) | a 15-minute run: clear the truck lot (kill 25); find the survivors on the office cameras; burn two nests in the warehouse; walk both survivors to the dock; kill the Brute on the dock; get on the truck (90 s) | crack the armoury safe (a terminal) behind a crate-stacked doorway |
| 5 | **Breakout** | Motor Pool (64 × 84 m, the road north behind a gate) | a 14-minute run: hold the sandbagged centre 60 s; start two generators that wake its turrets; kill 80; kill two Brutes; hold the centre 90 s; out through the north gate (90 s) | kill 250 |
| 6 | **Airlift** | Airfield (76 × 60 m) | a 10-minute stand in a grounded transport: hold the cargo bay 70 s; start the power unit on the apron (it wakes the ramp turrets, and the side cargo bays open with kit in them); keep the ramp hydraulics running 80 s (the jumpseat room opens); kill the Brute on the apron; hold on 40 s while the engines spin up; everyone aboard (40 s) | kill 200 |
| 7 | **Hive** | Supermarket (64 × 104 m, three areas closed behind the squad) | a 12-minute run: burn three pods in the car park; get inside before the doors fall; burn four nests among the aisles, the deli and the freezers; burn the brood of three eggs in the loading yard; kill what hatches; out through the yard gate (40 s) | kill 200 |
| 8 | **Lifeline** | Harrow General (80 × 80 m, an atrium and four corridors) | a 15-minute run: clear the atrium; down corridor Alpha to its switch; clear the atrium again; Bravo; clear it again; Charlie; clear it one more time; Delta; kill two Brutes in the atrium; out through the ambulance bay (45 s). Each corridor opens only once the atrium is clear; a sealed store behind boxes holds a cache | kill 250 |
| 9 | **The Minister** | Hill House (72 × 92 m) | a 9½-minute rescue: get into the house; clear its halls (kill 30); override the safe room lock from the kitchen; walk the minister to the helipad on the lawn; hold the pad 45 s; kill the Brute on the lawn; on the chopper (30 s). A generator in the garden wakes the helipad's turrets | kill 200 |
| 10 | **Cure** | Harrow Metro (64 × 150 m, four areas closed behind the squad) | an 11½-minute run: clear the station entrance; open the platform gates from the ticket office; through the stopped train to the far platform (the hall has fallen in); power the blast door; find on the index terminal which lab holds the cure; carry it from lab four to the roof pad; kill the Brute on the pad; on the bird (45 s). A dead train on the other track holds a nest and a cache | kill 200 |
