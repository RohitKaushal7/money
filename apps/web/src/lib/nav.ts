import {
	ArrowLeftRight,
	CreditCard,
	Ellipsis,
	LayoutGrid,
	PiggyBank,
	Receipt,
	Scale,
	Settings,
	ShieldCheck,
	TrendingUp,
	Upload,
	Wallet,
} from "lucide-react";

export type NavPath =
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
	| "/admin"
	| "/more";

export type Destination = {
	to: NavPath;
	label: string;
	icon: typeof LayoutGrid;
	/** earns one of the phone tab bar's five slots */
	inBar?: boolean;
	/** which group of the More screen it is listed under, on a phone */
	moreGroup?: "money" | "app";
	/** a line under the label on the More screen */
	hint?: string;
	adminOnly?: boolean;
	/** the desktop rail skips it (More is a phone-only screen) */
	phoneOnly?: boolean;
};

/**
 * Every place the app can go, in one array. The desktop rail renders all of it; the phone tab bar renders
 * the `inBar` slots, and the More screen lists the rest. Three renderers over one source, so adding a page
 * is an append here rather than three edits that can drift.
 *
 * The bar holds what you open week to week: the north-star (Home), where the money went (Spending), what
 * you're aiming at (Plan), and what you own (Wealth). The monthly and yearly chores — import, reconcile,
 * re-tag, tax — live behind More.
 */
export const DESTINATIONS: Destination[] = [
	{ to: "/", label: "Home", icon: LayoutGrid, inBar: true },
	{ to: "/spending", label: "Spending", icon: TrendingUp, inBar: true },
	{ to: "/plan", label: "Plan", icon: PiggyBank, inBar: true },
	{ to: "/wealth", label: "Wealth", icon: Wallet, inBar: true },
	{
		to: "/transactions",
		label: "Transactions",
		icon: ArrowLeftRight,
		moreGroup: "money",
		hint: "Every statement row, rules and categories",
	},
	{
		to: "/reconcile",
		label: "Reconcile",
		icon: Scale,
		moreGroup: "money",
		hint: "Plan against what actually happened",
	},
	{
		to: "/import",
		label: "Import",
		icon: Upload,
		moreGroup: "money",
		hint: "Add a bank or card statement",
	},
	{
		to: "/cards",
		label: "Cards",
		icon: CreditCard,
		moreGroup: "money",
		hint: "Which card to use where",
	},
	{
		to: "/tax",
		label: "Tax",
		icon: Receipt,
		moreGroup: "money",
		hint: "Old vs new regime for the year",
	},
	{ to: "/settings", label: "Settings", icon: Settings, moreGroup: "app" },
	{
		to: "/admin",
		label: "Admin",
		icon: ShieldCheck,
		moreGroup: "app",
		adminOnly: true,
	},
	{
		to: "/more",
		label: "More",
		icon: Ellipsis,
		inBar: true,
		phoneOnly: true,
	},
];

/** The phone tab bar, in order: Home · Spending · Plan · Wealth · More. */
export const BAR_DESTINATIONS = DESTINATIONS.filter((d) => d.inBar);

/** Paths that live behind More: the More tab reads as "you are here" on each of them. */
export const MORE_PATHS = DESTINATIONS.filter((d) => d.moreGroup).map(
	(d) => d.to,
);

/** Whether a destination is the current page. Home matches exactly; every other path by prefix. */
export function isActive(to: NavPath, pathname: string): boolean {
	if (to === "/") return pathname === "/";
	if (to === "/more")
		return (
			pathname === "/more" ||
			MORE_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
		);
	return pathname === to || pathname.startsWith(`${to}/`);
}
