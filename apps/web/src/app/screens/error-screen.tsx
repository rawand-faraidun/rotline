import { Button, Panel, PanelDescription, PanelTitle } from '@rotline/ui'
import { en } from '../../i18n/en.ts'
import { Shell } from './shell.tsx'

export function ErrorScreen() {
	return (
		<Shell>
			<Panel className="mx-auto mt-16 w-full max-w-md [--frame-color:var(--color-alert)]">
				<PanelTitle>!</PanelTitle>
				<PanelDescription role="alert">{en.app.error}</PanelDescription>
				<Button onClick={() => location.reload()}>{en.app.retry}</Button>
			</Panel>
		</Shell>
	)
}
