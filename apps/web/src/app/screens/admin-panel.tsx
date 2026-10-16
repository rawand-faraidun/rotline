import { useEffect, useId, useState } from 'react'
import { Button, Input, Label, Panel, PanelHeader, PanelTitle } from '@rotline/ui'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { en } from '../../i18n/en.ts'

const t = en.app.admin

type Settings = { capacity: number; effective: number; seats: number; passes: number; queue: number }

/** Live settings for admins; for now the concurrent player capacity. */
export function AdminPanel() {
	const settings = useQuery({
		queryKey: ['admin', 'settings'],
		queryFn: async (): Promise<Settings> => {
			const response = await fetch('/api/admin/settings')
			if (!response.ok) throw new Error(`admin ${response.status}`)
			return (await response.json()) as Settings
		},
		refetchInterval: 10_000
	})
	const queryClient = useQueryClient()
	const capacityId = useId()
	const [capacity, setCapacity] = useState('')
	const [saved, setSaved] = useState(false)
	useEffect(() => {
		if (settings.data && capacity === '') setCapacity(String(settings.data.capacity))
	}, [settings.data, capacity])

	return (
		<Panel>
			<PanelHeader>
				<PanelTitle>{t.title}</PanelTitle>
			</PanelHeader>
			<form
				className="flex flex-col gap-2"
				onSubmit={async event => {
					event.preventDefault()
					const response = await fetch('/api/admin/capacity', {
						method: 'PUT',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ capacity: Number(capacity) })
					})
					if (response.ok) {
						setSaved(true)
						setTimeout(() => setSaved(false), 1500)
						void queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })
					}
				}}
			>
				<Label htmlFor={capacityId}>{t.capacity}</Label>
				<div className="flex gap-2">
					<Input
						id={capacityId}
						type="number"
						min={1}
						max={1000}
						value={capacity}
						onChange={event => setCapacity(event.target.value)}
						className="tabular-nums"
					/>
					<Button type="submit" variant="secondary">
						{saved ? t.saved : t.save}
					</Button>
				</div>
			</form>
			{settings.data && (
				<p className="text-muted text-sm">
					{t.status
						.replace('{seats}', String(settings.data.seats))
						.replace('{queue}', String(settings.data.queue))
						.replace('{effective}', String(settings.data.effective))}
				</p>
			)}
		</Panel>
	)
}
