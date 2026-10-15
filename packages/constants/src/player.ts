export const PLAYER_NAME_MIN = 3
export const PLAYER_NAME_MAX = 16

/** Starts with a letter; letters, digits, underscore and hyphen after that. */
export const PLAYER_NAME_SHAPE = /^[A-Za-z][A-Za-z0-9_-]*$/

export const PLAYER_CLASSES = ['assault', 'medic', 'heavy'] as const

export type PlayerClassName = (typeof PLAYER_CLASSES)[number]

/** Concurrent player seats when the admin has not set a value. */
export const DEFAULT_CAPACITY = 24
