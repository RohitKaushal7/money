import { useCallback, useSyncExternalStore } from "react";

/**
 * Live viewport matching, for the cases where `hidden md:block` isn't enough.
 *
 * CSS is the right tool for hiding something. It is the wrong tool for *not building* it: a display:none
 * chart still mounts, still fires its query, and still runs its layout pass. Where the mobile answer is
 * "this doesn't exist here", branch in JS and never construct it.
 *
 * `matchMedia` is read synchronously during the first render, so there is no flash of the wrong layout.
 */
function useMediaQuery(query: string): boolean {
	const subscribe = useCallback(
		(onChange: () => void) => {
			const mql = window.matchMedia(query);
			mql.addEventListener("change", onChange);
			return () => mql.removeEventListener("change", onChange);
		},
		[query],
	);
	return useSyncExternalStore(
		subscribe,
		() => window.matchMedia(query).matches,
		() => false,
	);
}

/** Tailwind's `md` and up — the width at which the Plan page has room for both columns side by side. */
export function useIsDesktop(): boolean {
	return useMediaQuery("(min-width: 768px)");
}
