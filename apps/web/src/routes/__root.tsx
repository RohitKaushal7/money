import { Toaster } from "@money/ui/components/sonner";
import { useIsPhone } from "@money/ui/hooks/use-media-query";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";

import { NavProgress } from "@/components/nav-progress";
import { ThemeProvider } from "@/components/theme-provider";
import type { orpc } from "@/utils/orpc";

import "../index.css";

export interface RouterAppContext {
	orpc: typeof orpc;
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	head: () => ({
		meta: [
			{
				title: "money",
			},
			{
				name: "description",
				content: "How much of your spending your passive income covers.",
			},
		],
		links: [
			{
				rel: "icon",
				href: "/favicon.ico",
			},
		],
	}),
});

function RootComponent() {
	// On a phone a toast drops in under the top bar, where iOS and Android put their own banners, instead of
	// rising out of the tab bar and covering it.
	const phone = useIsPhone();
	return (
		<>
			<HeadContent />
			<ThemeProvider
				attribute="class"
				defaultTheme="dark"
				disableTransitionOnChange
				storageKey="vite-ui-theme"
			>
				<NavProgress />
				<Outlet />
				<Toaster
					richColors
					position={phone ? "top-center" : "bottom-right"}
					mobileOffset={{ top: "calc(env(safe-area-inset-top) + 3.5rem)" }}
				/>
			</ThemeProvider>
			<TanStackRouterDevtools position="top-right" />
			<ReactQueryDevtools position="bottom" buttonPosition="bottom-right" />
		</>
	);
}
