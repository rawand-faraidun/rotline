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
	queue: {
		title: 'Queue — Rotline',
		kicker: 'The line is full',
		heading: 'Holding position',
		position: 'Your place in line',
		of: 'of {total} waiting',
		estimate: 'Estimated wait',
		minutes: 'about {minutes} min',
		underMinute: 'under a minute',
		online: '{online} / {capacity} players in the game',
		notify: 'Notify me when it is my turn',
		notifyOn: 'You will be notified',
		leave: 'Leave the queue',
		readyTitle: 'Your seat is ready',
		readyBody: 'Enter within {seconds} s or the seat goes to the next in line.',
		enter: 'Enter Rotline',
		notification: 'Your seat in Rotline is ready.',
		expiredTitle: 'Your pass expired',
		expiredBody: 'The seat went to the next player in line.',
		idleTitle: 'You were away',
		idleBody: 'Your seat was released after twelve minutes without activity.',
		lostTitle: 'Your seat lapsed',
		lostBody: 'We did not hear from your game for a while.',
		rejoin: 'Join the queue again',
		reconnecting: 'Reconnecting to the queue…',
		friends: 'Friends online',
		noFriends: 'None of your friends are online.',
		field: 'Field notes',
		bestiary: 'Bestiary',
		tip: 'Tip',
		stats: 'Health {health} · Speed {speed} m/s',
		tips: [
			'Downed teammates crawl and can still shoot their pistol. Hold E next to them for four seconds to bring them back.',
			'Each time you go down, you bleed out five seconds faster. Play the next one safer.',
			'A squad that goes down together restarts the wave. Someone has to stay standing.',
			'Zombies ignore the downed. Use that time to clear a path to them.',
			'Swells burst when they die. Kill them away from your squad, and stay out of the acid.',
			'Reload behind your squad, not in front of it.'
		],
		creatures: {
			drudge: 'The rot at its most patient. Slow, stubborn, and never alone for long.',
			bolter: 'Fresh turned and still fast. Bolters close the gap before you finish reloading.',
			swell: 'A walking blister of acid. Bursts when killed and leaves the ground burning.'
		}
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
		admin: {
			title: 'Admin',
			capacity: 'Player capacity',
			save: 'Save',
			saved: 'Saved',
			status: '{seats} playing · {queue} waiting · effective capacity {effective}'
		},
		idleWarning: 'Still there? You will lose your seat in two minutes unless you move or press a key.',
		friends: {
			title: 'Friends',
			add: 'Add a friend',
			addPlaceholder: 'Player name',
			send: 'Send',
			requested: 'Request sent',
			alreadyFriends: 'You are already friends',
			notFound: 'No player has that name.',
			incoming: 'Requests',
			outgoing: 'Sent',
			accept: 'Accept',
			decline: 'Decline',
			cancel: 'Cancel',
			invite: 'Invite',
			invited: 'Invited',
			joinThem: 'Join',
			remove: 'Remove',
			block: 'Block',
			unblock: 'Unblock',
			blocked: 'Blocked',
			recent: 'Played with recently',
			addFriend: 'Add',
			none: 'No friends yet. Add someone by name, or from players you met in a mission.',
			presence: {
				lobby: 'In the lobby',
				mission: 'In a mission',
				queue: 'In the queue',
				range: 'Firing range',
				offline: 'Offline'
			},
			inviteToast: '{name} invited you to their squad',
			joinSquad: 'Join squad',
			dismiss: 'Dismiss'
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
			deploy: 'Deploy',
			deploySquad: 'Deploy squad',
			deployHint: 'Hold the yard against wave after wave.',
			waiting: 'Waiting for everyone to be ready',
			ready: 'Ready',
			notReady: 'Not ready',
			markReady: 'I am ready',
			unready: 'Not ready yet',
			leader: 'Leader',
			kick: 'Remove',
			leaveParty: 'Leave squad',
			invite: 'Invite',
			inviteCode: 'Squad code',
			copyLink: 'Copy invite link',
			copied: 'Copied',
			joinCode: 'Join a squad',
			joinPlaceholder: 'CODE',
			join: 'Join',
			inMission: 'Your squad is in a mission',
			rejoin: 'Rejoin mission',
			problems: {
				'not-found': 'No squad has that code.',
				full: 'That squad is full.',
				'in-mission': 'That squad is in a mission right now.',
				'not-leader': 'Only the leader can do that.',
				'not-ready': 'Everyone has to be ready first.',
				'not-member': 'That player is not in your squad.'
			}
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
			bleedout: 'Bleeding out in {seconds} s',
			waitForRevive: 'A teammate can revive you',
			beingRevived: 'Being revived',
			out: 'You are out',
			outBack: 'Back with the next wave',
			reviveHint: 'Hold E to revive {name}',
			waveBanner: 'Wave {wave}',
			wipeBanner: 'Squad wiped — restarting wave {wave}',
			teammateDown: 'Down {seconds} s',
			teammateOut: 'Out',
			disconnected: 'Disconnected',
			ping: '{ms} ms',
			fps: '{fps} fps',
			lost: 'Connection lost',
			kicked: 'Removed from the mission',
			backToLobby: 'Back to lobby',
			controls: 'WASD move · mouse aim · click fire · R reload · 1 2 3 weapons · Q swap · E revive · Esc leave'
		}
	}
} as const

export type Messages = typeof en

/** Fills `{name}` placeholders. */
export function format(template: string, values: Record<string, string>): string {
	return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`)
}
