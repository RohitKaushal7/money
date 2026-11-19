import { Link, useRouterState } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { BAR_DESTINATIONS, isActive, MORE_PATHS } from "@/lib/nav";
import { PrivacyToggle } from "./privacy-toggle";

/**
 * The phone's bottom tab bar: Home · Spending · Plan · Wealth · More, each with its label. Hidden from `md`,
 * where the rail takes over.
 *
 * A floating pill rather than an edge-to-edge strip, and an in-flow sibling of the page rather than fixed
 * over it, so a page's last row ends above the pill instead of sliding under it and no page needs a
 * matching bottom padding. The margin under it clears the home indicator.
 *
 * The current slot gets a tinted capsule behind its icon, not just a colour change: colour alone doesn't
 * survive a glance in sunlight, and the capsule is the shape everyone already reads as "you are here".
 * Concentric by construction: the pill is 64 tall with radius 32; each slot is inset 4 from its ends.
 */
export function TabBarNav() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	return (
		<div className="shrink-0 px-3 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
			<nav
				aria-label="Main"
				className="flex h-16 items-stretch justify-between rounded-[2rem] border border-border bg-card/95 px-1 shadow-[0_10px_30px_rgb(0_0_0/0.18)] backdrop-blur-xl"
			>
				{BAR_DESTINATIONS.map(({ to, label, icon: Icon }) => {
					const active = isActive(to, pathname);
					return (
						<Link
							key={to}
							to={to}
							aria-current={active ? "page" : undefined}
							className="pressable flex flex-1 flex-col items-center justify-center gap-0.5 rounded-[1.75rem]"
						>
							<span
								className={`flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-200 ${
									active
										? "bg-primary/15 text-primary"
										: "text-muted-foreground"
								}`}
							>
								<Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
							</span>
							<span
								className={`text-xs leading-none transition-colors ${
									active
										? "font-medium text-foreground"
										: "text-muted-foreground"
								}`}
							>
								{label}
							</span>
						</Link>
					);
				})}
			</nav>
		</div>
	);
}

/**
 * The phone's top bar. It stays put while the page scrolls in its own pane beneath it.
 *
 * Its title collapses iOS-style: while the page's own large `<h1>` is on screen the bar shows only the
 * wordmark, and once the heading scrolls up under it the bar takes the page title, with a hairline under it.
 * It watches the `<h1>` inside `<main>`, so no page has to register anything.
 *
 * Pages behind More get a back chevron to More: a tab bar with five slots can't light the page you're on,
 * so the way back has to be on screen. The privacy eye stays on the right of every page, since hiding the
 * figures is something you need in public, one-handed, without a menu.
 */
export function PhoneTopBar() {
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const [title, setTitle] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const underMore = MORE_PATHS.some(
		(p) => pathname === p || pathname.startsWith(`${p}/`),
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: re-attach to the new page's heading on every route change
	useEffect(() => {
		setCollapsed(false);
		setTitle(null);
		let observer: IntersectionObserver | undefined;
		let tries = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		// The page mounts after the route resolves (and may render a skeleton first), so look for its heading
		// a few times rather than once.
		const attach = () => {
			const main = document.querySelector("main");
			const h1 = main?.querySelector("h1");
			if (!main || !h1) {
				if (tries++ < 20) timer = setTimeout(attach, 100);
				return;
			}
			setTitle(h1.textContent?.trim() ?? null);
			observer = new IntersectionObserver(
				([entry]) => setCollapsed(!entry.isIntersecting),
				{ root: main, threshold: 0, rootMargin: "-8px 0px 0px 0px" },
			);
			observer.observe(h1);
		};
		attach();
		return () => {
			observer?.disconnect();
			if (timer) clearTimeout(timer);
		};
	}, [pathname]);

	return (
		<header
			className={`relative z-20 shrink-0 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl transition-[border-color] duration-200 md:hidden ${
				collapsed ? "border-border border-b" : "border-transparent border-b"
			}`}
		>
			<div className="relative flex h-12 items-center justify-between px-2">
				<div className="flex min-w-0 items-center">
					{underMore ? (
						<Link
							to="/more"
							aria-label="Back to More"
							className="pressable flex h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-primary"
						>
							<ChevronLeft className="size-6" />
							<span className="text-base">More</span>
						</Link>
					) : (
						<span
							className={`px-2 font-display font-medium text-xl tracking-tight transition-opacity duration-200 ${
								collapsed ? "opacity-0" : "opacity-100"
							}`}
						>
							money
						</span>
					)}
				</div>
				<span
					aria-hidden={!collapsed}
					className={`pointer-events-none absolute inset-x-24 truncate text-center font-medium text-base transition-all duration-200 ${
						collapsed ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
					}`}
				>
					{title}
				</span>
				<PrivacyToggle variant="bar" />
			</div>
		</header>
	);
}
