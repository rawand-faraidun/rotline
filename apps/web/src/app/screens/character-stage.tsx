import { useRef, useState } from 'react'
import type { LobbyMember } from '@rotline/client/lobby'
import { gear, weapons } from '@rotline/game-data'
import { cn } from '@rotline/ui'
import { useQuery } from '@tanstack/react-query'
import { en } from '../../i18n/en.ts'
import { progressQuery } from '../../lib/progress.ts'
import { ClassPanel, glass } from './class-panel.tsx'
import { LobbyBackdrop } from './lobby-backdrop.tsx'

const t = en.app.armory

const weaponIds = new Set(weapons.map(weapon => weapon.id))
const armourIds = new Set(gear.armour.map(piece => piece.id))

/** A weapon's or armour piece's still for cards, or nothing (utilities have none). */
export function itemPicture(id: string): string | null {
	if (weaponIds.has(id)) return `/assets/models/weapons/${id}.webp`
	if (armourIds.has(id)) return `/assets/models/armour/${id}.webp`
	return null
}

/**
 * The player's soldier, head to boots, wearing exactly what is equipped and holding the first main
 * weapon; dragging turns them. The class is chosen above it.
 */
export function CharacterStage({ className }: { className?: string }) {
	const progress = useQuery(progressQuery)
	const [turn, setTurn] = useState(0)
	const drag = useRef<{ x: number; turn: number } | null>(null)
	const view = progress.data
	const loadout = view?.loadout
	const member: LobbyMember[] =
		view && loadout
			? [
					{
						slot: 1,
						classId: view.activeClass,
						weaponId: loadout.main1 ?? loadout.main2 ?? 'k-71',
						pistol: false,
						you: true,
						armour: [
							loadout.armourHead,
							loadout.armourTorso,
							loadout.armourVest,
							loadout.armourLegs,
							loadout.armourFeet
						]
					}
				]
			: []
	return (
		<section
			aria-label={t.classTitle}
			className={cn('frame cut relative flex min-h-[28rem] flex-col overflow-hidden', glass, className)}
		>
			<div
				className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
				onPointerDown={event => {
					event.currentTarget.setPointerCapture(event.pointerId)
					drag.current = { x: event.clientX, turn }
				}}
				onPointerMove={event => {
					if (drag.current) setTurn(drag.current.turn - (event.clientX - drag.current.x) / 120)
				}}
				onPointerUp={() => {
					drag.current = null
				}}
			>
				{member.length > 0 && <LobbyBackdrop members={member} view="portrait" turn={turn} />}
			</div>
			<div className="pointer-events-none relative flex flex-1 flex-col justify-between gap-3 p-3">
				<div className="pointer-events-auto">
					<ClassPanel compact />
				</div>
				<span className="self-center text-muted text-xs uppercase tracking-[0.2em]">{t.stageHint}</span>
			</div>
		</section>
	)
}
