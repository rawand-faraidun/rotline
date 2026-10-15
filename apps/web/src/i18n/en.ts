// Every piece of interface text lives here, so the game can be translated later.
export const en = {
	meta: {
		title: 'Rotline: hold the line against the rot',
		description:
			'A top-down co-op zombie shooter in your browser. Squad up with up to four players, pick a class and hold the line. Everything is earned by playing.'
	},
	nav: {
		play: 'Play',
		privacy: 'Privacy',
		terms: 'Terms',
		home: 'Home'
	},
	landing: {
		kicker: 'Browser co-op shooter',
		lead: 'Fight through objective missions against a horde that mutates to answer your tactics. Solo or with up to three friends, right in your browser.',
		cta: 'Play now',
		ctaHint: 'Free. Sign in with GitHub or Google.',
		features: [
			{
				title: 'Squad of four',
				body: 'Assault, Medic and Heavy cover each other. Revive the fallen, focus the elites, survive together.'
			},
			{
				title: 'The horde adapts',
				body: 'Eighteen kinds of infected, and strains that evolve to resist whatever your squad relies on.'
			},
			{
				title: 'Earned, never bought',
				body: 'One currency, earned by playing. No loot boxes, no rarity, no real money. Ever.'
			}
		],
		footer: 'Rotline is an original game.'
	},
	legal: {
		draft: 'Draft',
		privacyTitle: 'Privacy',
		termsTitle: 'Terms',
		privacyBody: [
			'Rotline signs you in with GitHub or Google. From them we keep only your account id at that provider and your email address. We do not keep your name, your photo or any access token.',
			'We store your player name, your avatar settings, your progress, your inventory, your currency history and your friends list, so the game works.',
			'Server logs, including IP addresses, are kept for up to 14 days for security and are then deleted.',
			'You can delete your account and its data from the settings page at any time.'
		],
		termsBody: [
			'Rotline is free to play. There are no purchases of any kind.',
			'Play fair: cheating, harassment and offensive player names are not allowed, and accounts that break these rules can be removed.',
			'The game is provided as it is, while it is being built.'
		]
	},
	app: {
		loading: 'Loading',
		error: 'Something went wrong. Try again in a moment.',
		retry: 'Try again',
		signIn: {
			title: 'Report in',
			body: 'Sign in to play. We only keep your provider account id and email.',
			with: 'Continue with {provider}',
			providers: { github: 'GitHub', google: 'Google', test: 'Test account' },
			none: 'No sign-in method is configured on this server.'
		},
		welcome: {
			title: 'New recruit',
			body: 'Pick the name your squad will see, and an avatar.',
			name: 'Player name',
			nameHint: '3–16 characters: letters, digits, _ and -. Starts with a letter.',
			avatar: 'Avatar',
			reroll: 'Reroll',
			create: 'Enlist',
			checking: 'Checking…',
			available: 'Available',
			problems: {
				'too-short': 'At least 3 characters.',
				'too-long': 'At most 16 characters.',
				'invalid-characters': 'Letters, digits, _ and - only, starting with a letter.',
				offensive: 'That name is not allowed.',
				reserved: 'That name is reserved.',
				taken: 'That name is taken.'
			}
		},
		lobby: {
			title: 'Lobby',
			squad: 'Squad',
			class: 'Class',
			salvage: 'Salvage',
			empty: 'No missions are open yet. The horde is gathering.',
			signOut: 'Sign out',
			classes: { assault: 'Assault', medic: 'Medic', heavy: 'Heavy' },
			slotOpen: 'Open slot',
			deploy: 'Deploy solo',
			deployHint: 'Hold the yard against wave after wave.'
		},
		mission: {
			loading: 'Deploying',
			leave: 'Leave',
			wave: 'Wave',
			kills: 'Kills',
			score: 'Score',
			health: 'Health',
			reloading: 'Reloading',
			unlimited: '∞',
			down: 'You are down',
			backIn: 'Back in {seconds} s',
			ping: '{ms} ms',
			fps: '{fps} fps',
			lost: 'Connection lost',
			kicked: 'Removed from the mission',
			backToLobby: 'Back to lobby',
			controls: 'WASD move · mouse aim · click fire · R reload · 1 2 3 weapons · Q swap · Esc leave'
		}
	}
} as const

export type Messages = typeof en

/** Fills `{name}` placeholders. */
export function format(template: string, values: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`)
}
