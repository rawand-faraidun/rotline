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
- The campaign so far is two zones of five missions each, every one a run against the clock (section 7): zone 1, **Ashgate**: **Ground Zero**, **Dead River**, **Blackout Protocol**, **The Crossroads**, **Iron Maw**; zone 2, **Harrow**: **Ghost Fleet**, **The Glass Labyrinth**, **Contagion Ward**, **The Traitor's Fall**, **Terminus**. The zone bosses are not in the game yet.
- Missions open in order: the first is always open, and each one opens when the player has completed the one before it at any difficulty (the next zone's first mission opens when the previous zone's last one is done). Locked missions are shown but cannot be chosen; the server checks when the leader chooses and again at the start, so a new leader who has not opened the squad's mission cannot start it.
- Survival is a mode of its own, always open, not a mission. The leader picks its map from three: Old Town, the Glasshouse and the Docks (section 15).
- **Contracts** are short jobs of three or four minutes outside the campaign, all open from the start, paid and ranked like missions (difficulty, par, mastery): **Hotspot** (kill all you can for three minutes with the nests awake), **Supply Run** (carry three supply crates to a drop-off), **Data Grab** (pull the data from four terminals, then get out) and **Shipment** (keep a weapons shipment in one piece for 150 s). Each contract runs on one of several maps, picked at random for every run: Hotspot on the Food Depot, the Crossroads, Old Town, the Glasshouse or the Docks; Supply Run on the Compound, the Docks or Old Town; Data Grab on the Compound, the Glasshouse or the Docks; Shipment on the Compound, Old Town or the Glasshouse. The job, its rules and its records stay the same; the place, the props it needs and where they stand change with the map.
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

**Levels:** 1–50 per class. XP to reach level *n* = `round(1000 × 1.12^(n−2))` (level 2 costs 1,000 XP, level 10 about 2,500, level 30 about 24,000). Each level grants 1 skill point up to level 20 and 2 from level 21, and levels 10, 20, 30, 40 and 50 grant 1 more: 85 points at level 50. Skills are priced by depth: a rank costs 1 point in tiers 1 and 2, 2 points in tiers 3 and 4 and 3 points in tier 5, so a whole tree costs about 120 points and a build is a real choice (the deep skills come later, when levels give more). Allocations saved under older prices are cut back automatically, deepest ranks first, and the points come free to spend again.

**Respec:** 2,250 Salvage per class (about 32 minutes of play at Veteran), refunding all points.

**Tier rule:** a tier opens after 5 points (at their prices) in the branch's earlier tiers (tier 5 needs 20). Each branch has 22 nodes and 24 ranks; most nodes have one rank, a few two. Node ids, effects and ranks are in `packages/game-data/data/skills/`.

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

### The story

Halden Agritech made a crop blight, BRIAR, to kill pests in the barley, and Minister Edwin Marlowe let them spray it on the fields round Ashgate a year before Dr Sana Vey, who made it, said it was safe. The barley went to Ashgate's food depot, the food went to the town, and the dead got up. The army drew a cordon round the town, the Rotline, and sent in recovery sections; the players are Lantern section. Their people on the radio: Major Ines Okafor (command), Kestrel (the pilot who keeps coming back for them), Corporal Wren (scout), and in Harrow Dr Vey herself.

