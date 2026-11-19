import { createFileRoute, Outlet } from "@tanstack/react-router";

import { LockGate, useLockHotkey } from "@/components/lock-screen";
import { PhoneTopBar, TabBarNav } from "@/components/phone-nav";
import { usePrivacyHotkey } from "@/components/privacy-toggle";
import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/session";

export const Route = createFileRoute("/_auth")({
	component: AuthLayout,
	beforeLoad: async ({ context }) => ({
		session: await requireSession(context.queryClient),
	}),
});

/**
 * The app shell. Desktop: rail | page. Phone: top bar / page / tab bar, stacked in one screen-tall column,
 * with only the page scrolling (each page's own `<main>`), so the bars never move and never cover content.
 */
function AuthLayout() {
	usePrivacyHotkey();
	useLockHotkey();
	return (
		<LockGate>
			<div className="flex h-dvh">
				<Sidebar />
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<PhoneTopBar />
					<div className="min-h-0 flex-1">
						<Outlet />
					</div>
					<TabBarNav />
				</div>
			</div>
		</LockGate>
	);
}
