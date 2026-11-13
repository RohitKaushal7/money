import { authClient } from "@/lib/auth-client";

/**
 * Whether the signed-in user is an admin of this install, or `undefined` while the session is still loading.
 * Admin-only controls can wait for an answer instead of flashing their read-only form first.
 */
export function useIsAdmin(): boolean | undefined {
	const { data: session, isPending } = authClient.useSession();
	if (isPending) return undefined;
	return (session?.user as { role?: string } | undefined)?.role === "admin";
}
