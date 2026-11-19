import { Link, useRouter, useRouterState } from "@tanstack/react-router";
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
 *
 * It reads whatever `<main> h1` is in the page pane *right now*, on every DOM change in the pane and every
 * scroll, instead of attaching to a heading once per navigation. Attaching once was the bug: a navigation
 * fires before the new page has replaced the old one, so the bar latched onto the outgoing page's heading,
 * and when that heading was then detached it read as "scrolled away" and the bar showed the previous
 * page's title. Reading live has no stale state to get wrong. It is cheap: one rAF-batched querySelector and
 * two rects.
 *
 * Pages behind More get a back chevron to More: a tab bar with five slots can't light the page you're on,
 * so the way back has to be on screen. A page one level deeper names its own parent with
 * `<main data-back-to="/settings" data-back-label="Settings">`. The privacy eye stays on the right of every
 * page, since hiding the figures is something you need in public, one-handed, without a menu.
 */
export function PhoneTopBar() {
	const router = useRouter();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const [title, setTitle] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const [back, setBack] = useState<{ to: string; label: string } | null>(null);
	const underMore = MORE_PATHS.some(
		(p) => pathname === p || pathname.startsWith(`${p}/`),
	);

	useEffect(() => {
		const pane = document.querySelector<HTMLElement>("[data-page-pane]");
		if (!pane) return;
		let frame = 0;
		let scroller: HTMLElement | null = null;
		const schedule = () => {
			if (!frame) frame = requestAnimationFrame(read);
		};
		function read() {
			frame = 0;
			const main = pane?.querySelector("main") ?? null;
			if (main !== scroller) {
				scroller?.removeEventListener("scroll", schedule);
				main?.addEventListener("scroll", schedule, { passive: true });
				scroller = main;
			}
			const h1 = main?.querySelector("h1");
			setTitle(h1?.textContent?.trim() || null);
			const to = main?.dataset.backTo;
			setBack(to ? { to, label: main?.dataset.backLabel ?? "Back" } : null);
			if (!main || !h1) {
				setCollapsed(false);
				return;
			}
			setCollapsed(
				h1.getBoundingClientRect().bottom <
					main.getBoundingClientRect().top + 8,
			);
		}
		const watch = new MutationObserver(schedule);
		watch.observe(pane, {
			childList: true,
			subtree: true,
			characterData: true,
			attributes: true,
			attributeFilter: ["data-back-to", "data-back-label"],
		});
		read();
		return () => {
			watch.disconnect();
			scroller?.removeEventListener("scroll", schedule);
			if (frame) cancelAnimationFrame(frame);
		};
	}, []);

	const backTarget =
		back ?? (underMore ? { to: "/more", label: "More" } : null);

	return (
		<header
			className={`relative z-20 shrink-0 bg-background/90 pt-[env(safe-area-inset-top)] backdrop-blur-xl transition-[border-color] duration-200 md:hidden ${
				collapsed ? "border-border border-b" : "border-transparent border-b"
			}`}
		>
			<div className="relative flex h-12 items-center justify-between px-2">
				<div className="flex min-w-0 items-center">
					{backTarget ? (
						<button
							type="button"
							onClick={() => router.history.push(backTarget.to)}
							aria-label={`Back to ${backTarget.label}`}
							className="pressable flex h-11 items-center gap-0.5 rounded-full pr-3 pl-1 text-primary"
						>
							<ChevronLeft className="size-6" />
							<span className="text-base">{backTarget.label}</span>
						</button>
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
