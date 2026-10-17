/**
 * The game screens fill the window and never scroll as a page: their columns scroll on their own
 * (on narrow screens the content area scrolls as one).
 */
export const panes =
	'grid min-h-0 flex-1 gap-6 overflow-y-auto pb-6 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden lg:pb-0'
/** One column of `panes`, scrolling by itself on wide screens. */
export const pane = 'flex flex-col gap-6 lg:min-h-0 lg:overflow-y-auto lg:pr-1 lg:pb-6'
/** A content area that is one scrolling section. */
export const scroller = 'min-h-0 flex-1 overflow-y-auto pr-1 pb-6'
