# @rotline/game-server

## 0.7.0

### Minor Changes

- 045856e: New maps, secrets to find, and dying that fits each mode:
  
  - **Survival on three new maps, your pick:** **Old Town**, a walled river town held from its town hall; **the Glasshouse**, the botanical gardens with a hedge maze and the great palm house; and **the Docks**, a container port at night with a fort of containers in the middle. Choose one under Game modes.
  - **Contracts move around:** each contract runs on one of several maps, picked at random every time, including the new ones and the old Crossroads.
  - **Secrets:** cracked walls hide rooms. Shoot or blow one down to find an ammunition store, a hidden turret, or a generator that wakes a dark one. The game tells the squad when a secret is found.
  - **Lives only in the campaign:** playing a campaign mission alone you still have three lives; in contracts and Survival the first death (or a squad wipe) ends it.
  - **Sound you can trust:** when the browser holds the sound back or it is muted, a note on screen says so and how to fix it.
  - New scenery: trees, palms, hedges, shipping containers, garden and household furniture.
  - **Missions worth exploring:** every campaign map now hides a bricked-up room with a cache and an ammo station behind a cracked wall. **Holdouts** moves to **Elm Close**, a barricaded street of houses and back gardens with a school at the end; **The Minister**'s house now stands in formal gardens with hedges, rose beds and lawns. The old food depot joins the contract maps.
  - Lawns, gravel walks and terraces are now drawn on the ground where a map calls for them.
