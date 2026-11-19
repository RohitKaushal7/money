import { Button } from "@money/ui/components/button";
import { Skeleton } from "@money/ui/components/skeleton";
import { useIsPhone } from "@money/ui/hooks/use-media-query";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	Bot,
	Check,
	Coins,
	Download,
	KeyRound,
	RefreshCw,
	UserRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
	IconTile,
	ListGroup,
	ROW_CLASS,
	RowChevron,
	RowText,
	Switch,
	SwitchRow,
} from "@/components/list-group";
import { AccountTab } from "@/components/settings/account-tab";
import { ClaudeTab } from "@/components/settings/claude-tab";
import { DataTab } from "@/components/settings/data-tab";
import { SecurityTab } from "@/components/settings/security-tab";
import { TabBar } from "@/components/tab-bar";
import { useIsAdmin } from "@/lib/admin";
import { useCurrencyConfig } from "@/lib/currency";
import { orpc } from "@/utils/orpc";

const TABS = [
	{ key: "money", label: "Money" },
	{ key: "security", label: "Security" },
	{ key: "account", label: "Account" },
	{ key: "data", label: "Data" },
	{ key: "claude", label: "Claude" },
] as const;

type Tab = (typeof TABS)[number]["key"];

const ICON: Record<Tab, typeof Coins> = {
	money: Coins,
	security: KeyRound,
	account: UserRound,
	data: Download,
	claude: Bot,
};

const BLURB: Record<Tab, string> = {
	money: "How every figure is converted, taxed, and shown.",
	security: "Your password, and who can see the screen.",
	account: "Who you are, and where you're signed in.",
	data: "Export your transactions, plan, and spending as CSV.",
	claude: "Let Claude Code read your data, and see what it changed.",
};

export const Route = createFileRoute("/_auth/settings")({
	component: SettingsPage,
	// In the URL rather than component state, so "Settings → Security" is linkable and survives a reload —
	// which matters here, because the lock screen sends you to this page's Security tab.
	// No tab means the list of sections on a phone, and Money on desktop, which has no list.
	validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
		tab: TABS.some((t) => t.key === search.tab)
			? (search.tab as Tab)
			: undefined,
	}),
});

function SettingsPage() {
	const phone = useIsPhone();
	const { tab: picked } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const tab = picked ?? "money";

	if (phone) return <PhoneSettings tab={picked} />;

	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-10 sm:px-8 sm:py-14">
				<header className="flex flex-col gap-1">
					<h1 className="font-display font-medium text-3xl tracking-tight">
						Settings
					</h1>
					<p className="text-muted-foreground">{BLURB[tab]}</p>
				</header>

				<TabBar
					tabs={TABS}
					active={tab}
					onSelect={(next) => navigate({ search: { tab: next } })}
				/>

				<TabContent tab={tab} />
			</div>
		</main>
	);
}

function TabContent({ tab }: { tab: Tab }) {
	return (
		<div className="flex flex-col gap-10 max-md:gap-8">
			{tab === "money" && (
				<>
					<Currencies />
					<TaxKpi />
				</>
			)}
			{tab === "security" && <SecurityTab />}
			{tab === "account" && <AccountTab />}
			{tab === "data" && <DataTab />}
			{tab === "claude" && <ClaudeTab />}
		</div>
	);
}

/**
 * Settings on a phone: a list of the five sections that pushes into each one, the way a phone's own
 * Settings works, instead of a five-way tab strip too wide for the screen. The section is still the `tab`
 * search param, so `/settings?tab=security` opens straight onto Security and the browser's back (or a
 * swipe) returns to the list.
 *
 * The heading is one element whose text changes between list and section, rather than two headings, so
 * the phone top bar's collapsing title keeps watching a heading that is still on the page.
 */
