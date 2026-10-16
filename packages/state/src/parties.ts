import { randomInt, randomUUID } from 'node:crypto'
import type { Valkey } from './client.ts'

export const PARTY_SIZE = 4

/** Codes avoid characters that are easy to misread (0/O, 1/I). */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6

export type PartyState = 'lobby' | 'mission'

export type Party = {
	id: string
	leader: string
	code: string
	state: PartyState
	room: string
	instance: string
	startedAt: number
	/** user ids in join order */
	members: string[]
	ready: string[]
}

export class PartyError extends Error {
	readonly code: 'not-found' | 'full' | 'in-mission' | 'not-leader' | 'not-ready' | 'not-member'

	constructor(code: PartyError['code']) {
		super(code)
		this.code = code
	}
}

const partyKey = (id: string) => `party:${id}`
const membersKey = (id: string) => `party:${id}:members`
const readyKey = (id: string) => `party:${id}:ready`
const codeKey = (code: string) => `party-code:${code}`
const memberKey = (userId: string) => `party-member:${userId}`

/**
 * Parties (lobby groups of up to four) live in Valkey: they are short-lived, change often and are
 * rebuilt simply by players opening the lobby again.
 */
export class PartyStore {
	private readonly valkey: Valkey

	constructor(valkey: Valkey) {
		this.valkey = valkey
	}

	async get(id: string): Promise<Party | null> {
		const [hash, members, ready] = await Promise.all([
			this.valkey.hgetall(partyKey(id)),
			this.valkey.zrange(membersKey(id), '0', '-1'),
			this.valkey.smembers(readyKey(id))
		])
		if (!hash.leader || members.length === 0) return null
		return {
			id,
			leader: hash.leader,
			code: hash.code ?? '',
			state: (hash.state as PartyState) ?? 'lobby',
			room: hash.room ?? '',
			instance: hash.instance ?? '',
			startedAt: Number(hash.startedAt ?? '0'),
			members,
			ready
		}
	}

	async byCode(code: string): Promise<Party | null> {
		const id = await this.valkey.get(codeKey(code.toUpperCase()))
		return id ? this.get(id) : null
	}

	/** The player's party, creating a party of one if they have none. */
	async current(userId: string): Promise<Party> {
		const id = await this.valkey.get(memberKey(userId))
		if (id) {
			const party = await this.get(id)
			if (party?.members.includes(userId)) return party
		}
		return this.create(userId)
	}

	private async create(userId: string): Promise<Party> {
		const id = randomUUID()
		let code = ''
		for (let attempt = 0; attempt < 20 && !code; attempt++) {
			const candidate = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join(
				''
			)
			if ((await this.valkey.set(codeKey(candidate), id, 'NX')) === 'OK') code = candidate
		}
		if (!code) throw new Error('could not allocate a party code')
		// atomic: two requests at once (the lobby and its event stream) must not create two parties
		const actual = (await this.valkey.eval(CREATE, 0, userId, id, code, Date.now())) as string
		if (actual !== id) await this.valkey.del(codeKey(code))
		return (await this.get(actual)) as Party
	}

	/** Removes a player from whatever party they are in; empty parties are deleted. Returns that party's id. */
	private async detach(userId: string): Promise<string | null> {
		// one atomic script: several API instances may change the same party at once
		const id = (await this.valkey.eval(DETACH, 0, userId)) as string | null
		return id || null
	}

	/** Joins the party with this code. Returns the new party and the id of the party the player left. */
	async join(userId: string, code: string): Promise<{ party: Party; left: string | null }> {
		const target = await this.byCode(code)
		if (!target) throw new PartyError('not-found')
		if (target.members.includes(userId)) return { party: target, left: null }
		if (target.state !== 'lobby') throw new PartyError('in-mission')
		if (target.members.length >= PARTY_SIZE) throw new PartyError('full')
		const left = await this.detach(userId)
		const result = (await this.valkey.eval(ATTACH, 0, userId, target.id, PARTY_SIZE, Date.now())) as string
		if (result !== 'ok') {
			// the party filled up, left or deployed in the meantime: the player gets a party of their own
			await this.create(userId)
			throw new PartyError(result === 'in-mission' ? 'in-mission' : result === 'full' ? 'full' : 'not-found')
		}
		return { party: (await this.get(target.id)) as Party, left }
	}

