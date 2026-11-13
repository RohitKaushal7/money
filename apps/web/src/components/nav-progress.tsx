import { useIsFetching } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/** Below this, a load is quick enough that a flashing bar would be noise rather than feedback. */
const SHOW_AFTER_MS = 150;

/**
 * A thin bar across the top of the screen while the app is actually waiting: a route change still
 * resolving (its guard or code chunk), or a query with nothing cached to show yet. Background refetches
 * of data already on screen don't count — the page is usable during those, so a bar would only nag.
 */
export function NavProgress() {
	const routing = useRouterState({ select: (s) => s.status === "pending" });
	const firstLoads = useIsFetching({
		predicate: (q) => q.state.data === undefined,
	});
	const busy = routing || firstLoads > 0;
	const [phase, setPhase] = useState<"idle" | "running" | "done">("idle");

	useEffect(() => {
		if (busy) {
			const t = setTimeout(() => setPhase("running"), SHOW_AFTER_MS);
			return () => clearTimeout(t);
		}
		setPhase((p) => (p === "running" ? "done" : p));
	}, [busy]);

	useEffect(() => {
		if (phase !== "done") return;
		const t = setTimeout(() => setPhase("idle"), 450);
		return () => clearTimeout(t);
	}, [phase]);

	if (phase === "idle") return null;
	return (
		<div
			role="progressbar"
			aria-label="Loading"
			aria-busy={phase === "running"}
			className="pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5"
		>
			<div
				className={`h-full origin-left bg-primary ${phase === "running" ? "nav-progress-run" : "nav-progress-done"}`}
			/>
		</div>
	);
}
