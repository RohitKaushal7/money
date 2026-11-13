import { createFileRoute, Outlet } from "@tanstack/react-router";

import { LockGate, useLockHotkey } from "@/components/lock-screen";
import { usePrivacyHotkey } from "@/components/privacy-toggle";
import { MobileBar, Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/session";

export const Route = createFileRoute("/_auth")({
	component: AuthLayout,
	beforeLoad: async ({ context }) => ({
		session: await requireSession(context.queryClient),
	}),
});

function AuthLayout() {
	usePrivacyHotkey();
	useLockHotkey();
	return (
		<LockGate>
			<div className="flex h-svh">
				<Sidebar />
				<div className="flex min-h-0 min-w-0 flex-1 flex-col">
					<MobileBar />
					<Outlet />
				</div>
			</div>
		</LockGate>
	);
}
