/**
 * The page does not zoom. A pinch on a phone scaled the whole app like a web page, which an installed app
 * never does. Three layers, because each browser honours a different one:
 *
 * - the viewport meta in index.html (`maximum-scale=1, user-scalable=no`), which Android Chrome and an
 *   installed PWA respect;
 * - `touch-action: pan-x pan-y` on the root in index.css, which rules out a pinch and a double-tap zoom
 *   everywhere beneath it, and is what iOS Safari respects since it started ignoring `user-scalable=no`;
 * - and here, iOS's own `gesture*` events for the Safaris that honour neither, plus a trackpad pinch on a
 *   laptop, which arrives as a wheel event with `ctrlKey` set.
 *
 * Keyboard zoom (Ctrl/⌘ with + and −) is left alone on purpose: it is how someone who needs larger text asks
 * for it on a desktop. And the other way a phone zooms, into a focused field whose text is under 16px, is
 * fixed at the source: every input in @money/ui is 16px on a touch screen.
 */
export function preventPageZoom() {
	const stop = (e: Event) => e.preventDefault();
	document.addEventListener("gesturestart", stop, { passive: false });
	document.addEventListener("gesturechange", stop, { passive: false });
	window.addEventListener(
		"wheel",
		(e) => {
			if (e.ctrlKey) e.preventDefault();
		},
		{ passive: false },
	);
}
