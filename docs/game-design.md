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
- Survival is a mode of its own, always open, not a mission. The leader picks its map from three: Old Town, the Glasshouse and the Docks (section 15).
- **Contracts** are short jobs of three or four minutes outside the campaign, all open from the start, paid and ranked like missions (difficulty, par, mastery): **Hotspot** (kill all you can for three minutes with the nests awake), **Supply Run** (carry three supply crates to a drop-off), **Data Grab** (pull the data from four terminals, then get out) and **Shipment** (keep a weapons shipment in one piece for 150 s). Each contract runs on one of several maps, picked at random for every run: Hotspot on the Yard, the Crossroads, Old Town, the Glasshouse or the Docks; Supply Run on the Compound, the Docks or Old Town; Data Grab on the Compound, the Glasshouse or the Docks; Shipment on the Compound, Old Town or the Glasshouse. The job, its rules and its records stay the same; the place, the props it needs and where they stand change with the map.
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

Every mission has a briefing (shown while it loads), a radio line from the squad's handler or a survivor when each step starts and ends, and a debrief on the results screen.

### Objective types

| Type | Done when |
|---|---|
| Kill | The squad has killed a set number of zombies, or of one type ("kill the Brute") |
| Reach | A standing player who is playing (not idle) enters an area |
| Hold | A standing, playing player has been in an area for a set time; the timer runs only while someone is there |
| Survive | A set time has passed; the clock stops while the whole squad is down |
| Interact | Every listed generator or terminal has been worked (a generator counts once it has finished starting up) |
| Defend | A defend target has stood for a set time; the clock stops while the whole squad is down. Losing the target fails the objective |
| Rescue | Every listed survivor is either safe (walked into the area) or lost, and at least one is safe. Losing every survivor fails the objective |
| Retrieve | An object has been carried into the area |
| Destroy | Every listed nest has been destroyed |
| Extract | Every player who is standing and playing (not away, and active within the last 15 s) is inside the area at once, with at least one there, before the timer runs out; the timer stops while the whole squad is down. Running out of time fails the objective |

Optional objectives can be kill or interact objectives.

### How a mission runs

- Steps come one at a time. Each one completed gives 1,000 score to every player who has played in the last 60 seconds and pays its reward (section 6), the first time only.
- Optional objectives run from the start, alongside the steps. Each pays once when done: 1,500 score to every player who has played in the last 60 seconds, plus 150 XP and 150 Salvage (section 6), and it counts toward mastery (section 18). An optional kill objective counts every kill since the mission began. Every mission has one optional objective now.
- A step marked as a checkpoint saves progress when done and brings everyone back: players who bled out return, downed players get up, everyone is at full health, and utility charges and the Defibrillator refill. Players coming back, and players joining a mission under way, appear at the last checkpoint: the objective's area, or a point the mission names.
- A squad wipe returns to the last checkpoint, with that step started again. So does a **failed** objective: a survivor or defend target lost, or an extraction timer run out. What the steps from that checkpoint on use (their generators, terminals, survivors, carried object and defend target) goes back to how it started; the rest of the map (opened or broken doors, broken cover, spent barrels) stays as it is.
- Zombies arrive in a steady stream: the mission's spawn rate × the objective's spawn scale × the difficulty's enemy count × the squad-size scale, up to the mission's own cap (scaled the same way) and never more than 300 alive. They come from the spawn points of the map sections the current step names (every section when it names none). Nothing spawns while the whole squad is down.
- Zombies go for the nearest player, or for the current step's survivors, its defend target or a generator it is starting up when one of those is nearer. Only the current step's props draw zombies, and losing one fails only that step.
- **Gates** divide some maps into sections. A gate is a locked door that nobody can open, break or work; it opens when the objective the mission names is done, and it can close again behind the squad when a later step is done. When a gate closes, anyone left on the far side or standing in the doorway, survivors following the squad and objects still to be carried are brought to the gate's side point, and zombies shut out on the far side are gone.
- **Ambushes**: a step can name an ambush, a burst of extra zombies (its count scaled by difficulty and squad size, at least one) that arrives as the step starts, three a tick while fewer than 292 are alive.
- **Bosses**: a step can bring an elite (the Brute) onto the map when it starts, at a point the mission names or at a zombie spawn of the step's sections. While an elite is in view the HUD shows its name and a health bar.
- **Timed missions**: a mission may run against a clock (Landfall: 12 minutes). The time left shows in the objective panel, red in the last minute; when it runs out the mission is lost. Everyone keeps the XP, Salvage and items earned on the way, but there is no completion reward, result or final item.
- **Waypoint**: a marker shows where the current objective is, or the nearest nest, generator, survivor or object still to deal with. When it is out of view, an arrow on a ring around the middle of the screen points the way, with the distance.
- When the last step is done the mission is complete: the board is cleared and nobody can be hurt. Each player sees their results screen (time, score, kills, XP, Salvage, downs, items found, mastery) for 20 seconds while the squad is already back in the lobby; then the room closes.

