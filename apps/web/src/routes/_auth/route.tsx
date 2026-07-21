import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { LockGate, useLockHotkey } from "@/components/lock-screen";
import { usePrivacyHotkey } from "@/components/privacy-toggle";
import { MobileBar, Sidebar } from "@/components/sidebar";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_auth")({
	component: AuthLayout,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			throw redirect({ to: "/login" });
		}
		return { session };
	},
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
