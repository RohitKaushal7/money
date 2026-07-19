import { Link } from "@tanstack/react-router";
import {
	ArrowLeftRight,
	LayoutGrid,
	PiggyBank,
	Receipt,
	Settings,
} from "lucide-react";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

type NavItem = {
	label: string;
	icon: typeof LayoutGrid;
	/** present = a real route; absent = a "soon" placeholder */
	to?: "/" | "/plan";
};

const NAV: NavItem[] = [
	{ label: "Overview", icon: LayoutGrid, to: "/" },
	{ label: "Plan", icon: PiggyBank, to: "/plan" },
	{ label: "Transactions", icon: ArrowLeftRight },
	{ label: "Tax", icon: Receipt },
	{ label: "Settings", icon: Settings },
];

const BASE =
	"flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors";
const INACTIVE = `${BASE} text-muted-foreground hover:bg-secondary/50 hover:text-foreground`;
const ACTIVE = `${BASE} bg-secondary font-medium text-secondary-foreground`;

/** Left navigation rail (desktop). The wordmark lives here, not in a top header. */
export function Sidebar() {
	return (
		<aside className="hidden w-60 shrink-0 flex-col border-border border-r bg-card/40 md:flex">
			<div className="px-6 py-6">
				<span className="font-display font-medium text-2xl tracking-tight">
					money
				</span>
				<p className="mt-0.5 text-[0.7rem] text-muted-foreground">
					passive income vs the life you spend
				</p>
			</div>
			<nav className="flex flex-1 flex-col gap-0.5 px-3">
				{NAV.map((item) =>
					item.to ? (
						<Link
							key={item.label}
							to={item.to}
							activeOptions={item.to === "/" ? { exact: true } : undefined}
							inactiveProps={{ className: INACTIVE }}
							activeProps={{ className: ACTIVE }}
						>
							<item.icon className="size-4" />
							{item.label}
						</Link>
					) : (
						<span
							key={item.label}
							className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-muted-foreground/55 text-sm"
						>
							<item.icon className="size-4" />
							{item.label}
							<span className="ml-auto text-[0.6rem] uppercase tracking-wider">
								soon
							</span>
						</span>
					),
				)}
			</nav>
			<div className="flex items-center justify-between gap-2 border-border border-t px-4 py-4">
				<UserMenu />
				<ModeToggle />
			</div>
		</aside>
	);
}

/** Slim top bar for narrow screens where the sidebar is hidden. */
export function MobileBar() {
	return (
		<div className="flex items-center justify-between border-border border-b px-5 py-3 md:hidden">
			<span className="font-display font-medium text-xl tracking-tight">
				money
			</span>
			<ModeToggle />
		</div>
	);
}