### Objective rules (starting values)

| Objective | Rules |
|---|---|
| **Restore power** (interact) | Hold interact on a generator for 5 s to start it; it then runs up for 20 s with 400 HP, and zombies go for it. Broken while running up, it stops at full health and must be started again. In Survival a running generator has 75 s of fuel (its bar shows what is left, and its lamp blinks amber near the end); dry, it stops, its turrets and lights go dark, and it has to be started again. Blackout has three generators in the transformer yard, worked in any order; each also powers the turrets and floodlights wired to it |
| Terminal (interact) | Hold interact for 6 s |
| **Defend** | The target's health comes from the map (1,500 by default) and is restored to full when the defend step starts. Players repair it by holding interact (50 HP a second). Blackout: 70 s |
| **Rescue** | Survivors (150 HP) wait where the map puts them; holding interact for 2 s frees one. A freed survivor follows the player who freed them (or the nearest standing player once that one is down or gone), keeping 2.2 m back at up to 4.2 m/s; a survivor stuck for 3 s catches up beside them. Only zombies hurt survivors |
| **Retrieve** | Holding interact for 1 s picks the object up; a player carries one at a time and moves at 80 % speed. The object drops where its carrier goes down or leaves the mission, and stays there until someone picks it up |
| **Timed extraction** (extract) | Everyone standing gets into the area before its clock runs out: 40 to 90 s, set per mission |
| **Destroy nests** | A nest (2 × 2 m, 900 HP) sends out a zombie (Drudge 70 %, Crawler 30 %) every 4 s near the closest player while one is within 22 m, until it is destroyed. Only shots and explosions hurt it. A squad wipe or failed objective brings the step's nests back. Nests a mission does not use are not on the map |
| Hold terminal (planned) | Stand in a 5 m zone while a 120 s upload runs; the timer pauses when the zone is empty |
| Escort vehicle (planned) | A slow APC (2 m/s, 3,000 HP) that stops when no player is within 10 m |

How this differs from the brief's sketch, as the game stands: survivors do not panic or stop when zombies come near; a retrieve objective has one object, not several samples, and a dropped object has no timer sending it back; Defend protects one target rather than several barricades; the carrier is only slowed (sprinting is not in the game yet, so there is none to take away).

### Interactive environment

Interact (E) works the nearest usable prop within 1.6 m of its edge with a clear line to it: nothing is worked through a wall. A downed teammate in reach comes first (interact revives them). A press opens or closes a door or sets off a trap; a hold does the rest. A hold is worked by one player at a time and starts over when let go, except on generators and terminals, which keep their progress; repairs from several players add up. Generators, terminals, survivors and carried objects can be worked only while their step is the current one, or when they belong to an optional objective. The HUD says what pressing or holding E would do, with a progress bar for holds.

| Prop | Rules (starting values) |
|---|---|
| Explosive barrel | 30 HP, set off by shots and explosions. Deals 150 damage to zombies within 4 m (half at the edge) and breaks nearby cover, doors and barrels, which go off in turn. It hurts only the player who set it off, at half damage (75 at the centre, with the same falloff) |
| Crates, sandbags | Destructible cover, 200 and 400 HP: they block movement and shots, and players' shots and explosions break them. Zombies walk around them |
| Door | Press to open or close it, at most once every 0.6 s; it does not close on anyone standing in it. Hold on a closed door for 4 s to weld it. A closed door has 250 HP, a welded one 500; holding on a damaged welded door repairs it (50 HP a second). Zombies path through closed and welded doors and claw them down; players' shots and explosions break them too. A broken door stays open |
| Generator | See Restore power |
| Turret | A mounted M134 on a tripod that turns to what it fires at: 15 ballistic damage, 6 shots a second at the nearest zombie in sight within 14 m. On while its generator runs, always on when it has none; it cannot be destroyed. It helps a stand, it does not hold one alone |
| Floodlight | Lights its area while powered (by its generator, or always when it has none) |
| Trap | Press to set it off: 120 shock damage a second to zombies within 3 m for 5 s, then 30 s to recharge. It never hurts players |
| Ammo station | Hold for 1 s to refill the reserve of every gun to its maximum for 500 score (free in the firing range). The price comes out of the score a player has earned and not yet spent there; their score for rewards and thresholds is untouched. It does nothing while every gun is full, and the HUD shows the price when the player cannot pay yet |
| Terminal, survivor, carried object, defend target | See the objective rules above |

