import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import ReactDOM from "react-dom/client";

import Loader from "./components/loader";
import { preventPageZoom } from "./lib/no-page-zoom";
import { routeTree } from "./routeTree.gen";
import { orpc, queryClient } from "./utils/orpc";

preventPageZoom();

const router = createRouter({
	routeTree,
	defaultPreload: "intent",
	scrollRestoration: true,
	// A short settle between pages (styled in index.css). Only when the page itself changes: a filter or a
	// tab is a search-param change, and animating the whole page on every keystroke in a search box would be
	// noise, not feedback.
	defaultViewTransition: {
		types: ({ pathChanged }) => (pathChanged ? ["page"] : false),
	},
	defaultPendingComponent: () => <Loader />,
	context: { orpc, queryClient },
	Wrap: function WrapComponent({ children }: { children: React.ReactNode }) {
		return (
			<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
		);
	},
});

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}

const rootElement = document.getElementById("app");

if (!rootElement) {
	throw new Error("Root element not found");
}

if (!rootElement.innerHTML) {
	const root = ReactDOM.createRoot(rootElement);
	root.render(<RouterProvider router={router} />);
}
