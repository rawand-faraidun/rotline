import { useEffect, useId, useState } from 'react'
import { AVATAR_STYLES, type AvatarStyle, PLAYER_NAME_MAX } from '@rotline/constants'
import { AvatarFrame, Button, cn, Input, Label, Panel, PanelDescription, PanelHeader, PanelTitle } from '@rotline/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { en } from '../../i18n/en.ts'
import { api } from '../../lib/api.ts'
import { randomSeed, useAvatar } from '../../lib/avatar.ts'
import { meQuery } from '../app.tsx'
import { Shell } from './shell.tsx'

const t = en.app.welcome

type Problem = keyof typeof t.problems

function useDebounced<T>(value: T, ms: number): T {
	const [debounced, setDebounced] = useState(value)
	useEffect(() => {
		const timer = setTimeout(() => setDebounced(value), ms)
		return () => clearTimeout(timer)
	}, [value, ms])
	return debounced
}

function StyleChoice({
	style,
	seed,
	selected,
	onSelect
}: {
	style: AvatarStyle
	seed: string
	selected: boolean
	onSelect: () => void
}) {
	const src = useAvatar(style, seed)
	return (
		<button
			type="button"
			aria-pressed={selected}
			aria-label={style}
			onClick={onSelect}
			className={cn(
				'cursor-pointer transition-transform duration-100 ease-(--ease-snap) hover:-translate-y-0.5',
				selected && 'brackets'
			)}
		>
			<AvatarFrame src={src} alt="" size={72} className={cn(selected && '[--frame-color:var(--color-rot-lime)]')} />
		</button>
	)
}

export function WelcomeScreen() {
	const nameId = useId()
	const hintId = useId()
	const queryClient = useQueryClient()
	const navigate = useNavigate()
	const [name, setName] = useState('')
	const [style, setStyle] = useState<AvatarStyle>('pixel-art')
	const [seed, setSeed] = useState(randomSeed)
	const preview = useAvatar(style, seed)
	const checked = useDebounced(name.trim(), 300)

	const check = useQuery({
		queryKey: ['name-check', checked],
		enabled: checked.length > 0,
		queryFn: async () => {
			const response = await api.api.player['name-check'].$get({ query: { name: checked } })
			return (await response.json()) as { available: boolean; problem: Problem | null }
		}
	})

	const create = useMutation({
		mutationFn: async () => {
			const response = await api.api.player.$post({ json: { name: name.trim(), avatarStyle: style, avatarSeed: seed } })
			if (response.status === 201) return null
			const body = (await response.json()) as { problem?: Problem }
			return body.problem ?? ('taken' as Problem)
		},
		onSuccess: async problem => {
			if (problem) return
			await queryClient.invalidateQueries({ queryKey: meQuery.queryKey })
			await navigate({ to: '/play/lobby' })
		}
	})

	const settled = checked === name.trim() && !check.isFetching
	const problem: Problem | null = create.data ?? (settled && check.data ? check.data.problem : null)
	const ready = settled && check.data?.available === true && !create.isPending

	return (
		<Shell>
			<Panel className="mx-auto mt-10 w-full max-w-2xl md:mt-16">
				<PanelHeader>
					<PanelTitle>{t.title}</PanelTitle>
				</PanelHeader>
				<PanelDescription>{t.body}</PanelDescription>

				<form
					className="flex flex-col gap-6"
					onSubmit={event => {
						event.preventDefault()
						if (ready) create.mutate()
					}}
				>
					<div className="flex items-center gap-5">
						<AvatarFrame src={preview} alt="" size={112} className="[--frame-color:var(--color-rot-lime)]" />
						<div className="flex flex-1 flex-col gap-2">
							<Label htmlFor={nameId}>{t.name}</Label>
							<Input
								id={nameId}
								value={name}
								maxLength={PLAYER_NAME_MAX}
								autoComplete="off"
								spellCheck={false}
								aria-describedby={hintId}
								aria-invalid={problem !== null}
								onChange={event => {
									setName(event.target.value)
									create.reset()
								}}
							/>
							<p id={hintId} aria-live="polite" className={cn('text-sm', problem ? 'text-alert' : 'text-muted')}>
								{problem
									? t.problems[problem]
									: checked && check.isFetching
										? t.checking
										: check.data?.available && settled
											? t.available
											: t.nameHint}
							</p>
						</div>
					</div>

					<fieldset className="flex flex-col gap-3">
						<div className="flex items-center justify-between">
							<legend className="font-bold text-muted text-xs uppercase tracking-[0.2em]">{t.avatar}</legend>
							<Button type="button" variant="ghost" size="sm" onClick={() => setSeed(randomSeed())}>
								{t.reroll}
							</Button>
						</div>
						<div className="flex flex-wrap gap-4">
							{AVATAR_STYLES.map(option => (
								<StyleChoice
									key={option}
									style={option}
									seed={seed}
									selected={option === style}
									onSelect={() => setStyle(option)}
								/>
							))}
						</div>
					</fieldset>

					<Button type="submit" size="lg" disabled={!ready}>
						{t.create}
					</Button>
				</form>
			</Panel>
		</Shell>
	)
}