The campaign follows the story mission by mission. **Ashgate:** Lantern section burns the food depot where the blighted grain germinated and takes its cultures for Vey (Ground Zero); walks a fuel tanker across Old Town's river for the evacuation (Dead River); restarts the power plant that keeps Vey's first patients alive, in the dark (Blackout Protocol); holds the Crossroads while the evacuation train, with Mila Pryce aboard, crosses the outer ring (The Crossroads); and breaks out of the fallen motor pool in an armoured carrier while Ashgate is burned behind it (Iron Maw). **Harrow:** the squad sinks Halden's spore barge in the harbour (Ghost Fleet); clears the botanical gardens where patient zero, the gardener Arthur Penn, caught it (The Glass Labyrinth); takes Penn's blood from the hospital's containment wing and finds the word LANTERN (Contagion Ward); blows Minister Marlowe out of his safe room for the codes to Halden's sealed lab (The Traitor's Fall); and makes the cure from Mila's blood in that lab under the metro and carries it up before the bombers reach Harrow (Terminus).

Every mission carries the story in its briefing, its radio lines (each objective has its own, from a named voice) and its debrief, and three **notes** lie about its map: a foreman's dispatch sheet, a harbour master's log, a minister's unsent letter. Walking over a note opens it to read; the browser remembers which have been found (n of 3 per mission). One note on most maps is inside the secret room.

**Light and dark.** Each map has an hour and weather: day, dawn, dusk, overcast, fog, night or dark. At dusk, at night and in fog the lamps burn, each with a pool of light on the ground and the nearest few lighting what stands near them. At night and in the dark every soldier carries a weapon light: a cone from the gun along the aim (yours casts shadows), and the soldier's own glow is faint. Dark maps (the Power Plant, Harrow General and the Metro: the power is out) are lit only by lamps, fires, floodlights on generators and weapon lights, so restarting a generator lights the way on.

### The missions

| # | Mission | Map | Steps | Optional |
|---|---|---|---|---|
| 1 | **Ground Zero** | Food Depot (96 × 64 m, dawn fog; three yards behind locked gates) | a 12-minute run: start the mill generator (it lights the yard); collect four of six grain cultures in the warehouse (gather); burn three growths in the silo bay (each bursts with six crawlers); plant thermite on the central silo, guard it 35 s and be 12 m clear; outrun the dust fire across the depot to the rail dock (escape); board Kestrel on the apron (45 s) | kill 180; burn the depot's own two nests |
| 2 | **Dead River** | Old Town (112 × 96 m, dusk) | a 12-minute run: break into the church crypt and bring the two tanker mechanics to the square; keep the dead off the fuel tanker while its steering is fixed (repair from 20 %); walk the tanker to the stone bridge (it stops dead while one of them is on it); hold the bridge winch 50 s while the drawbridge lowers, with a Brute crossing the shallows 25 s in; hunt three Screamers among the fuel barrels on the petrol station forecourt; fall back through the park gates (50 s) | kill 150; crack the mill's strongroom safe |
| 3 | **Blackout Protocol** | Power Plant (60 × 136 m, dark; four areas behind locked gates) | a 13-minute run: search the supervisors' desks for the breaker keycard; restart three generators in the switchyard (each lights a floodlight and wakes a turret); hold the capacitor ring 40 s with the squad's kit jammed; hunt the arc-burnt Brute (2.5 times a Brute's health) and its six Bolters in the turbine hall; outrun the substation fire past the cooling towers (escape); make the highway outpost (45 s) | kill 180; burn the two nests in the switchyard |
| 4 | **The Crossroads** | Crossroads (88 × 88 m, dusk) | a 12-minute stand: start the generators that wake the square's two miniguns; carry three ammunition crates from the pharmacy (deliver, pistol only while carrying); hold the square 60 s against the north surge; repair the radio relay from 15 %; keep it standing 50 s while two Brutes come in; fall back to the carrier on the north street (40 s) | kill 250 |
| 5 | **Iron Maw** | Motor Pool (64 × 84 m) | a 14-minute run: take the fuel depot and the watchtower (capture, 10 s each); get the armoured carrier running (repair from 25 %); walk it to the north gate (it stops dead while swarmed); blow the gate with its charge (25 s fuse, 12 m); hunt the column commander (four times a Brute's health); out through the breach (40 s) | kill 250; start both generators to wake the turrets |
| 6 | **Ghost Fleet** | Docks (106 × 92 m, fog) | a 12-minute run: search five customs containers for the manifest drive; get the two crane operators down to the camp; hold the crane console 45 s while it drops a container across the north road; charge the spore barge's valves at Pier 2 and get off the pier (35 s fuse, 14 m); hunt the colossus on the quay (three times a Brute's health) among ten crawlers; get to Kestrel at the harbour master's office (45 s) | kill 200 |
| 7 | **The Glass Labyrinth** | Glasshouse (108 × 96 m, night; the squad deploys at the main gate, the palm house is barred) | a 13-minute run: take the three lake drainage pumps (capture, 12 s each); search four research coolers in the hedge maze; hold the island gazebo 45 s against a Swell pack; blow the palm house's south door (20 s fuse); hunt the Screamer in the dome (five times its health); back out through the main gate (40 s) | kill 200; start the boiler room generator, which powers the shock traps on the promenade |
| 8 | **Contagion Ward** | Harrow General (80 × 80 m, dark; corridors behind locked gates) | a 14-minute run: clear the triage atrium (kill 45, Screamers among them); collect four of five frozen samples in the pathology labs (gather); mend the ICU's air scrubber from 20 %; hold Isolation Ward 3 for 45 s with the squad's kit jammed; get up the south corridor ahead of the purge gas (escape); out through the ambulance bay (40 s) | kill 250; burn the three nests in the morgue |
| 9 | **The Traitor's Fall** | Hill House and its gardens (72 × 92 m; every door of the house barred) | a 10-minute rescue: blow the barred front doors (18 s fuse); hunt the minister's three guards (four times a Drudge's health); search the study, the library and the cellar for the safe room override; walk the minister to the helipad; light the pad's four corners (capture, 9 s each) while a Brute comes out of the hedges 15 s in; on the chopper (35 s) | kill 200 |
| 10 | **Terminus** | Harrow Metro (64 × 150 m, dark; four areas behind locked gates) | a 13-minute run: take both stairheads (capture, 10 s each); open the track gates from the booth; through the stalled train ahead of the fire (escape); hold the lab airlock 45 s with the squad's kit jammed; start the synthesiser from two consoles; keep it running 60 s against two Brutes; carry the cure canister to the roof pad (pistol only); on the bird (45 s) | kill 200; burn the brood nest in the dead train |

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
| Gather | The squad has walked over a set number of the items lying about (sample cases, fuel cans, papers, supply crates); any of the listed spots count |
| Capture | Every area has been held: each fills while a standing player is in it and drains (at half the rate) while zombies hold it and nobody does; a full area stays taken |
| Escort | A vehicle has been driven to the end of its road: it drives while a standing, playing player is within its ring, at half speed while zombies are on it. Zombies go for it; losing it fails the objective |
| Search | What is wanted has been found: the step lists several spots (crates, car boots, lab benches) and picks which hold it when it starts, so it is somewhere else each run. Holding interact on a spot searches it |
| Hunt | Every marked zombie the step brings in is dead. Marked zombies carry a red marker and a health bar, may be tougher than their kind, and come in where the mission puts them (or from out of sight when a player stands there) |
| Demolish | A charge has been planted (hold interact), has stood while its fuse burned and gone off. The dead go for the planted charge; losing it fails the objective. The blast kills what is near, hurts any player still inside it and destroys the props the mission sets it against (a gate, a door, a brood) |
| Repair | Every listed target or vehicle has been brought back to full health (hold interact) from the share of its health the step leaves it at. The dead go for each until it is mended; losing one fails the objective |
| Deliver | Every listed object has been carried into the area, one at a time |
| Escape | Every player who is standing and playing is in the area. A hazard (a wall of fire or of gas) waits a few seconds, then sweeps across the map from one side; everyone behind its front takes damage every second, and zombies behind it burn |
| Extract | Every player who is standing and playing (not away, and active within the last 15 s) is inside the area at once, with at least one there, before the timer runs out; the timer stops while the whole squad is down. Running out of time fails the objective |

Optional objectives can be kill, interact or destroy objectives. A mission's nests that are not one of its steps are optional: they keep sending out zombies until they are burned. A destroy objective may make each nest burst with crawlers as it dies.

A mission can deploy the squad somewhere other than the map's own spawn (the Glass Labyrinth starts at the gardens' main gate).

Any step can be **jammed**: while it runs nobody can use an ability (utilities still work), and the HUD shows the abilities as jammed. Any step can bring a boss in when it starts, not only a kill objective (Dead River's Brute crosses the shallows 25 s into the defence of the bridge winch).

Carried objects, survivors, vehicles, search spots and charges that a map holds for other missions are not there in a mission that does not use them.

### How a mission runs

- Steps come one at a time. Each one completed gives 1,000 score to every player who has played in the last 60 seconds and pays its reward (section 6), the first time only.
- Optional objectives run from the start, alongside the steps. Each pays once when done: 1,500 score to every player who has played in the last 60 seconds, plus 150 XP and 150 Salvage (section 6), and it counts toward mastery (section 18). An optional kill objective counts every kill since the mission began. Every mission has one or two optional objectives.
- A step marked as a checkpoint saves progress when done and brings everyone back: players who bled out return, downed players get up, everyone is at full health, and utility charges and the Defibrillator refill. Players coming back, and players joining a mission under way, appear at the last checkpoint: the objective's area, or a point the mission names.
- A squad wipe returns to the last checkpoint, with that step started again. So does a **failed** objective: a survivor or defend target lost, or an extraction timer run out. What the steps from that checkpoint on use (their generators, terminals, survivors, carried object and defend target) goes back to how it started; the rest of the map (opened or broken doors, broken cover, spent barrels) stays as it is.
- Zombies arrive in a steady stream: the mission's spawn rate × the objective's spawn scale × the difficulty's enemy count × the squad-size scale, up to the mission's own cap (scaled the same way) and never more than 300 alive. They come from the spawn points of the map sections the current step names (every section when it names none). Nothing spawns while the whole squad is down.
- Zombies go for the nearest player, or for the current step's survivors, its defend target or a generator it is starting up when one of those is nearer. Only the current step's props draw zombies, and losing one fails only that step.
- **Gates** divide some maps into sections. A gate is a locked door that nobody can open, break or work (a map's own gates, or any door a mission chooses to bar); it opens when the objective the mission names is done, and it can close again behind the squad when a later step is done. When a gate closes, anyone left on the far side or standing in the doorway, survivors following the squad and objects still to be carried are brought to the gate's side point, and zombies shut out on the far side are gone.
- **Ambushes**: a step can name an ambush, a burst of extra zombies (its count scaled by difficulty and squad size, at least one) that arrives as the step starts, three a tick while fewer than 292 are alive.
- **Bosses**: a step can bring an elite (the Brute) onto the map when it starts, or a set number of seconds into it, at a point the mission names or at a zombie spawn of the step's sections. Every elite carries its own health bar over its head; while one is in view the HUD also shows its name and the health of the most hurt one.
- **Timed missions**: a mission may run against a clock (Ground Zero: 12 minutes). The time left shows in the objective panel, red in the last minute; when it runs out the mission is lost. Everyone keeps the XP, Salvage and items earned on the way, but there is no completion reward, result or final item.
- **Waypoint**: a marker shows where the current objective is, or the nearest nest, generator, survivor or object still to deal with. When it is out of view, an arrow on a ring around the middle of the screen points the way, with the distance.
- When the last step is done the mission is complete: the board is cleared and nobody can be hurt. Each player sees their results screen (time, score, kills, XP, Salvage, downs, items found, mastery) for 20 seconds while the squad is already back in the lobby; then the room closes.

### Objective rules (starting values)

| Objective | Rules |
|---|---|
| **Restore power** (interact) | Hold interact on a generator for 5 s to start it; it then runs up for 20 s with 400 HP, and zombies go for it. Broken while running up, it stops at full health and must be started again. In Survival a running generator has 75 s of fuel (its bar shows what is left, and its lamp blinks amber near the end); dry, it stops, its turrets and lights go dark, and it has to be started again. Blackout has three generators in the transformer yard, worked in any order; each also powers the turrets and floodlights wired to it |
| Terminal (interact) | Hold interact for 6 s |
| **Defend** | The target's health comes from the map (1,500 by default) and is restored to full when the defend step starts. Players repair it by holding interact (50 HP a second). Blackout: 60 s |
| **Rescue** | Survivors (150 HP) wait where the map puts them; holding interact for 2 s frees one. A freed survivor follows the player who freed them (or the nearest standing player once that one is down or gone), keeping 2.2 m back at up to 4.2 m/s; a survivor stuck for 3 s catches up beside them. Only zombies hurt survivors |
| **Retrieve** | Holding interact for 1 s picks the object up; a player carries one at a time, moves at 80 % speed and can use only the pistol. The object drops where its carrier goes down or leaves the mission, and stays there until someone picks it up |
| **Timed extraction** (extract) | Everyone standing gets into the area before its clock runs out: 40 to 90 s, set per mission |
| **Destroy nests** | A nest (2 × 2 m, 900 HP) sends out a zombie (Drudge 70 %, Crawler 30 %) every 4 s near the closest player while one is within 22 m, until it is destroyed. Only shots and explosions hurt it. A squad wipe or failed objective brings the step's nests back |
| **Gather** | Walking within 1.1 m of an item picks it up; there is nothing to hold. A mission lists more spots than it needs (four of five, five of six), so the squad can choose its route. A restart from a checkpoint puts every item back |
| **Capture** | Areas of 2 to 3 m, 9 to 12 s each, set per mission; the areas fill one at a time for a squad of one, or side by side for a squad that splits up |
| **Search** | 2.5 s of holding interact a spot. One spot to find among five, set per mission |
| **Hunt** | Targets of any kind, up to eight, each up to 40 times its kind's health (Iron Maw's commander four times a Brute's, the Glass Labyrinth's Screamer five times its own) |
| **Demolish** | 3 s to plant; the charge has 700 HP; fuses of 15 to 40 s and blasts of 5 to 10 m, set per mission; 2,000 damage to zombies at the middle and 140 to players, less toward the edge. The blast's reach shows as a red circle round the armed charge |
| **Repair** | 50 HP a second from each player holding interact (repairs add up); targets of 800 to 1,500 HP starting at 15 to 20 % |
| **Escort** | A vehicle (900 to 1,400 HP, set per mission) drives along a road of points at 1.8 to 2.2 m/s while someone is within 7 to 8 m of it, and at half that while a zombie is within 1.8 m (or not at all, for a vehicle that stops). Players repair it by holding interact (50 HP a second). Its ring and the road ahead show on the ground |
| **Escape** | The front starts behind the squad, waits 6 to 8 s, then moves at 1.2 to 1.8 m/s; behind it players take 22 to 30 damage a second and zombies twice that. It is drawn as a line of flames with smoke rolling back over the scorched ground (or a bank of green gas), lit by its own light |

How this differs from the brief's sketch, as the game stands: survivors do not panic or stop when zombies come near; a retrieve objective has one object, not several samples, and a dropped object has no timer sending it back; Defend protects one target rather than several barricades; the carrier is slowed to 80 % and holds only the pistol (back to the gun they held when the object is set down).

### Interactive environment

Interact (E) works the nearest usable prop within 1.6 m of its edge with a clear line to it: nothing is worked through a wall. A downed teammate in reach comes first (interact revives them). A press opens or closes a door or sets off a trap; a hold does the rest. A hold is worked by one player at a time and starts over when let go, except on generators and terminals, which keep their progress; repairs from several players add up. Generators, terminals, survivors, carried objects, search spots and charges can be worked only while their step is the current one, or when they belong to an optional objective. The HUD says what pressing or holding E would do, with a progress bar for holds.

| Prop | Rules (starting values) |
|---|---|
| Explosive barrel | 30 HP, set off by shots and explosions. Deals 150 damage to zombies within 4 m (half at the edge) and breaks nearby cover, doors and barrels, which go off in turn. It hurts only the player who set it off, at half damage (75 at the centre, with the same falloff) |
| Crates, sandbags | Destructible cover, 200 and 400 HP: they block movement and shots, and players' shots and explosions break them. Zombies walk around them |
| Door | Press to open or close it, at most once every 0.6 s; it does not close on anyone standing in it. Hold on a closed door for 4 s to weld it. A closed door has 250 HP, a welded one 500; holding on a damaged welded door repairs it (50 HP a second). Zombies path through closed and welded doors and claw them down; players' shots and explosions break them too. A broken door stays open |
| Generator | See Restore power |
| Turret | A mounted M134 on a tripod that turns to what it fires at: 15 ballistic damage, 6 shots a second at the nearest zombie in sight within 14 m. On while its generator runs, always on when it has none; it cannot be destroyed. It helps a stand, it does not hold one alone |
| Floodlight | Lights its area while powered (by its generator, or always when it has none) |
| Trap | Press to set it off: 120 shock damage a second to zombies within 3 m for 5 s, then 30 s to recharge; while it fires, arcs of lightning crackle between its four coils. It never hurts players. A trap wired to a generator works only while that generator runs |
| Ammo station | Hold for 1 s to refill the reserve of every gun to its maximum for 500 score (free in the firing range). The price comes out of the score a player has earned and not yet spent there; their score for rewards and thresholds is untouched. It does nothing while every gun is full, and the HUD shows the price when the player cannot pay yet |
| Terminal, survivor, carried object, defend target | See the objective rules above |

### Maps

Maps are drawn as text in the game data, one character per metre: walls, blockers (solid like walls but not drawn: they sit under scenery such as wrecks, cars and barriers), water (walked round, shot across, drawn with ripples and a stone kerb), hedges and shipping containers (solid, drawn as such: touching cells make one hedge or one stack, cut into single containers in a few liveries), cracked walls, floor, player spawns, zombie spawns (numbered by map section), barrels, crates and sandbags. Scenery models are placed beside the drawing (position, rotation, size), some of them burning, and patches of other ground are laid over the map's own: lawns, gravel walks, cobbles, paving, forest floor, and wooden or tiled floors inside buildings, so a building reads as a building from above. Every zombie spawn is a hole in the ground the zombies climb out of; zombies come in off screen when a spawn point allows, and never closer than 8 m to a player. Named props (doors and gates, generators, terminals, turrets, floodlights, traps, survivors, carried objects, defend targets, nests) are listed beside the drawing. The campaign plays on the Food Depot (96 × 64 m), Old Town (112 × 96 m), the Power Plant (60 × 136 m), the Crossroads (88 × 88 m), the Motor Pool (64 × 84 m), the Docks (106 × 92 m), the Glasshouse (108 × 96 m), Harrow General (80 × 80 m), Hill House (72 × 92 m) and the Harrow Metro (64 × 150 m), each with the props its mission lays on it. Old Town, the Glasshouse and the Docks are also Survival's maps, and the Crossroads, the Docks, the Glasshouse, Old Town, the Food Depot and the Compound (56 × 56 m) carry the contracts. Landfall, the Rail Yard, Elm Close, the Airfield and the Supermarket, built for earlier campaigns, are in the game data but not played now. The Yard (64 × 48 m) is a bare arena the tests use, and there is the firing range.

**Maps as places.** Every map built for the campaign, past and present, is drawn as the place it is: Landfall runs from the wreck in the fields (its cargo spilled across them, burning) up a high street of shops with back lanes and alleys, through the army checkpoint, across the town square and its fountain into the hospital car park; the Rail Yard from the station and its platform through the container stacks and the gantry crane, the signal yard's turntable pit and engine shed, to the convoy road between the goods warehouses; Blackout from the approach road over the stream, past the car park and the guard post, through the transformer yard and the turbine hall to the cooling towers; Breakout inside the motor pool's fence, with its vehicle sheds, fuel depot, workshop, barracks, parade ground and watchtowers, and the road out through the woods; Airlift on an apron between the hangar, the old control tower, the fuel farm and the terminal; Hive across the supermarket's car park, its aisles of shelving and its loading yard; Lifeline through Harrow General's wards of beds, offices and atrium; Cure from the stadium's landing zone through the tiled station, the platforms and the labs. Buildings have floors (wooden, tiled, concrete) and furniture along their walls (beds, desks, kitchens, shelving, vending machines), machinery stands where it would (turbines, transformers, generators, storage tanks), and woods, water and fences hide each map's edge. A mission may lay its own props on a map (the crates, terminals or shipment a contract needs), so one map serves Survival and several contracts.

**Secrets.** A cracked stretch of wall looks like the walls round it, with dark seams through it. It blocks like a wall until it is shot or blown down (240 points of damage; zombies leave it alone), then it caves in with a cloud of grit and everyone is told a secret has been found. Behind each is a room that is worth the trouble: an ammunition store, a cache, or a generator that brings dark floodlights to life. Every campaign map has at least one, off the main path (a bricked-up vault off Landfall's high street, the Rail Yard's station master's office, the Power Plant's old guard post, the Motor Pool's quartermaster's store, the Airfield's old control tower, the Supermarket's cold store, Harrow General's morgue, the Metro staff's rest room, Hill House's gardener's bothy, a bricked-up house in Elm Close), each holding a cache and an ammo station.

**Old Town** (Survival): a river town at dusk. The river comes in from the west, bends south past the mill and runs out east; two bridges and a footbridge cross it, so there is always a way round. North of it the church and its cobbled square, where the squad starts by the fountain (the town's founder on his horse in a pool), planters and lamps breaking it up; the pharmacy and the bakery west of it, the hotel east, the terraces up Bridge Street, the quay along the water. South of it the park with its pond and bandstand, the fenced allotments, the mill at the bend and Mill Road's houses and petrol station (barrels by the pumps go up in a chain). Woods close it in. Secrets: the church crypt behind the vestry's cracked wall, the mill's sluice room, and a house on Mill Road its owner bricked up.

**The Glasshouse** (Survival): the botanical gardens after dark, round their lake. The tiled palm house stands above the lake: four doors, palms in their beds round a pool. A gravel walk goes all the way round the water and two footbridges cross it by the island and its gazebo, so there is always a loop to run. West the hedge maze with the old rose garden at its heart; south-west the nursery's long glasshouses and the head gardener's cottage (bricked up); east the orangery, its café terrace and the boiler room behind it (a cracked wall); south-east the rock garden and its pond and the old ice house (a cracked wall); south the main gate and its kiosks. Woods all round.

**The Docks** (Survival): a container port at night, on the water. The harbour wraps the south and east sides: three piers run out into it and a barge stacked with containers lies at the middle one. Along the water the quay, its bollards and cargo, and the harbour master's office (its strongroom, with the quay floodlights' generator, is bricked up behind a cracked wall). In the middle the dock workers' camp, a rough ring of containers round the crane's legs, where the squad starts. North the container stacks in staggered lanes (one welded shut, rust cracking its end); north-east two warehouses with racks and roller doors; west the gatehouse, the truck lane and the fence.

Survival maps have no turrets: what holds the line is the squad, the ammo stations, floodlights on generators (which run out of fuel), shock traps and barrels. Every map's edge is hidden under woods, buildings, water or fences, so a map is a place with a shape, not a box.

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
