# @rotline/game-data

## 0.8.0

### Patch Changes

- df1abfd: - **The Gardener comes up on the palm house floor, not in its pool**, so he can walk to you; the Rail Yard's Brute no longer comes in inside a wall.
  - **Zombies standing still turn to face you** (winding up, slamming, held up) instead of staring one way.
  - **The Gardener's second phase is fairer**: a little slower, his canisters every 9 seconds with a weaker pool.
  - Smoother servers in busy fights: fewer objects made each tick, each kind counted once a tick.
- e275c7c: - **Blackout really hides what is in the dark**: the server sends no zombie farther than a weapon light reaches.
  - **Modifiers that change nothing are not offered and pay nothing**: Blackout on missions that are dark already, One life on contracts.
  - **A strain stops at 60 % resistance** with what the kind already shrugs off, and a zombie keeps the mutation stage it came in at.
  - **The Gardener stays above ground longer and is a little less tough**, so he can be fought rather than chased.
  - **Pools on the ground cost far less to send**: each goes once, with how long it lasts; a player joining late sees the horde's mutation stage at once.
  - **A gas canister that downs the last player no longer leaves its pool behind after the wipe.**

## 0.7.0

No changes in this release.

## 0.6.0

No changes in this release.

## 0.5.0

No changes in this release.

## 0.4.3

No changes in this release.

## 0.4.2

No changes in this release.

## 0.4.1

No changes in this release.

## 0.4.0

No changes in this release.

## 0.3.0

No changes in this release.

## 0.2.0

No changes in this release.

## 0.1.0

### Minor Changes

- b2004ea: First playable build:
  
  - Sign in with GitHub or Google, pick a player name and a generated avatar, and wait in the lobby.
  - Deploy into a solo mission on The Yard: move, aim and shoot with the Vex-9, K-71 and the P9 pistol (unlimited reserve), reload and switch weapons.
  - Waves of Drudges, Bolters and Swells find their way around walls; Swells burst and leave acid pools.
  - The server decides every hit and kill; your own movement and shooting respond instantly through prediction.