### Maps

Maps are drawn as text in the game data, one character per metre: walls, blockers (solid like walls but not drawn: they sit under scenery such as wrecks, cars and barriers), hedges and shipping containers (solid, drawn as such: touching cells make one hedge or one stack, cut into single containers in a few liveries), cracked walls, floor, player spawns, zombie spawns (numbered by map section), barrels, crates and sandbags. Scenery models are placed beside the drawing (position, rotation, size), some of them burning. Every zombie spawn is a hole in the ground the zombies climb out of; zombies come in off screen when a spawn point allows, and never closer than 8 m to a player. Named props (doors and gates, generators, terminals, turrets, floodlights, traps, survivors, carried objects, defend targets, nests) are listed beside the drawing. The maps now are Landfall (46 × 150 m), the Rail Yard (56 × 128 m), the Power Plant (60 × 136 m), the Food Depot (96 × 64 m), the Motor Pool (64 × 84 m), the Airfield (76 × 60 m), the Supermarket (64 × 104 m), Harrow General (80 × 80 m), Hill House (72 × 92 m), the Harrow Metro (64 × 150 m), Old Town (96 × 96 m), the Glasshouse (92 × 92 m) and the Docks (100 × 88 m) for Survival (and some contracts), the Crossroads (88 × 88 m), the Compound (56 × 56 m) and the Yard (64 × 48 m) for contracts, and the firing range. A mission may lay its own props on a map (the crates, terminals or shipment a contract needs), so one map serves Survival and several contracts.

**Secrets.** A cracked stretch of wall looks like the walls round it, with dark seams through it. It blocks like a wall until it is shot or blown down (240 points of damage; zombies leave it alone), then it caves in with a cloud of grit and everyone is told a secret has been found. Behind each is a room that is worth the trouble: an ammunition store, a cache, a generator that brings a dark turret to life, or a turret of its own.

**Old Town** (Survival): a walled old town at dusk, its town hall in the middle as the keep: four wings round a courtyard, a door on each side that can be shut and welded, the founder's statue in the courtyard and two mounted miniguns beside it that run off generators in the west and east wings (in Survival a generator runs out of fuel and has to be started again). A ring road goes round the hall with sandbag posts and shock traps where the four streets leave it for the town gates, where the dead come in. The quarters between the streets: the church with its pews, bell tower and a graveyard of headstones behind an iron gate (north-west); the covered market with its stalls and pillars, a café and the flats (north-east); the mill and its yard (south-west); three rows of terraced houses with lanes between them, and a garage (south-east). Three cracked walls: the church's bricked-up vestry (an ammunition store), a walled garden behind the mill with its own turret and generator, and a house in the lanes whose door was bricked over.

**The Glasshouse** (Survival): the town's botanical gardens after dark. The great palm house in the middle is the stand: four doors, palms in their beds, a fountain, and two turrets on generators in its corners. North of it a hedge maze with loops (so neither the dead nor the squad are funnelled down one path), the old rose garden at its heart with an ammo station. West, three long glasshouses of potted plants, the potting shed and the head gardener's cottage, bricked up (a cracked wall). East, the orangery with its columns and café terrace: the terrace turret has no power until someone finds the boiler room behind the orangery's cracked back wall and starts its generator. North-west the kitchen garden's raised beds, north-east the nursery's young trees in rows, south the lawns with oaks and birches, the bandstand, the rock garden and the main gate with its kiosks.

**The Docks** (Survival): a container port at night. In the middle the dock workers' fort, a square of containers with a shutter on each side and two turrets inside on generators; crane footings at its corners. North, the container stacks in a grid of lanes, one container welded shut with someone's stash in it (its rusted end cracks open). West, two warehouses with racks and roller doors, the south one's back office walled off. East, the truck park of wrecks and the weighbridge office. South, the harbour master's office, whose strongroom (behind a cracked wall) holds the generator for the quay turret, and the quay with its bollards, lifebuoys and cargo waiting to go aboard.

