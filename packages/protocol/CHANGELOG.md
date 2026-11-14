# @rotline/protocol

## 0.8.0

### Minor Changes

- e275c7c: - **Blackout really hides what is in the dark**: the server sends no zombie farther than a weapon light reaches.
  - **Modifiers that change nothing are not offered and pay nothing**: Blackout on missions that are dark already, One life on contracts.
  - **A strain stops at 60 % resistance** with what the kind already shrugs off, and a zombie keeps the mutation stage it came in at.
  - **The Gardener stays above ground longer and is a little less tough**, so he can be fought rather than chased.
  - **Pools on the ground cost far less to send**: each goes once, with how long it lasts; a player joining late sees the horde's mutation stage at once.
  - **A gas canister that downs the last player no longer leaves its pool behind after the wipe.**

### Patch Changes

- Updated dependencies [df1abfd]
- Updated dependencies [48265b4]
- Updated dependencies [e275c7c]
  - @rotline/sim@0.8.0
  - @rotline/game-data@0.8.0

## 0.7.0

### Patch Changes

- @rotline/game-data@0.7.0
  - @rotline/sim@0.7.0

## 0.6.0

### Patch Changes

- @rotline/game-data@0.6.0
  - @rotline/sim@0.6.0

## 0.5.0

### Patch Changes

- @rotline/game-data@0.5.0
  - @rotline/sim@0.5.0

## 0.4.3

### Patch Changes

- @rotline/game-data@0.4.3
  - @rotline/sim@0.4.3

## 0.4.2

### Patch Changes

- @rotline/game-data@0.4.2
  - @rotline/sim@0.4.2

## 0.4.1

### Patch Changes

- @rotline/game-data@0.4.1
  - @rotline/sim@0.4.1

## 0.4.0

### Patch Changes

- @rotline/game-data@0.4.0
  - @rotline/sim@0.4.0

## 0.3.0

### Patch Changes

- @rotline/game-data@0.3.0
  - @rotline/sim@0.3.0

## 0.2.0

### Patch Changes

- @rotline/game-data@0.2.0
  - @rotline/sim@0.2.0

## 0.1.0

### Minor Changes

- b2004ea: First playable build:
  
  - Sign in with GitHub or Google, pick a player name and a generated avatar, and wait in the lobby.
  - Deploy into a solo mission on The Yard: move, aim and shoot with the Vex-9, K-71 and the P9 pistol (unlimited reserve), reload and switch weapons.
  - Waves of Drudges, Bolters and Swells find their way around walls; Swells burst and leave acid pools.
  - The server decides every hit and kill; your own movement and shooting respond instantly through prediction.
- a39ff99: Squads:
  
  - Form a squad of up to four in the lobby with a six-character code or an invite link; the leader deploys once everyone is ready, and everyone lands in the same mission.
  - Going down in a squad leaves you crawling with your pistol while a teammate holds E next to you to revive you; bleed out and you are back with the next wave. If nobody is left standing, the wave restarts.
  - Teammates' health, downed timers and revive progress show in the HUD, and you watch a teammate while you are out.
  - Smoother play on poor connections: no more rubber-banding after a lag spike, and other players and zombies stay fluid at 2 % packet loss.

### Patch Changes

- Updated dependencies [b2004ea]
- Updated dependencies [a39ff99]
  - @rotline/sim@0.1.0
  - @rotline/game-data@0.1.0
