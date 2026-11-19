/**
 * The whole haptic vocabulary of the app, and the only file that calls `navigator.vibrate`.
 *
 * **Four events and no more.** There is deliberately no general `buzz(ms)` to reach for: once one exists the
 * vocabulary turns into a buzz on every tap, which is the fastest route to someone muting vibration, and the
 * four that matter go with them.
 *
 * | Event | Pattern | When |
 * |---|---|---|
 * | `selected` | 8ms tick | a segment, a filter or a picker row changed under the thumb |
 * | `armed` | 14ms | the first tap of a two-tap delete: "I heard you, tap again" |
 * | `saved` | 10·40·16 | a change landed: an edit saved, a re-tag finished |
 * | `refused` | 30·50·30 | the tap did not land: a wrong PIN, a failed save |
 *
 * **Nothing here carries information.** Every call pairs with something on screen (a toast, a check, a
 * shake), so a phone with vibration off, an iPhone (Safari has no Vibration API) and a laptop all say the
 * same thing. That is what makes it safe to ship with no in-app switch; the OS setting is the switch. A tab
 * change gets nothing: the whole screen changing is feedback enough.
 */
function vibrate(pattern: number | number[]) {
	try {
		if (typeof navigator !== "undefined" && "vibrate" in navigator)
			navigator.vibrate(pattern);
	} catch {
		// Blocked by the browser (no user gesture yet, or a permissions policy). Silent is correct.
	}
}

export const haptics = {
	selected: () => vibrate(8),
	armed: () => vibrate(14),
	saved: () => vibrate([10, 40, 16]),
	refused: () => vibrate([30, 50, 30]),
};