function PhoneSettings({ tab }: { tab: Tab | undefined }) {
	const label = tab ? TABS.find((t) => t.key === tab)?.label : undefined;
	return (
		// A section is one level below the list: the top bar's back chevron returns to it (see phone-nav.tsx).
		<main
			className="h-full overflow-y-auto"
			data-back-to={tab ? "/settings" : undefined}
			data-back-label={tab ? "Settings" : undefined}
		>
			<div className="mx-auto flex max-w-xl flex-col gap-6 px-4 pt-6 pb-10">
				<header className="flex flex-col gap-1">
					<h1 className="px-1 font-display font-medium text-3xl tracking-tight">
						{label ?? "Settings"}
					</h1>
					{tab && <p className="px-1 text-muted-foreground">{BLURB[tab]}</p>}
				</header>
				{tab ? (
					<TabContent tab={tab} />
				) : (
					<ListGroup>
						{TABS.map((t) => {
							const Icon = ICON[t.key];
							return (
								<Link
									key={t.key}
									to="/settings"
									search={{ tab: t.key }}
									className={ROW_CLASS}
								>
									<IconTile>
										<Icon className="size-[1.125rem]" />
									</IconTile>
									<RowText label={t.label} hint={BLURB[t.key]} />
									<RowChevron />
								</Link>
							);
						})}
					</ListGroup>
				)}
			</div>
		</main>
	);
}

/** The after-tax KPI switch — nets interest-type passive income by the marginal rate before coverage. */
function TaxKpi() {
	const qc = useQueryClient();
	const q = useQuery(orpc.tax.getKpiConfig.queryOptions());
	const set = useMutation({
		...orpc.tax.setKpiConfig.mutationOptions(),
		onSuccess: () => qc.invalidateQueries(),
		onError: (e) => toast.error(e.message),
	});
	const enabled = q.data?.enabled ?? true;
	const rate = q.data?.rate ?? 0.312;
	const k = q.data;
	// Where the rate comes from, so a fallback (an older profile, last year's rules, the default) isn't silent.
	const basis =
		k == null
			? null
			: k.source === "override"
				? "Using your override."
				: k.source === "default"
					? "No tax profile to compute it from yet, so it uses 31.2%."
					: k.source === "fallback"
						? `Couldn't compute it from your ${k.profileFy ? `${k.profileFy} ` : ""}tax profile just now, so it uses 31.2% for the moment.`
						: [
								k.profileFy === k.currentFy
									? `From your ${k.profileFy} tax profile`
									: `From your ${k.profileFy} tax profile (none saved for ${k.currentFy} yet)`,
								k.rulesFy === k.currentFy
									? "."
									: `, using ${k.rulesFy} rules until ${k.currentFy} rules are added.`,
							].join("");
	const [draft, setDraft] = useState("");
	const shown = draft === "" ? (rate * 100).toFixed(1) : draft;
	const dirty = draft !== "" && Number(draft) > 0;
	const phone = useIsPhone();

	return (
		<section className="flex flex-col gap-4">
			<div className="border-border border-b-2 pb-2 max-md:border-b-0 max-md:px-1 max-md:pb-0">
				<h2 className="font-display font-medium text-xl">After-tax KPI</h2>
			</div>
			{phone && (
				<ListGroup footer={basis}>
					<SwitchRow
						on={enabled}
						onToggle={() => set.mutate({ enabled: !enabled })}
						label="Coverage after tax"
						hint="Net interest income by your marginal rate first"
					/>
				</ListGroup>
			)}
			<div className="flex flex-wrap items-center justify-between gap-3 max-md:hidden">
				<p className="max-w-md text-muted-foreground text-sm">
					Net FD / bond / interest income by your marginal rate before the
					coverage ratio. The rate is your override if you set one; otherwise
					it's computed from this FY's tax profile or, without one, your most
					recent saved profile; with no profile at all it's 31.2%.
					{basis && <span className="mt-1 block text-xs">{basis}</span>}
				</p>
				<button
					type="button"
					onClick={() => set.mutate({ enabled: !enabled })}
					className={`rounded-full px-3 py-1.5 font-medium text-sm transition-colors ${
						enabled
							? "bg-[var(--covered)]/15 text-[var(--covered)]"
							: "bg-muted text-muted-foreground"
					}`}
				>
					{enabled ? "After-tax · on" : "After-tax · off"}
				</button>
			</div>
			{phone && (
				<p className="px-1 text-muted-foreground text-sm">
					The rate is your override if you set one; otherwise it's computed from
					this FY's tax profile or, without one, your most recent saved profile;
					with no profile at all it's 31.2%.
				</p>
			)}
			<div className="flex flex-wrap items-end gap-2 max-md:grid max-md:grid-cols-2 max-md:gap-3">
				<Field label="Marginal rate %">
					<input
						type="text"
						inputMode="decimal"
						enterKeyHint="done"
						value={shown}
						onChange={(e) => setDraft(e.target.value)}
						className="tnum w-24 rounded-md border border-border bg-background px-2 py-1 text-sm max-md:h-11 max-md:w-full max-md:rounded-lg max-md:px-3 max-md:text-base"
					/>
				</Field>
				<Button
					size="sm"
					className="max-md:col-start-1 max-md:min-h-11"
					disabled={!dirty || set.isPending}
					onClick={() => {
						set.mutate({ rateOverride: Number(draft) / 100 });
						setDraft("");
					}}
				>
					Override
				</Button>
				<Button
					size="sm"
					variant="outline"
					className="max-md:min-h-11"
					disabled={set.isPending}
					onClick={() => {
						set.mutate({ rateOverride: null });
						setDraft("");
					}}
				>
					Use profile rate
				</Button>
			</div>
		</section>
	);
}

