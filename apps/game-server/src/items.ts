import { items } from '@rotline/game-data'

const indexById = new Map(items.map((item, index) => [item.id, index]))

/** An item's index in game-data items, as the protocol sends it. */
export const itemIndex = (id: string): number => indexById.get(id) ?? 0
