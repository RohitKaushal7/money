/**
 * The one gate that lets a fresh install create its owner account without an existing admin session.
 *
 * Pure on purpose: this is the security-critical decision (see the first-run-bootstrap design), so it is
 * unit-tested here, and the router in `routers/setup.ts` does nothing but feed it the live user count.
 */
export function canCreateFirstAdmin(userCount: number): boolean {
	return userCount === 0;
}
