import { type QueryClient, queryOptions } from '@tanstack/react-query'
import type { InferResponseType } from 'hono/client'
import type { api } from './api.ts'

export type ProgressView = InferResponseType<(typeof api.api.progress)['$get'], 200>
export type ClassName = ProgressView['activeClass']

export type ProgressProblem =
	| 'in-mission'
	| 'not-enough-salvage'
	| 'owned'
	| 'not-owned'
	| 'max-level'
	| 'points'
	| 'rank'
	| 'tier-locked'
	| 'wrong-class'
	| 'unknown-node'
	| 'invalid-abilities'
	| 'wrong-slot'
	| 'duplicate'
	| 'last-pistol'
	| 'last-mains'
	| 'needs-confirmation'
	| 'nothing-to-refund'
	| 'level-too-low'
	| 'unknown-perk'
	| 'conflict'

export type Refusal = {
	error: ProgressProblem
	equipped?: boolean
	level?: number
	spent?: number
	value?: number
}

export const progressQuery = queryOptions({
	queryKey: ['progress'],
	queryFn: async (): Promise<ProgressView> => {
		const response = await fetch('/api/progress')
		if (response.status !== 200) throw new Error(`progress ${response.status}`)
		return (await response.json()) as ProgressView
	}
})

async function send(path: string, body: unknown, method = 'POST'): Promise<ProgressView | Refusal> {
	const response = await fetch(`/api/progress/${path}`, {
		method,
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	})
	return (await response.json()) as ProgressView | Refusal
}

export type Loadout = ProgressView['loadout']

export const progressActions = {
	setClass: (cls: ClassName) => send('class', { class: cls }),
	learn: (nodeId: string) => send('skills', { nodeId }),
	respec: (cls: ClassName) => send('respec', { class: cls }),
	setAbilities: (cls: ClassName, abilities: string[]) => send('abilities', { class: cls, abilities }, 'PUT'),
	setLoadout: (loadout: Loadout) => send('loadout', loadout, 'PUT'),
	buy: (itemId: string) => send('buy', { itemId }),
	upgrade: (itemId: string) => send('upgrade', { itemId }),
	choosePerk: (itemId: string, level: number, perkId: string) => send('perk', { itemId, level, perkId }),
	discard: (itemId: string, confirm = false) => send('discard', { itemId, confirm }),
	discardDuplicate: (id: string) => send('discard-duplicate', { id })
}

export const isRefusal = (result: ProgressView | Refusal): result is Refusal => 'error' in result

/** Runs an action and puts the new view in the cache; returns the refusal, if any. */
export async function runAction(client: QueryClient, action: Promise<ProgressView | Refusal>): Promise<Refusal | null> {
	const result = await action
	if (isRefusal(result)) return result
	client.setQueryData(progressQuery.queryKey, result)
	void client.invalidateQueries({ queryKey: ['progress', 'ledger'] })
	return null
}

export type LedgerRow = {
	id: string
	amount: number
	balanceAfter: number
	reason: string
	refId: string | null
	createdAt: string
}

export const ledgerQuery = queryOptions({
	queryKey: ['progress', 'ledger'],
	queryFn: async (): Promise<LedgerRow[]> => {
		const response = await fetch('/api/progress/ledger')
		if (response.status !== 200) throw new Error(`ledger ${response.status}`)
		return (await response.json()) as LedgerRow[]
	}
})
