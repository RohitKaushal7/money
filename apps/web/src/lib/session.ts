import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";

const SESSION_KEY = ["auth", "session"] as const;

/**
 * The signed-in session, for route guards. Cached in React Query rather than fetched per navigation: the
 * `_auth` guard runs on every route change, and a fresh `getSession()` there put a full network round trip
 * in front of every click. A stale cached session is safe — it is refreshed in the background, and any
 * API call made with an expired one comes back UNAUTHORIZED, which already sends you to /login.
 */
export async function requireSession(queryClient: QueryClient) {
	const session = await queryClient.ensureQueryData({
		queryKey: SESSION_KEY,
		queryFn: async () => (await authClient.getSession()).data ?? null,
		staleTime: 5 * 60_000,
		revalidateIfStale: true,
	});
	if (!session) {
		// Never cache "signed out": the next visit, right after signing in, must ask again.
		queryClient.removeQueries({ queryKey: SESSION_KEY });
		throw redirect({ to: "/login" });
	}
	return session;
}

/**
 * Sign out and drop every cached query. Without the clear, the next person to sign in on this tab would
 * see the previous user's figures until each query refetched.
 */
export async function signOutAndClear(queryClient: QueryClient) {
	await authClient.signOut();
	queryClient.clear();
}
