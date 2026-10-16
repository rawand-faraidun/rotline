import { en } from '../../i18n/en.ts'
import { useSeatKeeper } from '../../lib/seat.ts'

/** Keeps the player's seat while the app is open and warns before an idle player loses it. */
export function SeatKeeper() {
	const { idleWarning } = useSeatKeeper()
	if (!idleWarning) return null
	return (
		<div role="alert" className="fixed inset-x-0 top-0 z-50 flex justify-center p-3">
			<p className="cut border-rot-black border-l-8 bg-warning px-5 py-3 font-bold text-rot-black">
				{en.app.idleWarning}
			</p>
		</div>
	)
}
