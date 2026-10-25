---
"@rotline/web": minor
"@rotline/api": minor
"@rotline/game-server": patch
---

Squads, friends, the HUD and frame rate:

- **Squads deploy together**: when the leader starts, every member now follows into the mission from any lobby screen (it used to need going to the mission page by hand), and friends coming online or going offline show up without refreshing.
- **A Friends screen**: search players by any part of a name or a close spelling, add by name or player code, manage requests, friends, recent squadmates and blocks.
- **Player codes**: every player has a code to hand out; the code and an add-me link can be copied or sent from the device's share sheet, and so can the squad invite link.
- **Minimap**: top right, with walls, closed doors, every zombie, the squad and the objective; click it or press M for the whole map.
- **Teammate arrows** at the screen's edge point to squadmates out of view, with name and distance.
- **Mouse-wheel zoom**: a little closer or further out, remembered.
- **Zombies no longer catch on the edges** of walls and cover: they go round instead of pressing into them.
- **Faster on laptops**: built-in graphics get a new Medium quality (no ambient occlusion or bloom, one pixel per screen pixel, lighter shadows), a frame-rate guard lowers the resolution when frames drop under 50 a second, and soldiers in missions use a lighter model (the lobby and armory keep the detailed one).
