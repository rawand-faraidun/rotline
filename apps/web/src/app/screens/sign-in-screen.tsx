import { useState } from 'react'
import { Button, Panel, PanelDescription, PanelHeader, PanelTitle } from '@rotline/ui'
import { useSuspenseQuery } from '@tanstack/react-query'
import { en, format } from '../../i18n/en.ts'
import { type SignInProvider, signIn } from '../../lib/api.ts'
import { providersQuery } from '../app.tsx'
import { Shell } from './shell.tsx'

const t = en.app.signIn

export function SignInScreen() {
	const { data: providers } = useSuspenseQuery(providersQuery)
	const [pending, setPending] = useState<SignInProvider | null>(null)
	const [failed, setFailed] = useState(false)

	const start = async (provider: SignInProvider) => {
		setPending(provider)
		setFailed(false)
		try {
			await signIn(provider)
		} catch {
			setPending(null)
			setFailed(true)
		}
	}

	return (
		<Shell>
			<Panel className="mx-auto mt-12 w-full max-w-md md:mt-24">
				<PanelHeader>
					<PanelTitle>{t.title}</PanelTitle>
				</PanelHeader>
				<PanelDescription>{t.body}</PanelDescription>
				<div className="flex flex-col gap-3">
					{providers.map(provider => (
						<Button
							key={provider}
							variant={provider === 'test' ? 'secondary' : 'primary'}
							disabled={pending !== null}
							onClick={() => void start(provider)}
						>
							{format(t.with, { provider: t.providers[provider] })}
						</Button>
					))}
					{providers.length === 0 && <p className="text-sm text-warning">{t.none}</p>}
					{failed && (
						<p role="alert" className="text-alert text-sm">
							{en.app.error}
						</p>
					)}
				</div>
			</Panel>
		</Shell>
	)
}
