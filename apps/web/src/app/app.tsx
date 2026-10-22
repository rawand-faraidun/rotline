import { QueryClient, QueryClientProvider, queryOptions } from '@tanstack/react-query'
import {
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
	redirect
} from '@tanstack/react-router'
import { fetchMe, fetchProviders } from '../lib/api.ts'
import { requireSeat } from '../lib/seat.ts'
import { ArmoryScreen } from './screens/armory-screen.tsx'
import { ErrorScreen } from './screens/error-screen.tsx'
import { LobbyScreen } from './screens/lobby-screen.tsx'
import { MissionScreen, RangeScreen } from './screens/mission-screen.tsx'
import { ProfileScreen } from './screens/profile-screen.tsx'
import { ShopScreen } from './screens/shop-screen.tsx'
import { SignInScreen } from './screens/sign-in-screen.tsx'
import { SkillsScreen } from './screens/skills-screen.tsx'
import { WelcomeScreen } from './screens/welcome-screen.tsx'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

export const meQuery = queryOptions({ queryKey: ['me'], queryFn: fetchMe })
export const providersQuery = queryOptions({
	queryKey: ['providers'],
	queryFn: fetchProviders,
	staleTime: Number.POSITIVE_INFINITY
})

const rootRoute = createRootRouteWithContext<{ queryClient: QueryClient }>()({
	component: () => (
		<div className="flex min-h-dvh flex-col">
			<Outlet />
		</div>
	),
	errorComponent: ErrorScreen
})

// Sends each player to the screen that matches their state
async function destination(client: QueryClient) {
	const me = await client.query(meQuery)
	if (me.status === 'signed-out') return '/play' as const
	return me.player ? ('/play/lobby' as const) : ('/play/welcome' as const)
}

const signInRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/play',
	beforeLoad: async ({ context }) => {
		const target = await destination(context.queryClient)
		if (target !== '/play') throw redirect({ to: target })
		await context.queryClient.query(providersQuery)
	},
	component: SignInScreen
})

const welcomeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/play/welcome',
	beforeLoad: async ({ context }) => {
		const target = await destination(context.queryClient)
		if (target !== '/play/welcome') throw redirect({ to: target })
	},
	component: WelcomeScreen
})

const lobbyRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/play/lobby',
	beforeLoad: async ({ context }) => {
		const target = await destination(context.queryClient)
		if (target !== '/play/lobby') throw redirect({ to: target })
		await requireSeat()
	},
	component: LobbyScreen
})

const missionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/play/mission',
	beforeLoad: async ({ context }) => {
		const target = await destination(context.queryClient)
		if (target !== '/play/lobby') throw redirect({ to: target })
		await requireSeat()
	},
	component: MissionScreen
})

/** Lobby-side screens: signed in, enlisted, holding a seat. */
function hubRoute<P extends '/play/skills' | '/play/armory' | '/play/shop' | '/play/profile'>(
	path: P,
	component: () => React.ReactNode
) {
	return createRoute({
		getParentRoute: () => rootRoute,
		path,
		// the armory and shop open on a tab: ?tab=weapons, armour or equipment
		validateSearch: (search: Record<string, unknown>): { tab?: 'weapons' | 'armour' | 'equipment' } =>
			search.tab === 'weapons' || search.tab === 'armour' || search.tab === 'equipment' ? { tab: search.tab } : {},
		beforeLoad: async ({ context }) => {
			const target = await destination(context.queryClient)
			if (target !== '/play/lobby') throw redirect({ to: target })
			await requireSeat()
		},
		component
	})
}

const rangeRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/play/range',
	beforeLoad: async ({ context }) => {
		const target = await destination(context.queryClient)
		if (target !== '/play/lobby') throw redirect({ to: target })
		await requireSeat()
	},
	component: RangeScreen
})

const skillsRoute = hubRoute('/play/skills', SkillsScreen)
const armoryRoute = hubRoute('/play/armory', ArmoryScreen)
const shopRoute = hubRoute('/play/shop', ShopScreen)
const profileRoute = hubRoute('/play/profile', ProfileScreen)

// "/play/lobby/" and "/play/lobby" are the same screen
if (typeof location !== 'undefined' && location.pathname.length > 1 && location.pathname.endsWith('/'))
	history.replaceState(history.state, '', location.pathname.replace(/\/+$/, '') + location.search + location.hash)

const router = createRouter({
	routeTree: rootRoute.addChildren([
		signInRoute,
		welcomeRoute,
		lobbyRoute,
		skillsRoute,
		armoryRoute,
		shopRoute,
		profileRoute,
		rangeRoute,
		missionRoute
	]),
	context: { queryClient },
	defaultPreload: 'intent'
})

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	)
}