- a5a77cf: - **A new campaign, ten missions on ten different maps.** Ashgate: Ground Zero (burn the blighted food depot), Dead River (walk a fuel tanker across Old Town's river), Blackout Protocol (the power plant in the dark), The Crossroads (hold the square while the evacuation train crosses) and Iron Maw (break out of the motor pool in an armoured carrier). Harrow: Ghost Fleet (sink Halden's spore barge in the docks), The Glass Labyrinth (the botanical gardens where patient zero caught it), Contagion Ward (the hospital's containment wing), The Traitor's Fall (blow the minister out of his barred house) and Terminus (make the cure under the metro). Your progress and unlocks carry over, mission by mission.
  - **New things to do in them:** search spots for what you need (somewhere else each run); hunt down marked, tougher zombies; plant a charge, guard it through its fuse and get out of the blast; repair things while the dead tear at them; carry loads one at a time (with only your pistol in hand); walk a tanker or an armoured carrier that stops dead when they climb on it; take and hold areas; outrun a line of fire or a bank of gas; hold out with your abilities jammed; Brutes that turn up halfway through a fight; traps that only work once their generator is running. Every mission has its own briefing, radio voices, notes to find and debrief.
  - **Real vehicles:** the fuel tanker and the armoured carrier are proper models.
  - **The fire and the gas look like fire and gas:** a burning line with smoke rolling back over the scorched ground, and it no longer starts on top of you.
  - **The game stops when it ends:** you can no longer walk about after a mission is won or lost.
  - **Every Brute has its own health bar** over its head, so two at once are easy to tell apart.
  - **Reloading no longer shifts the weapon list:** the reload sign sits over the weapon.
  - **Every bullet is its own tracer:** machine guns and miniguns now show each round flying, so what you see matches the ammo counter.
  - **Shock traps crackle:** arcs of lightning jump between the coils while a trap fires.
  - The Food Depot is now at dawn in fog, and the fences round the power plant's transformer yard stand up properly.
- 111bffc: - **Damage numbers everywhere:** what you hit shows how much it took, zombies and cover, doors and walls alike. Switch them off in the pause menu (the firing range always shows them).
  - **Skills have prices:** a rank costs 1 point in the first two tiers, 2 in the middle tiers and 3 at the top. Levels give 2 points each from level 21 (85 by level 50), so the deep skills come as you level. Skills chosen under the old prices are cut back from the top where they no longer fit, and the points are yours to spend again.
  - **Big hordes run smoother:** zombies and bodies off screen are no longer drawn, and laptops draw the horde more cheaply.
  - No more puddles on the ground.
  - **Survival maps rebuilt as real places, with no turrets:** Old Town is now a river town with bridges, a church square, a park and a mill; the Glasshouse wraps round a lake with a walk all the way round it; the Docks sit on the water with piers, a barge and a camp round the crane. Woods, water and fences give every map a shape instead of a box.
  - **A fresh look for the world:** rivers and ponds you walk round but can shoot across, wooden and tiled floors inside buildings, cobbles, paving, gravel and lawns, real sandbags, and scenery drawn far more cheaply so maps can hold much more of it.
  - **Campaign maps rebuilt as real places:** Landfall's high street and town square, the Rail Yard's station and signal yard, the power plant's transformer yard and turbine hall, the motor pool inside its fence, the airfield's apron, the supermarket's aisles and Harrow General's wards are drawn as the places they are, with floors, furniture, machinery, woods and water. Hotspot now opens on the old food depot.
  - **A story worth playing:** every campaign mission now has its own briefing, named voices on the radio for every step, and a debrief that moves the story on: Halden's blight, the Rotline, Dr Vey, the girl who never turned, and the minister who started it. Three notes lie about each map (a diary, a ledger, a letter) to find and read; one is usually in the secret room.
  - **Night and dark:** maps now have their own hour and weather (day, dawn, dusk, overcast, fog, night, dark). After dark the street lamps burn and light the ground, and every soldier carries a weapon light. Blackout, Lifeline and Cure are dark: the lights come back as you restart the power.
  - **Rail Yard:** you now keep the points motor running while the refugee train crosses.
  - Smaller damage numbers and slimmer tracers, blood no longer flickers on paths and floors, models no longer flare white, zombies no longer climb out where they get stuck, generators stand where you can defend them, furniture sits properly against walls, and leaving a game no longer ends on an error page.

### Patch Changes

- @rotline/game-data@0.7.0
  - @rotline/protocol@0.7.0
  - @rotline/sim@0.7.0
  - @rotline/state@0.7.0
  - @rotline/ticket@0.7.0

## 0.6.0

### Minor Changes

- 91cc3f1: Dying has rules for every mode:
  
  - **Playing alone, a run has three lives.** The first two deaths send you back to the last checkpoint (in Survival the round starts again); the third loses the mission or ends the run. The lives left show under the health bar.
  - **In a squad, nothing changes:** a downed player waits to be revived. Each down shortens the next bleed-out until the player comes back (a respawn, a checkpoint or a new round). A bled-out player returns at the next checkpoint in missions and at the next round in Survival.
  - **Contracts bring the fallen back on a timer:** contracts have no checkpoints, so a bled-out player returns after 15 seconds, then 20, 25 and 30 for each later time.
  
  The Crossroads looks like a real town and plays fairer: a horse statue, benches, planters, hydrants, manholes, a café, a coffee cart, a payphone and a survivors' camp; doors on the church, pharmacy, shop and garage to shut and weld. Map turrets are now mounted miniguns that turn to what they shoot, hit less hard, and in Survival their generators run out of fuel after 75 seconds and must be started again, so they help a stand instead of winning it.
  
  Fewer surprises: hovering a menu no longer counts as asking for a seat, and a failed seat check no longer bounces you between the queue and the game; the server is judged overloaded only when many ticks run slow, not on one spike. Shaders are compiled up front, so the first explosion or flame no longer freezes a frame, and the frame-rate guard changes resolution less often.

### Patch Changes

- @rotline/game-data@0.6.0
  - @rotline/protocol@0.6.0
  - @rotline/sim@0.6.0
  - @rotline/state@0.6.0
  - @rotline/ticket@0.6.0

## 0.5.0

### Patch Changes

- 6f108cd: Squads, friends, the HUD and frame rate:
  
  - **Squads deploy together**: when the leader starts, every member now follows into the mission from any lobby screen (it used to need going to the mission page by hand), and friends coming online or going offline show up without refreshing.
  - **A Friends screen**: search players by any part of a name or a close spelling, add by name or player code, manage requests, friends, recent squadmates and blocks.
  - **Player codes**: every player has a code to hand out; the code and an add-me link can be copied or sent from the device's share sheet, and so can the squad invite link.
  - **Minimap**: top right, with walls, closed doors, every zombie, the squad and the objective; click it or press M for the whole map.
  - **Teammate arrows** at the screen's edge point to squadmates out of view, with name and distance.
  - **Mouse-wheel zoom**: a little closer or further out, remembered.
  - **Zombies no longer catch on the edges** of walls and cover: they go round instead of pressing into them.
  - **Faster on laptops**: built-in graphics get a new Medium quality (no ambient occlusion or bloom, one pixel per screen pixel, lighter shadows), a frame-rate guard lowers the resolution when frames drop under 50 a second, and soldiers in missions use a lighter model (the lobby and armory keep the detailed one).
- @rotline/game-data@0.5.0
  - @rotline/protocol@0.5.0
  - @rotline/sim@0.5.0
  - @rotline/state@0.5.0
  - @rotline/ticket@0.5.0

## 0.4.3

### Patch Changes

- @rotline/game-data@0.4.3
  - @rotline/protocol@0.4.3
  - @rotline/sim@0.4.3
  - @rotline/state@0.4.3
  - @rotline/ticket@0.4.3

## 0.4.2

### Patch Changes

- @rotline/game-data@0.4.2
  - @rotline/protocol@0.4.2
  - @rotline/sim@0.4.2
  - @rotline/state@0.4.2
  - @rotline/ticket@0.4.2

## 0.4.1

### Patch Changes

- @rotline/game-data@0.4.1
  - @rotline/protocol@0.4.1
  - @rotline/sim@0.4.1
  - @rotline/state@0.4.1
  - @rotline/ticket@0.4.1

## 0.4.0

### Minor Changes

- f9f0897: A second zone, contracts, and a new Survival map:
  
  - **Harrow**, five new campaign missions after Ashgate, each on its own map: **Airlift** (hold a grounded transport while its ramps are fixed), **Hive** (burn a supermarket's pods and nests, then the egg in the loading yard), **Lifeline** (four corridors to four switch rooms in a dark hospital), **The Minister** (get a minister out of a mansion's safe room to the helipad) and **Cure** (down through the metro and a stopped train to the labs, and carry the cure to the roof pad).
  - **Contracts**: short jobs of three or four minutes, all open from the start: Hotspot, Supply Run, Data Grab and Shipment.
  - **Game modes have their own place**: the mission picker has separate Campaign and Game modes tabs, and the lobby groups Survival, Contracts and the firing range under Game modes.
  - **Survival moves to the Crossroads**: a market town's square with sandbag arcs and turrets, and four quarters to fall back to: a church, flats and a pharmacy, a car park, and a petrol station whose pumps go up in a chain. Later rounds bring every kind of zombie, and every fifth round brings Brutes.

### Patch Changes

- @rotline/game-data@0.4.0
  - @rotline/protocol@0.4.0
  - @rotline/sim@0.4.0
  - @rotline/state@0.4.0
  - @rotline/ticket@0.4.0

## 0.3.0

### Minor Changes

- 72fee0a: Ammo stations: supply cases on every map. Hold E at one to refill the reserve ammo of all your guns for 500 of the score you have earned this mission (free in the firing range). Spending never lowers the score your rewards come from.
- 2a627d6: Every mission reworked as a run against the clock on its own map, each with somewhere beyond its walls:
  
  - **Rail Yard** (was Yard Sweep): carry the switch keys off the platform, burn the nests in the container stacks, open the gate with the crane generator, throw the points in the signal box, kill the Brute in the turntable pit and hold the convoy road.
  - **Blackout** (was Power Out), on the new Power Plant: open the fence on the backup generator, restart three generators that wake the yard's turrets, keep the transformer running, reroute the grid from the control room, kill the Brute in the turbine hall and get out past the cooling towers.
  - **Holdouts** (was Survivors): the Food Depot redrawn with a truck lot, pallet racking, a cold room, a stair landing and a loading dock, scenery throughout and a 15-minute clock.
  - **Breakout** (was Last Stand), on the new Motor Pool: hold a sandbagged centre, start the generators that wake its turrets, break the waves and two Brutes, then out through the north gate.
  
  Missions later in the campaign now face stronger zombies (levels 1, 3, 5, 6 and 7). Mission progress and records are kept.

### Patch Changes

- @rotline/game-data@0.3.0
  - @rotline/protocol@0.3.0
  - @rotline/sim@0.3.0
  - @rotline/state@0.3.0
  - @rotline/ticket@0.3.0

## 0.2.0

### Minor Changes

- d58e0ad: A game that feels like a zombie shooter:
  
  - Sound actually plays: recorded gunshots per weapon, impacts, zombie voices and body falls.
  - Soldiers hold every gun at its own grip and handguard, with longer arms that reach; the low ready at ease, a pistol out in front, the minigun at the hip.
  - Zombies fall where they die and lie there a while; grenades and launchers explode in fire, smoke, sparks and a scorch mark; flamethrowers throw burning fuel and set zombies alight.
  - Pickups are real things on the ground (an ammo can, C4, dog tags, a syringe, a sentry…); sentries are turrets that face their aim, mines are claymores, decoys a radio, barricades sandbags.
  - Vests fit the chest, armour colours show, the armory filters by slot with every slot in one row, the shop shows one section at a time, and dragging turns the soldier the right way.
  - Loading never hangs on a paused room, the firing range opens again at once, and a slow load offers to try again.

### Patch Changes

- @rotline/game-data@0.2.0
  - @rotline/protocol@0.2.0
  - @rotline/sim@0.2.0
  - @rotline/state@0.2.0
  - @rotline/ticket@0.2.0

## 0.1.0

### Minor Changes

- 54a901c: Abilities and the firing range:
  
  - All 18 class abilities work in missions: slot them in the skill tree and use them with F, C and V (Adrenaline Burst, Slide Dash, Cluster Grenade, Breaching Charge, Mark Target, Overwatch, Medkit Drop, Healing Field, Toxin Grenade, Antidote Shot, Stim, Defibrillator, Deploy Barricade, Taunt, Aerial Bombardment, Mortar Shot, Shock Pulse, Minigun Spin-up).
  - Utilities on G and T: frag, incendiary and shock grenades, sticky mines, decoy beacons and the mini-sentry. Charges refill every wave.
  - The capstones (Momentum, Shrapnel, Executioner, Second Wind, Contagion, Last Rites, Aftershock, Suppression) do what they say.
  - Zombies can be stunned, slowed, marked, poisoned and taunted, and show it.
  - The firing range: target dummies, spawn any zombie type, damage numbers and a damage meter; no cooldowns, nothing counts.
- 9693103: The Ashgate campaign:
  
  - Missions now come in order and open one after another: Landfall, Yard Sweep, Power Out, Survivors and Last Stand. Survival is always open.
  - Three new maps of different sizes: Landfall (small), the Substation and the Depot (large, in sections behind gates that lock behind you).
  - Things to use in the world: explosive barrels, crates and sandbags you can shoot apart, doors you open, close and weld shut (zombies break them down), generators that power turrets and floodlights, traps, terminals, survivors to free and walk to safety, objects to carry, and targets to defend.
  - New objectives: restore power, defend, rescue, carry, and timed extractions. Optional objectives pay extra and count toward mastery.
  - The game tells you what holding or pressing E will do, with a progress bar for longer jobs.
- b2004ea: First playable build:
  
  - Sign in with GitHub or Google, pick a player name and a generated avatar, and wait in the lobby.
  - Deploy into a solo mission on The Yard: move, aim and shoot with the Vex-9, K-71 and the P9 pistol (unlimited reserve), reload and switch weapons.
  - Waves of Drudges, Bolters and Swells find their way around walls; Swells burst and leave acid pools.
  - The server decides every hit and kill; your own movement and shooting respond instantly through prediction.
- 2acf2a5: Characters, weapon models, a new soundscape and a tidier lobby:
  
  - Every class is its own soldier: Assault in a tactical helmet and plate carrier, Medic with a chest rig, medical backpack and armband, Heavy in a visored helmet, heavy vest and pack. Soldiers walk, jog, aim, shoot and reload, sit when downed, and hold the model of the gun they use. Running sideways or backwards moves the legs that way while the upper body keeps aiming.
  - Every weapon has a 3D model: turn it in the armory, inspect it in the shop, and see a still of it on every card. The lobby shows your class's soldier.
  - The game sounds like a zombie game: real gun recordings with weight under every shot, zombie growls, pain, deaths, bites and body falls, an ambience bed per map with the horde murmuring, and music that rises as zombies close in. Music and ambience have their own volume settings. The screens around the game click and confirm.
  - The lobby keeps the next mission and the deploy or ready button in reach, with smaller squad cards and an invite link in an open slot. A player away from the game for three minutes leaves their squad, and an empty squad closes.
  - A credits page lists every model, sound and font with its author and licence.
  - Maps look like places: real asphalt, concrete, dirt and grass underfoot, brick, stone, metal and concrete walls, and their own light (dusk, overcast or night).
  - Barrels, crates, sandbags, generators, terminals, supply caches and carried boxes are real models.
  - Zombies are new: rotting, torn and bloodied, hunched in a shambling walk, clawing when they reach you.
  - A graphics setting in the pause menu: automatic, high or low. Automatic picks the light version on devices without a graphics card.
  - Survivors are people in work clothes who walk with the squad when led out.
  - The lobby is a scene: your squad stands ready in a floodlit yard, with the squad and friends down the left, the classes and kit at their feet, and the mission card and Deploy on the right. Missions are picked in their own window.
  - Game screens use the whole window; nothing scrolls visibly, nothing can be selected by dragging, and the logo leads back to the lobby.
  - Abilities are equipped from the ability itself ("Equip in slot 1 (F)").
  - Armory: equip buttons come first, cards line up at the same height, and weapons show a picture instead of a 3D view (the shop too).
  - Addresses with a trailing slash ("/play/") work.
  - Soldiers are realistic now: a real face and hands, a combat shirt, trousers, boots, plate carrier and helmet, each class in its own colours and kit. Rifles and other long guns are held in both hands with the stock at the shoulder.
  - On a graphics card the picture has a finish: ambient occlusion, a soft bloom on bright things, a colour grade, vignette and film grain. The camera sits a little closer.
  - Real guns in full detail: a G19, Desert Eagle, Vector, HK416, Benelli M4 Super 90, M249, AWP, GL-06 grenade launcher, AUG and a handheld M134, plus two real flamethrowers for the Kiln and the Viper, all textured and sharp in the shop and armory.
  - Every kind of gun draws its own shots: shotguns spray pellets, sniper rifles leave a long bright streak, machine guns fire orange tracers, each with its own muzzle flash.
  - A profile screen (click your name): total level, missions won, gold masteries, classes and your campaign record.
  - Armour is worn in five places: head, torso, vest, legs and feet, each piece its own item with its own stats, bought, upgraded and equipped on its own. Everything you equip shows on your soldier, in the lobby and in the game (your squad sees it too). Everyone gets the starter helmet, shirt, trousers and boots.
  - The lobby is a better place: a wet yard at night with a street lamp, a covered car, barriers, tyres and bins, dust in the light, and the same picture finish as the game. Your soldier holds your main weapon at the low ready.
  - Missions play like missions: a briefing while the mission loads, the handler or a survivor on the radio as each step starts and ends, a debrief at the end, and more to every mission: zombie nests to burn out (they keep spawning until destroyed), ambushes that hit as a step starts, and a Brute boss with its own health bar. Landfall now has eight steps.
  - Two new zombies: the low, quick Crawler, and the Screamer, whose scream calls a pack in.
  - The guns go by their real names: G19, Desert Eagle, Vector, HK416, M4 Super 90, M249, AWP, GL-06, AUG and M134.
  - Every weapon picture is taken from the same side view.
  - Each class is a different person in their own style: the Assault an operator in a combat shirt, the Medic a woman in a black tactical suit, the Heavy a shaven-headed man in a T-shirt and gloves. Helmets, vests and packs go on top of all three.
  - In the lobby your soldier holds a long gun across the chest in both hands.
  - Zombies no longer appear on top of you: they come in from off screen, never closer than 8 m, and nests send them out on their far side.
  - Pausing a solo game freezes everything on screen: zombies, soldiers, effects and props stop where they are.
  - New sound throughout, from professional game-audio libraries: punchy guns per weapon (with the shotgun's pump and the sniper's bolt after each shot, and brass hitting the ground), wet hits, bodies bursting apart, bites, zombie groans and screams, metal doors, generators, a boss sting, and a cleaner interface. Every kind of sound is levelled to sit right in the mix, and the made-up beeps are gone.
  - Soldiers in full detail: faces, hands, clothes and gear keep far more of their shape and sharper textures.
  - The armory is set out like a loadout screen: your soldier stands full size on the left, wearing exactly what you equip (drag to turn them), with the class chosen above them; Weapons, Armour and Equipment have their own tabs, each with what is equipped and what you own.
  - The shop has the same tabs, and every armour piece has a picture in the shop and the armory.
  - Classes are chosen in the armory; the lobby shows your class with your kit.
  - The camera sits closer, so soldiers and zombies read at a glance.
  - A marker shows where the current objective is, and an arrow at the screen's edge points the way when it is out of view, with the distance.
  - Zombies climb out of holes in the ground instead of appearing from nowhere, and burst apart when killed: lumps thrown across the ground and blood that stays.
  - The firing range's targets and zombies come in where you can see them.
  - Landfall is a 12-minute run against the clock through four areas that close behind you: carry the flight recorder out of a burning wreck, fight up a high street of wrecked cars (a pharmacy behind a door holds supplies), restart the checkpoint's gate generator and hold while it opens, burn the nests in the square and put down the Brute, then hold the helipad until the bird lands. Run out of time and the mission is lost.
  - Maps can have scenery: wrecked and burning cars, barriers, lamps, crates, fences and fires, solid where they look solid.
  - Soldiers hold their guns like soldiers: rifles shouldered and aimed with both hands on the gun, pistols out in front in a two-handed grip, fingers closed round the grip, a kick when they fire and the gun brought down to change the magazine.
  - The mission picker keeps its Done button in view.
  - A generator you start shows it running up: an amber light and a bar filling over it, then green and a hum when it is on; Landfall's checkpoint hold is shorter.
  - New soldier for every class: a fully kitted operator (helmet, balaclava, glasses, gloves, plate carrier with pouches) that moves cleanly, with no stretched clothing; classes differ by their kit.
  - The lobby is a hub like the games it takes after: kit tiles (weapons, armour, equipment, skills, shop, profile) down the left, the mission, Survival and the firing range in the middle over your player card, and the squad with Deploy on the right; tiles open the armory and shop on the right tab.
  - Maps look like places: walls show their brick, stone and metal (they were drawn almost black) under gravel rooftops and stand taller, the ground has cracks, oil stains, puddles and litter, rubbish lies along the walls, and a light goes with your soldier so the fight reads even at dusk.
  - Gunshots are recordings of the real guns: a Glock 19X, a Colt 1911 and HK USP45, a .50 AE Desert Eagle, an Uzi and a Colt SMG, a Colt M4A1 and an AR-15, a Saiga, a Remington 870 and a Mossberg 500, an M240 for the machine guns and a Barrett and a .308 for the sniper rifle, each with its full tail.
  - The lobby hub has no scene behind it any more: a dark field with a faint grid and the Rotline mark, like the games it takes after.
  - At ease, soldiers carry a long gun at the low ready with both hands on it.
  - No more black box around the muzzle flash on high graphics.
- 5e97c53: Missions:
  
  - Squads can now play missions, next to Survival (endless rounds that get harder each round). The leader picks the mission (Yard Sweep, Last Stand) and the difficulty (Recruit, Veteran, Nightmare, Apocalypse) in the lobby; harder difficulties have tougher, more numerous zombies and pay more.
  - Objectives: thin the horde, reach a place, hold an area, survive. Checkpoints bring everyone back at full health, including players who bled out; a squad wipe returns to the last checkpoint.
  - Score multiplier: kills in quick succession build a chain worth ×1 to ×6. Score thresholds pay Salvage and heal you.
  - Temporary buffs drop from kills: screen nuke, max ammo, double XP, minigun, instakill, speed boost, freeze pulse and a sentry.
  - Items drop for each player on their own: from elites, from hidden caches (hold E next to one) and one guaranteed when the mission is complete. New items are unlocked at level 0; ones you already own become duplicates you can discard for Salvage.
  - A results screen shows time, score, kills, XP, Salvage, items found and the mastery reached (bronze, silver, gold). Best times and mastery are shown on the mission select.
  - Survival: a squad wipe ends the run, with a results screen showing the rounds survived. Players who bled out come back at the next round only if someone finishes the round.
  - Esc opens a pause menu. Alone, the game really pauses; in a squad it goes on while you stand still. From the menu (or the lobby) you can go back and rejoin later, or abandon the mission.
  - The lobby, skills, armory and shop fill the window; their columns scroll on their own instead of the whole page.
  - The squad code has its own copy button, and buttons whose text changes (Copy → Copied, Ready → Not ready) no longer shift the layout.
  - Local test sign-in works with just a username.
- 077beab: Progression:
  
  - Three classes with their own levels and skill trees (three branches of 22 skills each); pick your class in the lobby, spend points, respec for Salvage.
  - Kills and cleared waves now earn class XP and Salvage.
  - The armory: your inventory and loadout, upgrades up to level 10 (damage, fire rate, reload, magazine, accuracy and carried ammunition), perk choices at levels 5 and 10, and safe discards.
  - The shop sells every weapon, armour and utility at a fixed price.
  - All eleven weapons work: shotgun, sniper rifle that pierces, flamethrower, chemical sprayer, grenade launcher and the chain-lightning shock rifle join the starter guns. Armour reduces damage.
- b8e111a: Sound and gun feel:
  
  - The game has sound: recorded gunshots for pistols, rifles, the sniper rifle and the shotgun, reloads, and zombie voices; explosions, flames, lightning, doors, generators, traps, buff pickups, item finds, hits and an empty-magazine click. Sounds come from where they happen: you hear the fight around you, panned left and right.
  - Sound settings in the pause menu: master, effects and interface volume, and mute. They are remembered in your browser.
  - Guns feel heavier: the camera kicks back with each shot (more for shotguns and the sniper rifle), spent cases fly out and lie on the ground, sparks show where shots hit walls, and explosions and heavy hits shake the screen (not when your system asks for reduced motion).
- a39ff99: Squads:
  
  - Form a squad of up to four in the lobby with a six-character code or an invite link; the leader deploys once everyone is ready, and everyone lands in the same mission.
  - Going down in a squad leaves you crawling with your pistol while a teammate holds E next to you to revive you; bleed out and you are back with the next wave. If nobody is left standing, the wave restarts.
  - Teammates' health, downed timers and revive progress show in the HUD, and you watch a teammate while you are out.
  - Smoother play on poor connections: no more rubber-banding after a lag spike, and other players and zombies stay fluid at 2 % packet loss.

### Patch Changes

- acc46d9: Anti-cheat: rewards must be signed by a game server to count, players who stand idle through a wave are not paid for it, and suspiciously accurate players are logged for review.
- d069fe7: Collisions: you can no longer walk through zombies, thrown grenades and other thrown things stop on the first zombie they hit, and your own shots are drawn stopping at the first zombie they hit (as they always did on the server) instead of passing through the line.
- 351271f: Fixes from the milestone 4 reviews:
  
  - Reconnecting to a mission no longer leaves your character frozen.
  - Kills made right after a lag spike now count, and the shots show for everyone.
  - Slide Dash, Adrenaline Burst, Stim and the minigun stay smooth on bad connections, and holding an ability key uses it as soon as it is ready.
  - Barricades match exactly between your screen and the server, and never trap a player or a zombie.
  - Losing a wave no longer pays the wave-cleared reward again; players who left mid-wave are not paid for it.
  - The Defibrillator works once per wave and gives its cooldown back if nobody is in reach. Going down ends your kill chain.
  - The firing range has a one-second ability cooldown and limits on spawning.
- Updated dependencies [b2004ea]
- Updated dependencies [a39ff99]
  - @rotline/sim@0.1.0
  - @rotline/protocol@0.1.0
  - @rotline/game-data@0.1.0
  - @rotline/ticket@0.1.0
  - @rotline/state@0.1.0