**The Crossroads** (contracts): a market town's crossroads at dusk, four quarters round a square, once Survival's only map. a market town's crossroads at dusk, four quarters round a square. The square is where a squad makes its stand: the town's horse statue in the middle with benches and planters round it, sandbag arcs facing each street, market stalls of crates and a coffee cart at its corners, an ammo station, and two mounted miniguns that wake when the generators in the church courtyard and the petrol station's back lot are started (and go dark when they run out of fuel). Hydrants, manholes, a café outside the flats and a payphone by the bus shelter make it a real town. Doors on the church, the pharmacy, the petrol station's shop and the garage can be shut and welded to hold a building; survivors have camped round a fire pit in the church courtyard. Shock traps sit where the streets open onto the square. Every quarter is somewhere to fall back to: the church with its pews, bell tower and courtyard (north-west); the flats and the pharmacy (north-east); the car park full of wrecks behind its fence (south-west); the petrol station, whose pumps stand among barrels that go up in a chain, its shop and its garage (south-east). Each quarter has an ammo station. Zombies climb out at the four streets' ends and in the quarters' back lots. Beyond every map's border wall the town goes on (drawing only): a street round the map, a ring of buildings of different heights with alleys, and parked and burnt-out cars, lamps and rubbish, so a map's edge is a wall in a town rather than the end of the world.

The data checks refuse a map or mission where:

- a prop that stands on cells is not on whole cells inside the map, or any prop overlaps a wall or another prop; a map has more than 4,096 props;
- a cache, an objective's area, a checkpoint point or a gate's side point is not on open floor;
- an objective names a prop of the wrong kind, or a section with no zombie spawns; a checkpoint step has neither an area nor a checkpoint point;
- a step cannot be done: its area or props cannot be reached from where the squad starts it (the spawn or the last checkpoint), with the gates as the earlier steps left them (walls and locked gates block; doors and cover do not, since they can be opened or broken);
- a gate is not a locked door, names an objective that is not a step, closes before it opens, or closes without a side point;
- an optional objective is not a kill or interact objective, or a mission has no steps;
- a kill objective names a zombie type that does not exist, a boss is not an elite or stands outside the map, or an ambush names an unknown type;
- a mission is in no campaign zone or listed twice, or the campaign names a mission that does not exist.

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

Plus **Wriggler** (parasite, 10 HP, from Hive and Matron) as a sub-enemy.