function Currencies() {
	const cfg = useCurrencyConfig();
	// Rates are shared by every user on the install, so only an admin may add, edit or refresh them.
	// `undefined` until the session loads: the controls wait for it rather than flash their read-only form.
	const isAdmin = useIsAdmin();
	const qc = useQueryClient();
	const invalidate = () => qc.invalidateQueries();

	const setDisplay = useMutation({
		...orpc.currency.setDisplay.mutationOptions(),
		onSuccess: invalidate,
	});
	const setRate = useMutation({
		...orpc.currency.setRate.mutationOptions(),
		onSuccess: invalidate,
	});
	const upsert = useMutation({
		...orpc.currency.upsert.mutationOptions(),
		onSuccess: invalidate,
	});
	const refresh = useMutation({
		...orpc.currency.refresh.mutationOptions(),
		onSuccess: (r) => {
			invalidate();
			toast.success(
				r.updated.length
					? `Refreshed ${r.updated.join(", ")} from ECB.`
					: "No rates updated.",
			);
		},
		onError: (e) => toast.error(e.message),
	});

	if (isAdmin === undefined) {
		return (
			<section className="flex flex-col gap-5" aria-busy="true">
				<div className="border-border border-b-2 pb-2">
					<h2 className="font-display font-medium text-xl">Currencies</h2>
				</div>
				<Skeleton className="h-48 w-full rounded-xl" />
			</section>
		);
	}

	return (
		<section className="flex flex-col gap-5">
			<div className="flex flex-wrap items-end justify-between gap-3 border-border border-b-2 pb-2 max-md:items-center max-md:border-b-0 max-md:px-1 max-md:pb-0">
				<h2 className="font-display font-medium text-xl">Currencies</h2>
				{isAdmin && (
					<Button
						variant="outline"
						size="sm"
						className="max-md:min-h-11"
						onClick={() => refresh.mutate(undefined)}
						disabled={refresh.isPending}
					>
						<RefreshCw
							className={`size-3.5 ${refresh.isPending ? "animate-spin" : ""}`}
						/>
						Refresh rates
					</Button>
				)}
			</div>

			{/* display-currency switcher */}
			<div className="flex flex-col gap-2">
				<span className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em] max-md:px-1 max-md:text-sm max-md:normal-case max-md:tracking-normal">
					Display everything in
				</span>
				<div className="flex flex-wrap gap-1.5">
					{cfg.currencies
						.filter((c) => c.enabled)
						.map((c) => {
							const active = c.code === cfg.display;
							return (
								<button
									key={c.code}
									type="button"
									onClick={() => !active && setDisplay.mutate({ code: c.code })}
									className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium text-sm transition-colors max-md:h-11 max-md:rounded-full max-md:px-4 ${
										active
											? "border-foreground bg-foreground text-background"
											: "border-border hover:bg-secondary"
									}`}
								>
									{active && <Check className="size-3.5" />}
									{c.symbol} {c.code}
								</button>
							);
						})}
				</div>
				<p className="text-muted-foreground text-xs max-md:px-1 max-md:text-sm">
					Values show in this currency, with the original dim in brackets when
					it differs.
				</p>
			</div>

			{/* rate table */}
			<ul className="flex flex-col divide-y divide-border rounded-xl border border-border max-md:overflow-hidden max-md:rounded-2xl max-md:bg-card">
				{cfg.currencies.map((c) => (
					<CurrencyRow
						key={c.code}
						code={c.code}
						symbol={c.symbol}
						rateToInr={c.rateToInr}
						enabled={c.enabled}
						canEdit={isAdmin}
						onRate={(rateToInr) => setRate.mutate({ code: c.code, rateToInr })}
						onToggle={(enabled) =>
							upsert.mutate({ code: c.code, symbol: c.symbol, enabled })
						}
					/>
				))}
			</ul>

			{isAdmin ? (
				<AddCurrency
					onAdd={(v) => upsert.mutate(v)}
					pending={upsert.isPending}
				/>
			) : (
				<p className="text-muted-foreground text-xs max-md:px-1 max-md:text-sm">
					Exchange rates are shared by everyone on this install; only the admin
					can change them.
				</p>
			)}
		</section>
	);
}

function CurrencyRow({
	code,
	symbol,
	rateToInr,
	enabled,
	canEdit,
	onRate,
	onToggle,
}: {
	code: string;
	symbol: string;
	rateToInr: number;
	enabled: boolean;
	canEdit: boolean;
	onRate: (rate: number) => void;
	onToggle: (enabled: boolean) => void;
}) {
	const isBase = code === "INR";
	const [draft, setDraft] = useState(String(rateToInr));
	const dirty = draft !== String(rateToInr);
	const phone = useIsPhone();

	// On a phone the row itself is the on/off switch, and an admin's rate field gets a line of its own
	// beneath it, so neither has to be squeezed to fit the other.
	if (phone) {
		const editable = canEdit && !isBase;
		return (
			<li className="flex flex-col">
				<button
					type="button"
					role="switch"
					aria-checked={enabled}
					aria-label={`${code} enabled`}
					disabled={isBase || !canEdit}
					onClick={() => onToggle(!enabled)}
					className={ROW_CLASS}
				>
					<RowText
						label={
							<span className="tnum font-medium">
								{symbol} {code}
							</span>
						}
						hint={
							isBase
								? "Base currency, always on"
								: editable
									? undefined
									: `1 ${code} = ₹${rateToInr}`
						}
					/>
					<span
						className={`shrink-0 ${isBase || !canEdit ? "opacity-50" : ""}`}
					>
						<Switch on={enabled} />
					</span>
				</button>
				{editable && (
					<form
						className="flex items-center gap-2 px-4 pb-3 text-muted-foreground text-sm"
						onSubmit={(e) => {
							e.preventDefault();
							if (dirty && Number(draft) > 0) onRate(Number(draft));
						}}
					>
						<span className="tnum shrink-0">1 {code} = ₹</span>
						<input
							type="text"
							inputMode="decimal"
							enterKeyHint="done"
							aria-label={`${code} rate in rupees`}
							value={draft}
							onChange={(e) => setDraft(e.target.value)}
							className="tnum h-11 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-base text-foreground"
						/>
						{dirty && Number(draft) > 0 && (
							<Button type="submit" className="min-h-11">
								Save
							</Button>
						)}
					</form>
				)}
			</li>
		);
	}

	return (
		<li className="flex items-center gap-3 px-4 py-3">
			<span className="tnum w-16 font-medium">
				{symbol} {code}
			</span>
			{isBase ? (
				<span className="flex-1 text-muted-foreground text-sm">
					base currency
				</span>
			) : !canEdit ? (
				<span className="tnum flex-1 text-muted-foreground text-sm">
					1 {code} = ₹{rateToInr}
				</span>
			) : (
				<div className="flex flex-1 items-center gap-2 text-sm">
					<span className="text-muted-foreground">1 {code} = ₹</span>
					<input
						type="text"
						inputMode="decimal"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter" && dirty && Number(draft) > 0)
								onRate(Number(draft));
						}}
						className="tnum w-24 rounded-md border border-border bg-background px-2 py-1"
					/>
					{dirty && Number(draft) > 0 && (
						<Button size="sm" onClick={() => onRate(Number(draft))}>
							Save
						</Button>
					)}
				</div>
			)}
			<button
				type="button"
				disabled={isBase || !canEdit}
				onClick={() => onToggle(!enabled)}
				className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
					enabled
						? "bg-[var(--covered)]/15 text-[var(--covered)]"
						: "bg-muted text-muted-foreground"
				} ${isBase || !canEdit ? "cursor-default" : "hover:opacity-80"} ${isBase ? "opacity-60" : ""}`}
			>
				{enabled ? "enabled" : "disabled"}
			</button>
		</li>
	);
}

function AddCurrency({
	onAdd,
	pending,
}: {
	onAdd: (v: { code: string; symbol: string; rateToInr: number }) => void;
	pending: boolean;
}) {
	const [code, setCode] = useState("");
	const [symbol, setSymbol] = useState("");
	const [rate, setRate] = useState("");
	const valid = /^[A-Za-z]{3}$/.test(code) && symbol && Number(rate) > 0;

	return (
		<div className="flex flex-wrap items-end gap-2 rounded-xl border border-border border-dashed p-3 max-md:grid max-md:grid-cols-3 max-md:gap-3 max-md:rounded-2xl max-md:p-4">
			<Field label="Code">
				<input
					value={code}
					onChange={(e) => setCode(e.target.value.toUpperCase())}
					placeholder="GBP"
					maxLength={3}
					autoCapitalize="characters"
					autoCorrect="off"
					className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm uppercase max-md:h-11 max-md:w-full max-md:rounded-lg max-md:px-3 max-md:text-base"
				/>
			</Field>
			<Field label="Symbol">
				<input
					value={symbol}
					onChange={(e) => setSymbol(e.target.value)}
					placeholder="£"
					maxLength={4}
					className="w-14 rounded-md border border-border bg-background px-2 py-1 text-sm max-md:h-11 max-md:w-full max-md:rounded-lg max-md:px-3 max-md:text-base"
				/>
			</Field>
			<Field label="1 unit = ₹">
				<input
					value={rate}
					onChange={(e) => setRate(e.target.value)}
					inputMode="decimal"
					enterKeyHint="done"
					placeholder="105"
					className="tnum w-24 rounded-md border border-border bg-background px-2 py-1 text-sm max-md:h-11 max-md:w-full max-md:rounded-lg max-md:px-3 max-md:text-base"
				/>
			</Field>
			<Button
				className="max-md:col-span-3 max-md:min-h-11"
				disabled={!valid || pending}
				onClick={() => {
					onAdd({ code, symbol, rateToInr: Number(rate) });
					setCode("");
					setSymbol("");
					setRate("");
				}}
			>
				Add currency
			</Button>
		</div>
	);
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1 max-md:min-w-0">
			<span className="text-[0.65rem] text-muted-foreground uppercase tracking-wider max-md:text-sm max-md:normal-case max-md:tracking-normal">
				{label}
			</span>
			{children}
		</div>
	);
}
