import { createFileRoute, redirect } from "@tanstack/react-router";

import SignInForm from "@/components/sign-in-form";
import { client } from "@/utils/orpc";

export const Route = createFileRoute("/login")({
	component: RouteComponent,
	// A fresh install has no owner yet → send them to create one instead of a dead sign-in form.
	beforeLoad: async () => {
		const { needsSetup } = await client.setup.status();
		if (needsSetup) {
			throw redirect({ to: "/setup" });
		}
	},
});

function RouteComponent() {
	return <SignInForm />;
}
