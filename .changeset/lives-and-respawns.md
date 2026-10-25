---
"@rotline/web": minor
"@rotline/game-server": minor
---

Dying has rules for every mode:

- **Playing alone, a run has three lives.** The first two deaths send you back to the last checkpoint (in Survival the round starts again); the third loses the mission or ends the run. The lives left show under the health bar.
- **In a squad, nothing changes:** a downed player waits to be revived. Each down shortens the next bleed-out until the player comes back (a respawn, a checkpoint or a new round). A bled-out player returns at the next checkpoint in missions and at the next round in Survival.
- **Contracts bring the fallen back on a timer:** contracts have no checkpoints, so a bled-out player returns after 15 seconds, then 20, 25 and 30 for each later time.

The Crossroads looks like a real town and plays fairer: a horse statue, benches, planters, hydrants, manholes, a café, a coffee cart, a payphone and a survivors' camp; doors on the church, pharmacy, shop and garage to shut and weld. Map turrets are now mounted miniguns that turn to what they shoot, hit less hard, and in Survival their generators run out of fuel after 75 seconds and must be started again, so they help a stand instead of winning it.

Fewer surprises: hovering a menu no longer counts as asking for a seat, and a failed seat check no longer bounces you between the queue and the game; the server is judged overloaded only when many ticks run slow, not on one spike. Shaders are compiled up front, so the first explosion or flame no longer freezes a frame, and the frame-rate guard changes resolution less often.
