import type { AppRouterClient } from "@money/api/routers/index";
import { env } from "@money/env/web";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { closeLock, unlockToken } from "@/lib/lock";

export function createQueryClient() {
	return new QueryClient({
		queryCache: new QueryCache({
			onError: (error, query) => {
				// The screen lock closing mid-flight. Not an error to shout about — flip the UI to the lock
				// screen and let the user back in. Without this the page would fill with error toasts.
				if ((error as { code?: string }).code === "LOCKED") {
					closeLock();
					return;
				}
				if ((error as { code?: string }).code === "UNAUTHORIZED") {
					if (
						typeof window !== "undefined" &&
						window.location.pathname !== "/login"
					) {
						window.location.href = "/login";
					}
					return;
				}
				toast.error(`Error: ${error.message}`, {
					action: {
						label: "retry",
						onClick: () => {
							query.invalidate();
						},
					},
				});
			},
		}),
	});
}

export const queryClient = createQueryClient();

function getServerUrl(url: string) {
	const normalized = url.endsWith("/") ? url.slice(0, -1) : url;

	// Absolute URL (dev: http://localhost:3000) → use as-is. A "/"-prefixed value — including "/" itself,
	// which normalizes to "" — is relative and resolves against the current origin (single-origin prod).
	if (normalized !== "" && !normalized.startsWith("/")) {
		return normalized;
	}

	if (typeof window !== "undefined") {
		return `${window.location.origin}${normalized}`;
	}

	const processEnv = (
		globalThis as {
			process?: { env?: Record<string, string | undefined> };
		}
	).process?.env;
	const vercelUrl =
		processEnv?.VERCEL_ENV === "production"
			? (processEnv?.VERCEL_PROJECT_PRODUCTION_URL ?? processEnv?.VERCEL_URL)
			: (processEnv?.VERCEL_URL ?? processEnv?.VERCEL_PROJECT_PRODUCTION_URL);
	if (vercelUrl) {
		const origin = vercelUrl.startsWith("http")
			? vercelUrl
			: `https://${vercelUrl}`;
		return `${origin}${normalized}`;
	}

	return `http://localhost:3000${normalized}`;
}
export const link = new RPCLink({
	url: `${getServerUrl(env.VITE_SERVER_URL)}/rpc`,
	// Read per request, not captured once: the token changes as you lock and unlock, and a stale closure
	// here would send yesterday's pass forever.
	headers: () => {
		const token = unlockToken();
		return token ? { "x-unlock-token": token } : {};
	},
	fetch(url, options) {
		return fetch(url, {
			...options,
			credentials: "include",
		});
	},
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
