export const TICK_RATE = 30
export const DT = 1 / TICK_RATE
export const MAX_PLAYERS = 4
export const MAX_ZOMBIES = 300
/** spatial hash cell size in metres */
export const HASH_CELL = 2
/** flow field rebuild interval in ticks */
export const FLOW_EVERY = 6
/** ticks of zombie position history kept for lag compensation */
export const HISTORY_TICKS = 8
/** how far back a shot may be rewound (200 ms) */
export const MAX_REWIND_TICKS = 6
/** delay after switching weapons before firing, in seconds */
export const SWITCH_SECONDS = 0.3
/** seconds of protection after respawning */
export const RESPAWN_SAFE_SECONDS = 2
