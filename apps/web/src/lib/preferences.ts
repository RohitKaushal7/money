import { useCallback, useSyncExternalStore } from "react";

/**
 * Client-side preferences, persisted to localStorage.
 *
 * These are *view* choices — how you like the app arranged, and the assumptions you want projections drawn
 * under. Nothing here is durable financial state, which is why it lives in the browser rather than in the
 * per-user SQLite: it costs nothing if it's lost, and it must not require a round trip to read.
 *
 * Add a key by adding a default to {@link DEFAULTS}. The default is both the fallback and the type — there
 * is no second place to register it and no way for the two to drift apart.
 */
const DEFAULTS = {
	/** which view the net-worth chart is showing */
	"wealth.chartMode": "history" as "history" | "runway",
	/** does the runway projection let the balance keep earning? */
	"runway.returns": true,
	/** does it let spending get more expensive? */
	"runway.inflation": true,
	/** annual expense inflation, as a fraction. India's long-run CPI sits near 6%. */
	"runway.inflationRate": 0.06,
};

export type Preferences = typeof DEFAULTS;
export type PreferenceKey = keyof Preferences;

const NAMESPACE = "money.pref.";

/**
 * Subscribers, keyed by preference. A `Set` per key so a component reading one preference is not woken by
 * an unrelated one, and so the `storage` event (which fires only in *other* tabs) can wake the right ones.
 */
const listeners = new Map<string, Set<() => void>>();

function notify(key: string) {
	for (const fn of listeners.get(key) ?? []) fn();
}

if (typeof window !== "undefined") {
	window.addEventListener("storage", (e) => {
		if (e.key?.startsWith(NAMESPACE)) notify(e.key.slice(NAMESPACE.length));
	});
}

/**
 * Cache of parsed values. `useSyncExternalStore` demands a `getSnapshot` that returns a stable reference
 * for unchanged data — re-parsing JSON on every render would hand React a new object each time and spin
 * forever. Writes are the only thing that invalidate it.
 */
const cache = new Map<string, unknown>();

export function readPreference<K extends PreferenceKey>(
	key: K,
): Preferences[K] {
	if (cache.has(key)) return cache.get(key) as Preferences[K];
	const fallback = DEFAULTS[key];
	let value = fallback;
	try {
		const raw = window.localStorage.getItem(NAMESPACE + key);
		if (raw != null) {
			const parsed = JSON.parse(raw) as Preferences[K];
			// A stored value whose type no longer matches the default is from an older shape of the app.
			// Preferences are disposable, so drop it silently rather than crashing a page over a checkbox.
			if (typeof parsed === typeof fallback) value = parsed;
		}
	} catch {
		// Private mode, a full quota, or corrupt JSON. The default is always a valid answer.
	}
	cache.set(key, value);
	return value;
}

export function writePreference<K extends PreferenceKey>(
	key: K,
	value: Preferences[K],
): void {
	cache.set(key, value);
	try {
		window.localStorage.setItem(NAMESPACE + key, JSON.stringify(value));
	} catch {
		// Unwritable storage still gets the in-memory update above: the preference works for this session
		// and simply doesn't survive a reload. Better than a failed click.
	}
	notify(key);
}

/**
 * Read and write one preference, `useState`-style. Every component reading the same key re-renders together
 * — so a toggle in the chart header and a number on a card below it can never disagree.
 */
export function usePreference<K extends PreferenceKey>(
	key: K,
): [Preferences[K], (value: Preferences[K]) => void] {
	const subscribe = useCallback(
		(onChange: () => void) => {
			const set = listeners.get(key) ?? new Set();
			set.add(onChange);
			listeners.set(key, set);
			return () => {
				set.delete(onChange);
			};
		},
		[key],
	);

	const value = useSyncExternalStore(
		subscribe,
		() => readPreference(key),
		() => DEFAULTS[key],
	);

	const set = useCallback(
		(next: Preferences[K]) => writePreference(key, next),
		[key],
	);

	return [value, set];
}

/**
 * The runway assumptions, resolved against the portfolio's actual blended return.
 *
 * A switched-off force is simply zero, so {@link runwayProjection} never needs to know a toggle exists —
 * and both off is not a special case, it is the naive `totalValue / annualExpenses` falling out of the same
 * arithmetic. Shared by the chart and the metric card so the two cannot report different years.
 */
export function useRunwayAssumptions(
	portfolioReturn: number | null | undefined,
) {
	const [returnsOn, setReturnsOn] = usePreference("runway.returns");
	const [inflationOn, setInflationOn] = usePreference("runway.inflation");
	const [inflationRate, setInflationRate] = usePreference(
		"runway.inflationRate",
	);
	return {
		assumptions: {
			annualReturn: returnsOn ? (portfolioReturn ?? 0) : 0,
			inflation: inflationOn ? inflationRate : 0,
		},
		returnsOn,
		setReturnsOn,
		inflationOn,
		setInflationOn,
		inflationRate,
		setInflationRate,
	};
}
