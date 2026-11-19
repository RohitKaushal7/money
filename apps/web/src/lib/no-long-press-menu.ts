/**
 * No browser menu on a long press. On Android Chrome a long press on a link (every nav item, every row that
 * navigates) opens "Open in new tab / Copy link address / Download link", and on an image or plain text it
 * opens its own sheet: the browser showing through the app. An installed app has no such menu.
 *
 * Touch only, and only for the app's own surface: a long press inside a field still gets the system's
 * paste/select menu, and so does text that has deliberately been left selectable (amounts, narrations, see
 * index.css). A mouse right-click on a desktop is left alone entirely: there, a context menu is expected.
 */
export function preventLongPressMenu() {
	const coarse = window.matchMedia("(pointer: coarse)");
	document.addEventListener("contextmenu", (e) => {
		const touch =
			(e as PointerEvent).pointerType === "touch" ||
			((e as PointerEvent).pointerType === undefined && coarse.matches);
		if (!touch) return;
		const target = e.target as Element | null;
		if (!target?.closest) return;
		if (target.closest("input, textarea, [contenteditable='true']")) return;
		const selectable = target.closest(".tnum, .select-text, [data-selectable]");
		const insideControl = target.closest(
			"a, button, label, [role='button'], [role='tab'], [role='switch'], [role='option']",
		);
		if (selectable && !insideControl) return;
		e.preventDefault();
	});
}
