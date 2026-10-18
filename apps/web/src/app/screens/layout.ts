/**
 * The game screens fill the window and never scroll as a page: their columns scroll on their own
 * (on narrow screens the content area scrolls as one).
 */
export const panes =
	'no-scrollbar grid min-h-0 flex-1 gap-4 overflow-y-auto pb-4 lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden lg:pb-0'
/** One column of `panes`, scrolling by itself on wide screens. */
export const pane = 'no-scrollbar flex flex-col gap-4 lg:min-h-0 lg:overflow-y-auto'
/** A content area that is one scrolling section. */
export const scroller = 'no-scrollbar min-h-0 flex-1 overflow-y-auto'
