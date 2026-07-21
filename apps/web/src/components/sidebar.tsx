import { Link } from "@tanstack/react-router";
import {
	ArrowLeftRight,
	CreditCard,
	LayoutGrid,
	Menu,
	PiggyBank,
	Receipt,
	Scale,
	Settings,
	ShieldCheck,
	TrendingUp,
	Upload,
	Wallet,
	X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { ModeToggle } from "./mode-toggle";
import { PrivacyToggle } from "./privacy-toggle";
import UserMenu from "./user-menu";

type NavItem = {
	label: string;
	icon: typeof LayoutGrid;
	/** present = a real route; absent = a "soon" placeholder */
	to?:
		| "/"
		| "/plan"
		| "/wealth"
		| "/reconcile"
		| "/spending"
		| "/transactions"
		| "/import"
		| "/cards"
		| "/tax"
		| "/settings"
		| "/admin";
	/** admin-only links are hidden for regular users */
	adminOnly?: boolean;
};

const NAV: NavItem[] = [
	{ label: "Overview", icon: LayoutGrid, to: "/" },
	{ label: "Plan", icon: PiggyBank, to: "/plan" },
	{ label: "Wealth", icon: Wallet, to: "/wealth" },
	{ label: "Reconcile", icon: Scale, to: "/reconcile" },
	{ label: "Spending", icon: TrendingUp, to: "/spending" },
	{ label: "Transactions", icon: ArrowLeftRight, to: "/transactions" },
	{ label: "Import", icon: Upload, to: "/import" },
	{ label: "Cards", icon: CreditCard, to: "/cards", adminOnly: true },
	{ label: "Tax", icon: Receipt, to: "/tax" },
	{ label: "Settings", icon: Settings, to: "/settings" },
	{ label: "Admin", icon: ShieldCheck, to: "/admin", adminOnly: true },
];

const BASE =
	"flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors";
const INACTIVE = `${BASE} text-muted-foreground hover:bg-secondary/50 hover:text-foreground`;
const ACTIVE = `${BASE} bg-secondary font-medium text-secondary-foreground`;

function useIsAdmin() {
	const { data: session } = authClient.useSession();
	return (session?.user as { role?: string } | undefined)?.role === "admin";
}

/** The wordmark + tagline, shared by the desktop rail and the mobile drawer. */
function Wordmark() {
	return (
		<div>
			<span className="font-display font-medium text-2xl tracking-tight">
				money
			</span>
			<p className="mt-0.5 text-[0.7rem] text-muted-foreground">
				passive income vs the life you spend
			</p>
		</div>
	);
}

/** The nav list, shared by the desktop rail and the mobile drawer. */
function NavList({
	isAdmin,
	onNavigate,
}: {
	isAdmin: boolean;
	onNavigate?: () => void;
}) {
	const items = NAV.filter((item) => !item.adminOnly || isAdmin);
	return (
		<nav className="flex flex-1 flex-col gap-0.5 px-3">
			{items.map((item) =>
				item.to ? (
					<Link
						key={item.label}
						to={item.to}
						onClick={onNavigate}
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
	);
}

/** Left navigation rail (desktop). The wordmark lives here, not in a top header. */
export function Sidebar() {
	const isAdmin = useIsAdmin();
	return (
		<aside className="hidden w-60 shrink-0 flex-col border-border border-r bg-card/40 md:flex">
			<div className="px-6 py-6">
				<Wordmark />
			</div>
			<NavList isAdmin={isAdmin} />
			<div className="flex items-center justify-between gap-2 border-border border-t px-4 py-4">
				<UserMenu />
				<div className="flex items-center gap-2">
					<PrivacyToggle />
					<ModeToggle />
				</div>
			</div>
		</aside>
	);
}

/** Slim top bar for narrow screens, with a hamburger that opens the nav drawer. */
export function MobileBar() {
	const [open, setOpen] = useState(false);
	const isAdmin = useIsAdmin();

	// Close on Escape while the drawer is open.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	return (
		<div className="md:hidden">
			<div className="flex items-center justify-between border-border border-b px-4 py-3">
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => setOpen(true)}
						aria-label="Open navigation"
						aria-expanded={open}
						className="-ml-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
					>
						<Menu className="size-5" />
					</button>
					<span className="font-display font-medium text-xl tracking-tight">
						money
					</span>
				</div>
				{/* On a phone there's no ⇧H, so the toggle has to be reachable without opening the drawer. */}
				<div className="flex items-center gap-2">
					<PrivacyToggle />
					<ModeToggle />
				</div>
			</div>

			{/*
			 * Drawer stays mounted so it can slide in/out (transform + opacity only).
			 * `inert` when closed removes it from tab order and pointer handling.
			 */}
			<div
				className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`}
				inert={!open}
			>
				<button
					type="button"
					aria-label="Close navigation"
					onClick={() => setOpen(false)}
					className={`absolute inset-0 bg-foreground/30 transition-opacity duration-300 ${
						open ? "opacity-100" : "opacity-0"
					}`}
				/>
				<aside
					className={`absolute inset-y-0 left-0 flex w-72 max-w-[82%] flex-col border-border border-r bg-card shadow-xl transition-transform duration-300 ease-out ${
						open ? "translate-x-0" : "-translate-x-full"
					}`}
				>
					<div className="flex items-start justify-between px-5 py-4">
						<Wordmark />
						<button
							type="button"
							onClick={() => setOpen(false)}
							aria-label="Close navigation"
							className="-mr-1.5 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
						>
							<X className="size-5" />
						</button>
					</div>
					<NavList isAdmin={isAdmin} onNavigate={() => setOpen(false)} />
					<div className="flex items-center justify-between gap-2 border-border border-t px-4 py-4">
						<UserMenu />
						<ModeToggle />
					</div>
				</aside>
			</div>
		</div>
	);
}
