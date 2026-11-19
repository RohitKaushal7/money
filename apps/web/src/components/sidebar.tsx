import { Link } from "@tanstack/react-router";
import { useIsAdmin } from "@/lib/admin";
import { DESTINATIONS } from "@/lib/nav";
import { ModeToggle } from "./mode-toggle";
import { PrivacyToggle } from "./privacy-toggle";
import UserMenu from "./user-menu";

const BASE =
	"flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors md:max-lg:justify-center md:max-lg:px-0 md:max-lg:py-2.5";
const INACTIVE = `${BASE} text-muted-foreground hover:bg-secondary/50 hover:text-foreground`;
const ACTIVE = `${BASE} bg-secondary font-medium text-secondary-foreground`;

/**
 * Left navigation rail, from `md` up. A phone gets the tab bar instead (see phone-nav.tsx).
 *
 * Between `md` and `lg` (a tablet, a narrow window) the rail folds to icons so the page keeps its width;
 * the labels come back as tooltips via `title`. From `lg` it is the full rail with the wordmark.
 */
export function Sidebar() {
	const isAdmin = useIsAdmin() === true;
	const items = DESTINATIONS.filter(
		(d) => !d.phoneOnly && (!d.adminOnly || isAdmin),
	);
	return (
		<aside className="hidden shrink-0 flex-col border-border border-r bg-card/40 md:flex md:w-16 lg:w-60">
			<div className="px-6 py-6 md:max-lg:px-0 md:max-lg:text-center">
				<span className="font-display font-medium text-2xl tracking-tight">
					<span className="lg:hidden">m</span>
					<span className="hidden lg:inline">money</span>
				</span>
				<p className="mt-0.5 hidden text-muted-foreground text-xs lg:block">
					passive income vs the life you spend
				</p>
			</div>
			<nav className="flex flex-1 flex-col gap-0.5 px-3 md:max-lg:px-2">
				{items.map((item) => (
					<Link
						key={item.to}
						to={item.to}
						title={item.label}
						activeOptions={item.to === "/" ? { exact: true } : undefined}
						inactiveProps={{ className: INACTIVE }}
						activeProps={{ className: ACTIVE }}
					>
						<item.icon className="size-4 shrink-0" />
						<span className="md:max-lg:sr-only">{item.label}</span>
					</Link>
				))}
			</nav>
			<div className="flex items-center justify-between gap-2 border-border border-t px-4 py-4 md:max-lg:flex-col md:max-lg:px-2">
				<div className="md:max-lg:hidden">
					<UserMenu />
				</div>
				<div className="flex items-center gap-2 md:max-lg:flex-col">
					<PrivacyToggle />
					<ModeToggle />
				</div>
			</div>
		</aside>
	);
}
