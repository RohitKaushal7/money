/**
 * The one gate that lets a fresh install create its owner account without an existing admin session.
 *
 * Pure on purpose: this is the security-critical decision (see the first-run-bootstrap design), so it is
 * unit-tested here, and the router in `routers/setup.ts` does nothing but feed it the live state.
 */
export function canCreateFirstAdmin(
	userCount: number,
	setupCompleted: boolean,
): boolean {
	// The latch dominates. An empty user table means "fresh install" exactly once; after that it can also
	// mean "every account was deleted", and re-opening an unauthenticated create-an-admin endpoint on a
	// live, internet-facing deployment hands it to whoever knocks first.
	if (setupCompleted) return false;
	return userCount === 0;
}