In the game now: Drudge, Bolter and Swell, plus three more that stand in for planned types with simpler rules: the **Crawler** (40 HP, 2.6 m/s, low and quick), the **Brute** (elite, 1,400 HP, 1.5 m/s, 38 melee damage; the missions' boss) and the **Screamer** (120 HP; every 9 s, with a player within 20 m, it screams and six zombies arrive: Drudge 60 %, Bolter 25 %, Crawler 15 %). Health and counts scale by difficulty (section 13).

### Mutation system

- **Stages**: each type has three mutation stages unlocked by zone progress and difficulty (stage 1 from zone 2 or Nightmare, stage 2 from zone 4 or Apocalypse, stage 3 Apocalypse zone 4+). A stage adds one ability, a resistance, or an attack pattern, and a visible change (growths, colour, glow). Example, Retcher: stage 1 spits twice; stage 2 acid slows; stage 3 spits a burst of three.
- **Adaptive mutations**: the server tracks the squad's damage by type and behaviour (turret share, time spent stationary, average distance to zombies) over the last two checkpoints. If one damage type exceeds 55 % of damage, later spawns shift toward a strain with resistance to it; if the squad camps, more Vaulters and Delvers; if it kites, more Bolters and Clutches.
- **Fairness**: resistances are capped at 35 % (never immunity, except the Cinder's inherent fire immunity); at most two adaptive strains active at once; every strain is announced in the HUD ("Strain adapted: fire-hardened") and shown on the zombie (a coloured crust); there is always a counter (another damage type, an ability, a utility).
- **Spawn director**: missions currently spawn a steady stream (section 7). The full director tracks an intensity score (damage taken, zombies within 10 m, time since last peak) and cycles build-up (60–90 s) → peak (20–40 s) → relief (20–30 s). Enemy budget per second scales with squad size and difficulty; specials have per-type cooldowns.

### Bosses

Three phases each (at 100 %, 66 %, 33 % health), telegraphed attacks (ground markings 0.8–1.5 s before impact), weak points, and one coordination mechanic. Health = `base × (0.55, 0.75, 0.9, 1.0)` for 1–4 players × difficulty multiplier.

Example, **The Warden** (zone 1): base 25,000 health. Phase 1: shield charge (telegraphed line), riot-baton slam (circle). Phase 2: calls Bulwarks; its back armour breaks only when hit from two sides within 3 s (solo: a decoy beacon counts as the second side). Phase 3: enraged, faster charges, tear gas zones. Weak point: the exposed spine after armour breaks.

## 9. Temporary buffs

Buffs drop in missions and Survival (never in the firing range). The server rolls them: 2 % chance per kill, 15 % from an elite, 50 % when a cache is opened, and at most one buff every 30 s per squad. A buff lies on the ground for 20 s; a standing player picks it up by walking over it (1.2 m). Team-wide buffs apply to the whole squad.

| Buff | Effect | Duration | Team |
|---|---|---|---|
| **Screen nuke** | Kills all non-elite zombies within 22 m; elites and bosses take 25 % of max health | instant | yes |
| **Max ammo** | Fills all main weapons to their upgraded maximum | instant | yes |
| **Double XP** | Doubles the class XP earned from kills, objectives, rounds, score and the completion reward (×2) | 60 s | yes |
| **Minigun** | Replaces your weapon with a minigun (45 damage, 1,200 rpm, unlimited ammo) | 20 s | no |
| Instakill | Every hit by a player kills non-elites | 15 s | yes |
| Speed boost | +30 % move speed | 15 s | yes |
| Freeze pulse | Freezes zombies within 15 m | 6 s | yes |
| Sentry | Deploys a turret (25 damage, 600 rpm, 14 m reach) | 30 s | no |
| Shield bubble (not in the game yet) | Stationary 5 m bubble that blocks zombies and projectiles | 10 s | yes |

## 10. Score multiplier

- A kill within **2.5 s** of the previous kill extends the chain. The chain sets the multiplier: ×1 (0–9 kills), ×2 (10), ×3 (25), ×4 (50), ×5 (100), ×6 (200).
- The chain lapses after 2.5 s without a kill and **resets when the player goes down**.
- Score is kept per player in missions and Survival (not in the firing range).
- Score per kill = zombie score value × multiplier (Drudge 10 … Colossus 1,000); each objective gives a flat 1,000 and each optional objective 1,500 (section 7).
- Score converts as it is saved (at checkpoints, rounds cleared and the end): 1 class XP per 20 score and 1 Salvage per 1,000 score, both × the difficulty's reward multiplier.
- Score thresholds (25,000, 75,000, 150,000, then every 150,000) pay a Salvage bonus (100 each, × the reward multiplier) and heal the player by exactly 30 % of their maximum health (healing bonuses do not change it).
- HUD: multiplier and chain timer in the top centre, large, with a draining bar; a chain whose timer has run out shows as 0.

## 11. Downed and revive

In a squad there are no lives: a player at zero health goes down and waits to be revived. Playing a campaign mission alone, a run has three lives; alone in a contract or in Survival, the first death ends it.

| Rule | Value |
|---|---|
| Zero health in a squad | The player is **downed**: crawls slowly, can use the pistol, and a bleed-out timer starts |
| Bleed-out timer | 30 s, minus 5 s for each earlier down since the player last came back (respawn, checkpoint or new round), minimum 15 s |
| Revive (hold interact within 1.5 m) | 4 s, Medic 2.5 s, skills down to 1.5 s; taking damage does not cancel it |
| Revived health | 30 % |
| Bled out, campaign mission | The player is out and spectates teammates; they return at the next checkpoint with full health |
| Bled out, Survival | Back at the start of the next round, if someone finishes the round |
| Bled out, contract | Back after 15 s, then 20 s, 25 s and 30 s for each later time (contracts have no checkpoints to wait for) |
| Squad wipe, campaign mission | Everyone downed or out at once: restart from the last checkpoint, with that objective begun again |
| Squad wipe, contract | The contract is failed ("Squad down"): no checkpoints to go back to |
| Squad wipe, Survival | The run ends and the results show the rounds survived |
| Zero health alone, campaign mission | A death: three lives a mission. The first two send the run back to the last checkpoint with full health; the third fails the mission. The HUD shows the lives left under the health bar |
| Zero health alone, contract or Survival | No lives: the first death ends it (contract failed, or the Survival run over) |
| Failed objective | A survivor or defend target lost, or an extraction timer run out: the same as a squad wipe (section 7); it does not cost a life |

## 12. Contracts and bounties

- **3 daily contracts** rotate at 00:00 UTC (1,500 Salvage each); **3 weekly contracts** rotate Monday 00:00 UTC (8,000 each). A countdown is shown.
- Examples: "Kill 200 zombies with shotguns", "Finish a mission with nobody bleeding out", "Revive 5 teammates", "Destroy 10 nests on Nightmare".
- **Bounties**: a named elite (e.g. *Old Ironjaw*, a mutated Ram) that appears in one mission at one difficulty this week; reward 5,000 and a title.
- Progress is counted by the server from match events. Missing a day costs nothing: no streaks, no penalties.

## 13. Lobby, difficulty and matchmaking

- Private lobbies by invite link, 6-character code, or the friends list; public quick match by mission and difficulty.
- The lobby shows each player's class, class level, loadout and avatar, with a ready check (all ready, or the host starts after a 10 s countdown).
- Disconnect grace period: 120 s (see `netcode.md`). Meanwhile the player's character is away: it stays where it is, holds no buttons, and an extraction does not wait for it.
- Idle in lobby: warning at 10 minutes, seat released at 12 minutes (queue rules in `architecture.md`).
- Communication: ping wheel (8 pings: here, enemy, defend, loot, help, revive me, go, wait) and 12 quick-chat phrases. No free text chat in version 1.

- The leader picks the mission (or Survival) and the difficulty; see section 2.

| Difficulty | Enemy health | Enemy damage | Enemy count | Mutation stage offset | Rewards |
|---|---|---|---|---|---|
| Recruit | ×0.8 | ×0.8 | ×0.8 | +0 | ×0.7 |
| Veteran | ×1.0 | ×1.0 | ×1.0 | +0 | ×1.0 |
| Nightmare | ×1.5 | ×1.2 | ×1.25 | +1 | ×1.35 |
| Apocalypse | ×2.2 | ×1.5 | ×1.5 | +2 | ×1.8 |

Squad-size scaling of enemy count: 1 player ×0.5, 2 ×0.7, 3 ×0.85, 4 ×1.0. A 4-player Apocalypse peak is capped at **300 zombies alive**.

## 14. Friends list

- Add by unique player name or an invite link (valid 7 days); accept, decline, remove, block.
- Status: online in lobby, in a mission (name), in the queue, in the firing range, offline (last seen).
- Invite to lobby; join a friend's lobby if it has a free slot.
- Recent players: the last 50 people you finished a mission with, with an "add friend" button.
- Presence is pushed (Valkey pub/sub → the player's push channel), never polled.

## 15. Firing range

A small map reached from the lobby. Target dummies (2,000 health, heal back three seconds after the last hit, never die), a spawner for zombie types, damage numbers on your own hits, and a damage-per-second meter over the last three seconds. Abilities recharge in one second and utilities never run out. Nobody goes down: health comes back instead. At most 60 spawned zombies at once. Nothing earned counts toward progression. It runs on the server like everything else, as a room of one.

Planned with the bestiary and later content: moving and armoured dummies with weak points, and limiting the spawner to types (and mutation stages) the player has already met.

## 16. Bestiary

An entry unlocks on a player's first kill of a type: the model (rotatable), behaviour notes, weaknesses and resistances, every mutation stage and adaptive strain the player has seen, and their kill count.

## 17. Achievements and cosmetics

About 60 achievements at launch (milestones, feats, mastery, bestiary completion). Rewards are cosmetics only: titles, profile banners, weapon skins, armour colours, extra DiceBear avatar styles. Cosmetics never change stats and are never sold.

## 18. Mission mastery

| Rating | Requirement (per mission, any difficulty from Veteran up) |
|---|---|
| Bronze | Complete |
| Silver | Complete under par time and at least 1 optional objective |
| Gold | Complete under 80 % of par, all optional objectives, the squad's total score at or above the target, and no more than 1 down across the squad |

- Recruit earns no mastery.
- The score target scales with squad size like the enemy count (target × 0.5, 0.7, 0.85 or 1.0 for 1–4 players).
- A mission without optional objectives asks for none.
- Each player keeps, per mission and difficulty, the number of completions, the best time, the best score and the best mastery reached; only players who took part (section 6) are credited.

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
