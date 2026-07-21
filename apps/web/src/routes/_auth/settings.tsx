import { Button } from "@money/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Check, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { AccountTab } from "@/components/settings/account-tab";
import { SecurityTab } from "@/components/settings/security-tab";
import { TabBar } from "@/components/tab-bar";
import { useCurrencyConfig } from "@/lib/currency";
import { orpc } from "@/utils/orpc";

const TABS = [
	{ key: "money", label: "Money" },
	{ key: "security", label: "Security" },
	{ key: "account", label: "Account" },
] as const;

type Tab = (typeof TABS)[number]["key"];

const BLURB: Record<Tab, string> = {
	money: "How every figure is converted, taxed, and shown.",
	security: "Your password, and who can see the screen.",
	account: "Who you are, and where you're signed in.",
};

export const Route = createFileRoute("/_auth/settings")({
	component: SettingsPage,
	// In the URL rather than component state, so "Settings → Security" is linkable and survives a reload —
	// which matters here, because the lock screen sends you to this page's Security tab.
	validateSearch: (search: Record<string, unknown>): { tab: Tab } => ({
		tab: TABS.some((t) => t.key === search.tab) ? (search.tab as Tab) : "money",
	}),
});

function SettingsPage() {
	const { tab } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

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

				<div className="flex flex-col gap-10">
					{tab === "money" && (
						<>
							<Currencies />
							<TaxKpi />
						</>
					)}
					{tab === "security" && <SecurityTab />}
					{tab === "account" && <AccountTab />}
				</div>
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
	const [draft, setDraft] = useState("");
	const shown = draft === "" ? (rate * 100).toFixed(1) : draft;
	const dirty = draft !== "" && Number(draft) > 0;

	return (
		<section className="flex flex-col gap-4">
			<div className="border-border border-b-2 pb-2">
				<h2 className="font-display font-medium text-xl">After-tax KPI</h2>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="max-w-md text-muted-foreground text-sm">
					Net FD / bond / interest income by your marginal rate before the
					coverage ratio. Rate follows your active-FY tax profile unless
					overridden.
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
			<div className="flex flex-wrap items-end gap-2">
				<Field label="Marginal rate %">
					<input
						type="text"
						inputMode="decimal"
						value={shown}
						onChange={(e) => setDraft(e.target.value)}
						className="tnum w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
					/>
				</Field>
				<Button
					size="sm"
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

	return (
		<section className="flex flex-col gap-5">
			<div className="flex flex-wrap items-end justify-between gap-3 border-border border-b-2 pb-2">
				<h2 className="font-display font-medium text-xl">Currencies</h2>
				<Button
					variant="outline"
					size="sm"
					onClick={() => refresh.mutate(undefined)}
					disabled={refresh.isPending}
				>
					<RefreshCw
						className={`size-3.5 ${refresh.isPending ? "animate-spin" : ""}`}
					/>
					Refresh rates
				</Button>
			</div>

			{/* display-currency switcher */}
			<div className="flex flex-col gap-2">
				<span className="text-[0.65rem] text-muted-foreground uppercase tracking-[0.2em]">
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
									className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium text-sm transition-colors ${
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
				<p className="text-muted-foreground text-xs">
					Values show in this currency, with the original dim in brackets when
					it differs.
				</p>
			</div>

			{/* rate table */}
			<ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
				{cfg.currencies.map((c) => (
					<CurrencyRow
						key={c.code}
						code={c.code}
						symbol={c.symbol}
						rateToInr={c.rateToInr}
						enabled={c.enabled}
						onRate={(rateToInr) => setRate.mutate({ code: c.code, rateToInr })}
						onToggle={(enabled) =>
							upsert.mutate({ code: c.code, symbol: c.symbol, enabled })
						}
					/>
				))}
			</ul>

			<AddCurrency onAdd={(v) => upsert.mutate(v)} pending={upsert.isPending} />
		</section>
	);
}

function CurrencyRow({
	code,
	symbol,
	rateToInr,
	enabled,
	onRate,
	onToggle,
}: {
	code: string;
	symbol: string;
	rateToInr: number;
	enabled: boolean;
	onRate: (rate: number) => void;
	onToggle: (enabled: boolean) => void;
}) {
	const isBase = code === "INR";
	const [draft, setDraft] = useState(String(rateToInr));
	const dirty = draft !== String(rateToInr);

	return (
		<li className="flex items-center gap-3 px-4 py-3">
			<span className="tnum w-16 font-medium">
				{symbol} {code}
			</span>
			{isBase ? (
				<span className="flex-1 text-muted-foreground text-sm">
					base currency
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
				disabled={isBase}
				onClick={() => onToggle(!enabled)}
				className={`rounded-full px-2.5 py-1 text-xs transition-colors ${
					enabled
						? "bg-[var(--covered)]/15 text-[var(--covered)]"
						: "bg-muted text-muted-foreground"
				} ${isBase ? "cursor-default opacity-60" : "hover:opacity-80"}`}
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
		<div className="flex flex-wrap items-end gap-2 rounded-xl border border-border border-dashed p-3">
			<Field label="Code">
				<input
					value={code}
					onChange={(e) => setCode(e.target.value.toUpperCase())}
					placeholder="GBP"
					maxLength={3}
					className="w-16 rounded-md border border-border bg-background px-2 py-1 text-sm uppercase"
				/>
			</Field>
			<Field label="Symbol">
				<input
					value={symbol}
					onChange={(e) => setSymbol(e.target.value)}
					placeholder="£"
					maxLength={4}
					className="w-14 rounded-md border border-border bg-background px-2 py-1 text-sm"
				/>
			</Field>
			<Field label="1 unit = ₹">
				<input
					value={rate}
					onChange={(e) => setRate(e.target.value)}
					inputMode="decimal"
					placeholder="105"
					className="tnum w-24 rounded-md border border-border bg-background px-2 py-1 text-sm"
				/>
			</Field>
			<Button
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
		<div className="flex flex-col gap-1">
			<span className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">
				{label}
			</span>
			{children}
		</div>
	);
}
