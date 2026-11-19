import { useCallback, useSyncExternalStore } from "react";

/**
 * Live media-query match, read synchronously on first render so there is no flash of the wrong layout.
 * For the cases where hiding with CSS isn't enough because the two layouts are different components.
 */
export function useMediaQuery(query: string): boolean {
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

/**
 * A phone: narrower than Tailwind's `md`. This is where popovers become bottom sheets and tables become
 * lists. Width rather than pointer type, so a narrow desktop window gets the same layout as a phone.
 */
export function useIsPhone(): boolean {
	return useMediaQuery("(max-width: 767px)");
}
