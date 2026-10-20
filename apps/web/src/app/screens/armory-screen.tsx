import { useState } from 'react'
import {
	type ArmourPiece,
	discardValue,
	economy,
	type ItemSlot,
	item,
	itemById,
	perkOptions,
	upgradeCost,
	upgradeTotal,
	weapons
} from '@rotline/game-data'
import { Badge, Button, cn, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { en, format } from '../../i18n/en.ts'
import { salvage } from '../../lib/describe.ts'
import { itemStatRows } from '../../lib/item-stats.ts'
import {
	type Loadout,
	ledgerQuery,
	type ProgressView,
	progressActions,
	progressQuery,
	type Refusal,
	runAction
} from '../../lib/progress.ts'
import { CharacterStage, itemPicture } from './character-stage.tsx'
import { GameShell } from './game-shell.tsx'
import { pane, panes } from './layout.ts'
import { PageHeader } from './page-header.tsx'

const t = en.app.armory
const p = en.app.progression
const MAX = economy.upgrade.maxLevel

const fields: { field: keyof Loadout; slot: ItemSlot; piece?: ArmourPiece }[] = [
	{ field: 'main1', slot: 'main' },
	{ field: 'main2', slot: 'main' },
	{ field: 'pistol', slot: 'pistol' },
	{ field: 'armourHead', slot: 'armour', piece: 'head' },
	{ field: 'armourTorso', slot: 'armour', piece: 'torso' },
	{ field: 'armourVest', slot: 'armour', piece: 'vest' },
	{ field: 'armourLegs', slot: 'armour', piece: 'legs' },
	{ field: 'armourFeet', slot: 'armour', piece: 'feet' },
	{ field: 'utility1', slot: 'utility' },
	{ field: 'utility2', slot: 'utility' }
]

function kindLabel(id: string): string {
	const weapon = weapons.find(entry => entry.id === id)
	if (weapon) return p.kinds[weapon.kind]
	const piece = item(id).piece
	return piece ? p.pieces[piece] : p.slotNames[item(id).slot]
}

/** A loadout with `id` put in `field`; an item already equipped elsewhere swaps places. */
function equip(loadout: Loadout, field: keyof Loadout, id: string): Loadout {
	const next: Record<keyof Loadout, string | null> = { ...loadout }
	const current = (Object.keys(next) as (keyof Loadout)[]).find(key => next[key] === id)
	if (current) next[current] = loadout[field]
	next[field] = id
	return next as Loadout
}

function ItemDetail({
	view,
	id,
	onRefusal
}: {
	view: ProgressView
	id: string
	onRefusal: (refusal: Refusal | null) => void
}) {
	const queryClient = useQueryClient()
	const [confirming, setConfirming] = useState<Refusal | null>(null)
	const owned = view.inventory.find(entry => entry.itemId === id)
	if (!owned) return null
	const def = item(id)
	const current = itemStatRows(id, owned.level, owned.perks)
	const next = owned.level < MAX ? itemStatRows(id, owned.level + 1, owned.perks) : null
	const equippedIn = fields.filter(entry => view.loadout[entry.field] === id).map(entry => entry.field)
	const targets = fields.filter(entry => entry.slot === def.slot && (!entry.piece || entry.piece === def.piece))

	async function act(action: ReturnType<typeof progressActions.upgrade>) {
		const refusal = await runAction(queryClient, action)
		onRefusal(refusal)
		return refusal
	}

	return (
		<Panel data-testid="item-detail">
			<PanelHeader>
				<PanelTitle className="text-xl">{def.name}</PanelTitle>
				{equippedIn.length > 0 && <Badge tone="lime">{t.equipped}</Badge>}
			</PanelHeader>
			<p className="text-muted text-sm">{kindLabel(id)}</p>
			{/* equipping comes first: it is what you came here to do most often */}
			<div className="flex flex-wrap gap-2">
				{targets.map(target => (
					<Button
						key={target.field}
						size="sm"
						variant="secondary"
						disabled={view.loadout[target.field] === id}
						onClick={() => void act(progressActions.setLoadout(equip(view.loadout, target.field, id)))}
					>
						{format(t.equipAs, { slot: t.slots[target.field] })}
					</Button>
				))}
				{(def.slot === 'armour' || def.slot === 'utility') &&
					equippedIn.map(field => (
						<Button
							key={field}
							size="sm"
							variant="ghost"
							onClick={() => void act(progressActions.setLoadout({ ...view.loadout, [field]: null }))}
						>
							{t.unequip}
						</Button>
					))}
			</div>
			{itemPicture(id) && (
				<img
					src={itemPicture(id) ?? ''}
					alt=""
					width={480}
					height={270}
					className="aspect-[16/9] w-full object-contain"
				/>
			)}
			<div className="flex flex-col gap-1">
				<span className="font-bold text-sm">{format(t.level, { level: String(owned.level), max: String(MAX) })}</span>
				<span className="flex gap-0.5" aria-hidden="true">
					{Array.from({ length: MAX }, (_, pip) => (
						<span
							// biome-ignore lint/suspicious/noArrayIndexKey: fixed pips
							key={pip}
							className={cn('h-2 flex-1 skew-x-[-20deg]', pip < owned.level ? 'bg-rot-lime' : 'bg-surface-raised')}
						/>
					))}
				</span>
			</div>
			<table className="w-full text-sm">
				<tbody>
					{current.map((row, index) => (
						<tr key={row.key} className="border-line border-b border-dashed last:border-0">
							<th className="py-1 text-left font-normal text-muted">{row.label}</th>
							<td className="py-1 text-right font-bold tabular-nums">{row.value}</td>
							{next && (
								<td
									className={cn(
										'py-1 pl-3 text-right tabular-nums',
										next[index]?.value !== row.value ? 'text-rot-lime' : 'text-muted'
									)}
								>
									{next[index]?.value}
								</td>
							)}
						</tr>
					))}
				</tbody>
			</table>
			{next ? (
				<Button onClick={() => void act(progressActions.upgrade(id))} data-testid="upgrade">
					{format(t.upgrade, { level: String(owned.level + 1) })} · {salvage(upgradeCost(id, owned.level + 1))}
				</Button>
			) : (
				<Badge tone="lime">{t.maxed}</Badge>
			)}

			{economy.upgrade.perkLevels.map(level => {
				const options = perkOptions(id, level)
				if (!options) return null
				const locked = owned.level < level
				return (
					<div key={level} className={cn('flex flex-col gap-2', locked && 'opacity-50')}>
						<span className="font-bold text-muted text-xs uppercase tracking-[0.2em]">
							{locked ? format(t.perkLocked, { level: String(level) }) : format(t.perkAt, { level: String(level) })}
						</span>
						<div className="grid grid-cols-2 gap-2">
							{options.map(perk => {
								const chosen = owned.perks.includes(perk.id)
								return (
									<button
										key={perk.id}
										type="button"
										disabled={locked || chosen}
										onClick={() => void act(progressActions.choosePerk(id, level, perk.id))}
										className={cn(
											'frame cut-sm flex cursor-pointer flex-col gap-1 p-2 text-left text-xs disabled:cursor-default',
											chosen ? '[--frame-color:var(--color-rot-lime)]' : '[--frame-fill:var(--color-rot-black)]'
										)}
									>
										<span className={cn('font-bold', chosen && 'text-rot-lime')}>{perk.name}</span>
										<span className="text-muted">{chosen ? t.chosen : t.choose}</span>
									</button>
								)
							})}
						</div>
						{!locked && options.some(option => owned.perks.includes(option.id)) && (
							<span className="text-muted text-xs">
								{format(t.perkSwitch, { price: salvage(economy.upgrade.perkSwitchPrice) })}
							</span>
						)}
					</div>
				)
			})}

			{confirming ? (
				<div className="flex flex-col gap-2 border-alert border-l-4 pl-3" role="alertdialog">
					<p className="text-sm">{format(t.discardConfirm, { name: def.name, value: salvage(discardValue(id)) })}</p>
					{(confirming.level ?? 0) > 0 && (
						<p className="text-sm text-warning">
							{format(t.discardWarnUpgraded, {
								level: String(confirming.level),
								spent: salvage(confirming.spent ?? upgradeTotal(id, owned.level))
							})}
						</p>
					)}
					{confirming.equipped && <p className="text-sm text-warning">{t.discardWarnEquipped}</p>}
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="danger"
							onClick={() => {
								setConfirming(null)
								void act(progressActions.discard(id, true))
							}}
						>
							{p.confirm}
						</Button>
						<Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
							{p.cancel}
						</Button>
					</div>
				</div>
			) : (
				<Button
					size="sm"
					variant="ghost"
					className="self-start text-alert"
					onClick={async () => {
						const result = await progressActions.discard(id)
						if ('error' in result && result.error === 'needs-confirmation') setConfirming(result)
						else if ('error' in result) onRefusal(result)
						else {
							queryClient.setQueryData(progressQuery.queryKey, result)
							onRefusal(null)
						}
					}}
				>
					{format(t.discard, { value: salvage(discardValue(id)) })}
				</Button>
			)}
		</Panel>
	)
}

/** The armory's tabs: what each shows of the loadout and the inventory. */
export const TABS = {
	weapons: { slots: ['main', 'pistol'] as ItemSlot[], fields: ['main1', 'main2', 'pistol'] as (keyof Loadout)[] },
	armour: {
		slots: ['armour'] as ItemSlot[],
		fields: ['armourHead', 'armourTorso', 'armourVest', 'armourLegs', 'armourFeet'] as (keyof Loadout)[]
	},
	equipment: { slots: ['utility'] as ItemSlot[], fields: ['utility1', 'utility2'] as (keyof Loadout)[] }
} as const
export type Tab = keyof typeof TABS

export function ArmoryScreen() {
	const progress = useQuery(progressQuery)
	const ledger = useQuery({ ...ledgerQuery, enabled: progress.isSuccess })
	const queryClient = useQueryClient()
	const [tab, setTab] = useState<Tab>('weapons')
	const [selected, setSelected] = useState<string | null>(null)
	const [problem, setProblem] = useState<Refusal | null>(null)
	const view = progress.data
	if (!view) return <GameShell>{null}</GameShell>

	const shown = TABS[tab]
	const equipped = new Set(Object.values(view.loadout).filter(Boolean))
	const owned = view.inventory.filter(entry => shown.slots.includes(item(entry.itemId).slot))
	// something of this tab is always shown in detail: the pick, else what is in its first slot
	const chosen =
		selected && owned.some(entry => entry.itemId === selected)
			? selected
			: (shown.fields.map(field => view.loadout[field]).find(Boolean) ?? owned[0]?.itemId ?? null)

	return (
		<GameShell>
			<PageHeader title={t.title} />
			{problem && problem.error !== 'needs-confirmation' && (
				<p role="alert" className="mb-4 text-alert text-sm">
					{p.problems[problem.error]}
				</p>
			)}
			<div
				className={cn(
					panes,
					'lg:grid-cols-[minmax(17rem,24rem)_minmax(0,1fr)] xl:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)_minmax(19rem,22rem)]'
				)}
			>
				{/* the soldier as equipped, and the class they go out as */}
				<CharacterStage className="max-lg:min-h-[32rem]" />

				<div className={pane}>
					<div className="flex shrink-0 gap-1" role="tablist" aria-label={t.tabsLabel}>
						{(Object.keys(TABS) as Tab[]).map(key => (
							<button
								key={key}
								type="button"
								role="tab"
								aria-selected={tab === key}
								onClick={() => {
									setTab(key)
									setSelected(null)
								}}
								className={cn(
									'frame cut-sm flex-1 px-3 py-2.5 font-bold text-xs uppercase tracking-[0.2em]',
									tab === key
										? 'text-rot-lime [--frame-color:var(--color-rot-lime)]'
										: 'text-muted [--frame-fill:var(--color-rot-black)] hover:text-bone'
								)}
							>
								{t.tabs[key]}
							</button>
						))}
					</div>

					{/* what is equipped in this tab's slots */}
					<Panel className="shrink-0">
						<PanelHeader>
							<PanelTitle className="text-xl">{p.loadoutTitle}</PanelTitle>
						</PanelHeader>
						<ul className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
							{shown.fields.map(field => {
								const id = view.loadout[field]
								const picture = id ? itemPicture(id) : null
								return (
									<li key={field} className="flex">
										<button
											type="button"
											disabled={!id}
											onClick={() => id && setSelected(id)}
											className={cn(
												'frame cut-sm flex w-full cursor-pointer flex-col gap-1 p-2 text-left disabled:cursor-default',
												id && chosen === id
													? '[--frame-color:var(--color-rot-lime)]'
													: '[--frame-fill:var(--color-rot-black)]'
											)}
										>
											<span className="font-bold text-[0.65rem] text-muted uppercase tracking-[0.2em]">
												{t.slots[field]}
											</span>
											{picture && (
												<img
													src={picture}
													alt=""
													width={480}
													height={270}
													className="aspect-[16/9] w-full object-contain"
												/>
											)}
											<span className={cn('font-bold', !id && 'text-muted')}>
												{id ? itemById.get(id)?.name : t.emptySlot}
											</span>
										</button>
									</li>
								)
							})}
						</ul>
					</Panel>

					{/* everything owned that fits this tab */}
					<Panel>
						<PanelHeader>
							<PanelTitle className="text-xl">{t.owned}</PanelTitle>
						</PanelHeader>
						<ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
							{owned.map(entry => {
								const picture = itemPicture(entry.itemId)
								return (
									<li key={entry.itemId} className="flex">
										<button
											type="button"
											data-testid={`item-${entry.itemId}`}
											onClick={() => setSelected(entry.itemId)}
											className={cn(
												'frame cut flex h-full w-full cursor-pointer flex-col gap-1 p-3 text-left',
												chosen === entry.itemId
													? '[--frame-color:var(--color-rot-lime)]'
													: '[--frame-fill:var(--color-rot-black)] hover:[--frame-color:var(--color-bone)]'
											)}
										>
											{picture && (
												<img
													src={picture}
													alt=""
													width={480}
													height={270}
													loading="lazy"
													className="aspect-[16/9] w-full object-contain"
												/>
											)}
											<span className="font-bold">{item(entry.itemId).name}</span>
											<span className="text-muted text-xs">{kindLabel(entry.itemId)}</span>
											<span className="mt-auto flex flex-wrap gap-1 pt-1">
												<Badge tone={entry.level > 0 ? 'lime' : 'muted'}>
													{format(t.level, { level: String(entry.level), max: String(MAX) })}
												</Badge>
												{equipped.has(entry.itemId) && <Badge tone="bone">{t.equipped}</Badge>}
											</span>
										</button>
									</li>
								)
							})}
						</ul>
					</Panel>

					{tab === 'equipment' && view.duplicates.length > 0 && (
						<Panel>
							<PanelHeader>
								<PanelTitle className="text-xl">{t.duplicates}</PanelTitle>
							</PanelHeader>
							<p className="text-muted text-sm">{t.duplicatesHint}</p>
							<ul className="flex flex-col gap-2">
								{view.duplicates.map(duplicate => (
									<li key={duplicate.id} className="flex items-center justify-between gap-3">
										<span className="font-bold">{item(duplicate.itemId).name}</span>
										<Button
											size="sm"
											variant="secondary"
											onClick={async () =>
												setProblem(await runAction(queryClient, progressActions.discardDuplicate(duplicate.id)))
											}
										>
											{format(t.sellDuplicate, { value: salvage(discardValue(duplicate.itemId)) })}
										</Button>
									</li>
								))}
							</ul>
						</Panel>
					)}
				</div>

				<div className={cn(pane, 'lg:col-span-2 xl:col-span-1')}>
					{chosen ? (
						<ItemDetail key={chosen} view={view} id={chosen} onRefusal={setProblem} />
					) : (
						<Panel>
							<p className="text-muted">{t.selectHint}</p>
						</Panel>
					)}
					<Panel>
						<PanelHeader>
							<PanelTitle className="text-xl">{t.ledger}</PanelTitle>
						</PanelHeader>
						{ledger.data?.length === 0 && <p className="text-muted text-sm">{t.ledgerEmpty}</p>}
						<ul className="flex flex-col gap-1 text-sm">
							{(ledger.data ?? []).slice(0, 12).map(row => (
								<li key={row.id} className="flex justify-between gap-3">
									<span className="text-muted">
										{t.reasons[row.reason as keyof typeof t.reasons] ?? row.reason}
										{row.refId && itemById.has(row.refId) ? ` · ${itemById.get(row.refId)?.name}` : ''}
									</span>
									<span className={cn('font-bold tabular-nums', row.amount > 0 ? 'text-rot-lime' : 'text-bone')}>
										{row.amount > 0 ? '+' : '−'}
										{salvage(Math.abs(row.amount))}
									</span>
								</li>
							))}
						</ul>
					</Panel>
				</div>
			</div>
		</GameShell>
	)
}