	/** Leaves the current party for a new party of one. Returns the new party and the old party's id. */
	async leave(userId: string): Promise<{ party: Party; left: string | null }> {
		const left = await this.detach(userId)
		return { party: await this.create(userId), left }
	}

	async kick(leaderId: string, targetId: string): Promise<Party> {
		const party = await this.current(leaderId)
		if (party.leader !== leaderId) throw new PartyError('not-leader')
		if (!party.members.includes(targetId) || targetId === leaderId) throw new PartyError('not-member')
		await this.detach(targetId)
		return (await this.get(party.id)) as Party
	}

	async setReady(userId: string, ready: boolean): Promise<Party> {
		const party = await this.current(userId)
		if (ready) await this.valkey.sadd(readyKey(party.id), userId)
		else await this.valkey.srem(readyKey(party.id), userId)
		return (await this.get(party.id)) as Party
	}

	/** Starts a mission: the leader decides, everyone else must be ready. */
	async start(leaderId: string, room: string, instance: string): Promise<Party> {
		const party = await this.current(leaderId)
		if (party.leader !== leaderId) throw new PartyError('not-leader')
		if (party.state !== 'lobby') throw new PartyError('in-mission')
		const unready = party.members.filter(member => member !== leaderId && !party.ready.includes(member))
		if (unready.length > 0) throw new PartyError('not-ready')
		await this.valkey.hset(partyKey(party.id), { state: 'mission', room, instance, startedAt: Date.now() })
		return (await this.get(party.id)) as Party
	}

	/** Back to the lobby after a mission; ready marks are cleared. */
	async endMission(partyId: string): Promise<void> {
		await this.valkey
			.multi()
			.hset(partyKey(partyId), { state: 'lobby', room: '', instance: '', startedAt: 0 })
			.del(readyKey(partyId))
			.exec()
	}
}

const CREATE = `
local user, id, code, now = ARGV[1], ARGV[2], ARGV[3], ARGV[4]
local existing = redis.call('GET', 'party-member:' .. user)
if existing and redis.call('ZSCORE', 'party:' .. existing .. ':members', user) then return existing end
redis.call('HSET', 'party:' .. id, 'leader', user, 'code', code, 'state', 'lobby', 'room', '', 'instance', '', 'startedAt', 0)
redis.call('ZADD', 'party:' .. id .. ':members', now, user)
redis.call('SET', 'party-member:' .. user, id)
return id
`

const DETACH = `
local user = ARGV[1]
local id = redis.call('GET', 'party-member:' .. user)
if not id then return false end
local party = 'party:' .. id
local members = party .. ':members'
redis.call('ZREM', members, user)
redis.call('SREM', party .. ':ready', user)
redis.call('DEL', 'party-member:' .. user)
local rest = redis.call('ZRANGE', members, 0, 0)
if #rest == 0 then
  local code = redis.call('HGET', party, 'code')
  redis.call('DEL', party, members, party .. ':ready')
  if code then redis.call('DEL', 'party-code:' .. code) end
elseif redis.call('HGET', party, 'leader') == user then
  redis.call('HSET', party, 'leader', rest[1])
end
return id
`

const ATTACH = `
local user, id, limit, now = ARGV[1], ARGV[2], tonumber(ARGV[3]), ARGV[4]
local party = 'party:' .. id
local members = party .. ':members'
local size = redis.call('ZCARD', members)
if size == 0 then return 'gone' end
if size >= limit then return 'full' end
if redis.call('HGET', party, 'state') ~= 'lobby' then return 'in-mission' end
redis.call('ZADD', members, now, user)
redis.call('SET', 'party-member:' .. user, id)
redis.call('DEL', party .. ':ready')
return 'ok'
`
