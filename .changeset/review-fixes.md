---
"@rotline/web": patch
"@rotline/game-server": patch
"@rotline/api": patch
---

Fixes from the milestone 4 reviews:

- Reconnecting to a mission no longer leaves your character frozen.
- Kills made right after a lag spike now count, and the shots show for everyone.
- Slide Dash, Adrenaline Burst, Stim and the minigun stay smooth on bad connections, and holding an ability key uses it as soon as it is ready.
- Barricades match exactly between your screen and the server, and never trap a player or a zombie.
- Losing a wave no longer pays the wave-cleared reward again; players who left mid-wave are not paid for it.
- The Defibrillator works once per wave and gives its cooldown back if nobody is in reach. Going down ends your kill chain.
- The firing range has a one-second ability cooldown and limits on spawning.
