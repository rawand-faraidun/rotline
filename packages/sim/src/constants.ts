export const TICK_RATE = 30
export const DT = 1 / TICK_RATE
export const MAX_PLAYERS = 4
export const MAX_ZOMBIES = 300
/** spatial hash cell size in metres */
export const HASH_CELL = 2
/** flow field rebuild interval in ticks */
export const FLOW_EVERY = 6
/** ticks of zombie position history kept for lag compensation */
export const HISTORY_TICKS = 12
/** how far back a shot may be rewound (300 ms: the client's interpolation delay can reach that on lossy links) */
export const MAX_REWIND_TICKS = 9
/** delay after switching weapons before firing, in seconds */
export const SWITCH_SECONDS = 0.3
/** downed and revive (co-op) */
export const BLEEDOUT_SECONDS = 30
/** each earlier down shortens the next bleed-out by this much */
export const BLEEDOUT_STEP_SECONDS = 5
export const BLEEDOUT_MIN_SECONDS = 15
export const REVIVE_SECONDS = 4
export const REVIVE_RANGE = 1.5
/** share of max health a revived player gets back */
export const REVIVED_HEALTH = 0.3
/** crawling speed while downed, metres per second */
export const DOWNED_SPEED = 1
/** a tick far in the future: players who bled out come back with the next wave, not on a timer */
export const NEVER = 0x7fffffff
/** seconds of protection after respawning */
export const RESPAWN_SAFE_SECONDS = 2
