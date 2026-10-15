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
import { ErrorScreen } from './screens/error-screen.tsx'
import { LobbyScreen } from './screens/lobby-screen.tsx'
import { MissionScreen } from './screens/mission-screen.tsx'
import { SignInScreen } from './screens/sign-in-screen.tsx'
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
	},
	component: LobbyScreen
})

const missionRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: '/play/mission',
	beforeLoad: async ({ context }) => {
		const target = await destination(context.queryClient)
		if (target !== '/play/lobby') throw redirect({ to: target })
	},
	component: MissionScreen
})

const router = createRouter({
	routeTree: rootRoute.addChildren([signInRoute, welcomeRoute, lobbyRoute, missionRoute]),
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
