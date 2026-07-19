import { CARD_CATEGORIES } from "@money/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Wallet } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useMoney } from "@/lib/currency";
import { type client, orpc } from "@/utils/orpc";

export const Route = createFileRoute("/cards")({ component: CardsPage });

function CardsPage() {
	return (
		<main className="h-full overflow-y-auto">
			<div className="mx-auto flex max-w-5xl flex-col gap-10 px-5 py-10 sm:px-8 sm:py-14">
				<Header />
				<Picker />
				<Portfolio />
				<SpendProfile />
			</div>
		</main>
	);
}

function Header() {
	const health = useQuery(orpc.cards.health.queryOptions());
	const list = useQuery(orpc.cards.list.queryOptions());
	const cardCount = list.data?.length ?? 0;
	const ltf = list.data?.filter((c) => c.isLtf).length ?? 0;
	const cibil = health.data?.cibil;
	return (
		<header className="flex flex-wrap items-end justify-between gap-3">
			<div className="flex flex-col gap-1">
				<h1 className="font-display font-medium text-3xl tracking-tight">
					Cards
				</h1>
				<p className="text-muted-foreground">
					Which card to use, and the gotchas that decide it.
				</p>
			</div>
			<dl className="flex gap-6 text-sm">
				{cibil != null && <Stat label="CIBIL" value={String(cibil)} />}
				<Stat label="Cards" value={String(cardCount)} />
				<Stat label="Lifetime-free" value={String(ltf)} />
			</dl>
		</header>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex flex-col items-end">
			<dd className="tnum font-display font-medium text-2xl">{value}</dd>
			<dt className="text-muted-foreground text-xs">{label}</dt>
		</div>
	);
}

function Picker() {
	const [category, setCategory] = useState(CARD_CATEGORIES[0]?.key ?? "amazon");
	const pick = useQuery(orpc.cards.pick.queryOptions({ input: { category } }));
	const ranked = pick.data ?? [];

	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-3 border-border border-b-2 pb-2">
				<h2 className="font-display font-medium text-xl">Best card for</h2>
				<select
					value={category}
					aria-label="Spend category"
					onChange={(e) => setCategory(e.target.value)}
					className="h-9 rounded-md border border-input bg-background px-3 text-foreground text-sm outline-none focus-visible:border-ring"
				>
					{CARD_CATEGORIES.map((c) => (
						<option
							key={c.key}
							value={c.key}
							className="bg-popover text-popover-foreground"
						>
							{c.label}
						</option>
					))}
				</select>
			</div>
			<ol className="flex flex-col divide-y divide-border rounded-xl border border-border">
				{ranked.length === 0 && (
					<li className="px-4 py-4 text-muted-foreground text-sm">
						No cards yet — run <code>bun run cards:import</code>.
					</li>
				)}
				{ranked.map((r, i) => (
					<li
						key={r.cardId}
						className={`flex items-start gap-3 px-4 py-3 ${r.excluded ? "opacity-55" : ""}`}
					>
						<span className="tnum w-5 pt-0.5 text-muted-foreground text-sm">
							{i + 1}
						</span>
						<div className="flex flex-1 flex-col gap-1">
							<div className="flex flex-wrap items-center gap-2">
								<span className="font-medium">{r.cardName}</span>
								{r.excluded ? (
									<Tag tone="warn">avoid — earns nothing</Tag>
								) : (
									<span className="tnum font-display font-medium text-lg">
										{(r.rate * 100).toFixed(r.rate * 100 < 1 ? 1 : 0)}%
									</span>
								)}
								{r.rewardType && !r.excluded && <Tag>{r.rewardType}</Tag>}
								{r.isLtf && <Tag>LTF</Tag>}
							</div>
							{r.caveats.map((cav) => (
								<span key={cav} className="text-muted-foreground text-xs">
									⚠ {cav}
								</span>
							))}
						</div>
					</li>
				))}
			</ol>
		</section>
	);
}

function Portfolio() {
	const list = useQuery(orpc.cards.list.queryOptions());
	const cards = list.data ?? [];
	return (
		<section className="flex flex-col gap-4">
			<h2 className="border-border border-b-2 pb-2 font-display font-medium text-xl">
				Portfolio
			</h2>
			<ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
				{cards.map((c) => (
					<CardRow key={c.id} card={c} />
				))}
			</ul>
		</section>
	);
}

type CardListItem = Awaited<ReturnType<typeof client.cards.list>>[number];

function CardRow({ card }: { card: CardListItem }) {
	const money = useMoney();
	const qc = useQueryClient();
	const [open, setOpen] = useState(false);
	const flags = useMutation({
		...orpc.cards.setCardFlags.mutationOptions(),
		onSuccess: () => qc.invalidateQueries(),
	});

	const extras = card.extras;
	const gotchas = Array.isArray(extras?.gotchas) ? extras.gotchas : [];
	const bestFor = Array.isArray(extras?.bestFor) ? extras.bestFor : [];
	const avoidFor = Array.isArray(extras?.avoidFor) ? extras.avoidFor : [];
	const lounge = formatLounge(extras?.lounge);

	return (
		<li className="flex flex-col">
			<div className="flex items-center gap-3 px-4 py-3">
				<button
					type="button"
					onClick={() => setOpen((o) => !o)}
					className="flex flex-1 items-center gap-2 text-left"
				>
					<ChevronDown
						className={`size-4 text-muted-foreground transition-transform ${open ? "" : "-rotate-90"}`}
					/>
					<span className="font-medium">{card.name}</span>
					<span className="text-muted-foreground text-xs">
						{[
							card.network,
							card.isLtf ? "LTF" : money.fmt(card.annualFee ?? 0),
							card.forexMarkupText ? `${card.forexMarkupText} forex` : null,
							card.vintageYear
								? `'${String(card.vintageYear).slice(-2)}`
								: null,
							lounge ? "✈ lounge" : null,
							card.status && card.status !== "active" ? card.status : null,
						]
							.filter(Boolean)
							.join(" · ")}
					</span>
				</button>
				<button
					type="button"
					title="In daily wallet"
					onClick={() =>
						flags.mutate({ id: card.id, inWallet: !card.inWallet })
					}
					className={`rounded-full p-1.5 transition-colors ${card.inWallet ? "bg-[var(--covered)]/15 text-[var(--covered)]" : "text-muted-foreground hover:bg-secondary"}`}
				>
					<Wallet className="size-4" />
				</button>
			</div>
			{open && (
				<div className="flex flex-col gap-3 border-border border-t bg-muted/30 px-4 py-3 pl-10 text-sm">
					<ul className="flex flex-col gap-1">
						{card.rules.map((rule) => (
							<li key={rule.id} className="flex flex-wrap items-baseline gap-2">
								<span className="w-28 shrink-0 text-muted-foreground text-xs">
									{rule.isBase ? "base" : rule.category}
								</span>
								<span className="tnum font-medium">
									{rule.isExclusion ? "excluded" : (rule.rateText ?? "—")}
								</span>
								{rule.condition && (
									<span className="text-muted-foreground text-xs">
										⚠ {rule.condition}
									</span>
								)}
								{rule.capText && (
									<span className="text-muted-foreground text-xs">
										· cap {rule.capText}
									</span>
								)}
							</li>
						))}
					</ul>
					{lounge && <Detail label="Lounge" items={[lounge]} />}
					{gotchas.length > 0 && (
						<Detail label="Gotchas" items={gotchas.map(String)} />
					)}
					{bestFor.length > 0 && (
						<Detail label="Best for" items={bestFor.map(String)} />
					)}
					{avoidFor.length > 0 && (
						<Detail label="Avoid for" items={avoidFor.map(String)} />
					)}
				</div>
			)}
		</li>
	);
}

/** Normalise the lounge extra (a string like "none", or a {domestic, international} object) to one line. */
function formatLounge(lounge: unknown): string | null {
	if (typeof lounge === "string") {
		const s = lounge.trim();
		return s && !/^none/i.test(s) ? s : null;
	}
	if (lounge && typeof lounge === "object") {
		const l = lounge as {
			domestic?: { visits?: unknown; condition?: unknown };
			international?: { visits?: unknown; condition?: unknown } | null;
		};
		const parts: string[] = [];
		const fmt = (
			label: string,
			v?: { visits?: unknown; condition?: unknown } | null,
		) => {
			if (!v?.visits) return;
			const cond = v.condition ? ` (${String(v.condition)})` : "";
			parts.push(`${label}: ${String(v.visits)}${cond}`);
		};
		fmt("Domestic", l.domestic);
		fmt("International", l.international);
		return parts.length ? parts.join(" · ") : null;
	}
	return null;
}

function Detail({ label, items }: { label: string; items: string[] }) {
	return (
		<div className="flex flex-col gap-0.5">
			<span className="text-muted-foreground text-xs uppercase tracking-wider">
				{label}
			</span>
			{items.map((it) => (
				<span key={it} className="text-xs">
					• {it}
				</span>
			))}
		</div>
	);
}

function SpendProfile() {
	const qc = useQueryClient();
	const money = useMoney();
	const profile = useQuery(orpc.cards.spendProfile.queryOptions());
	const setSpend = useMutation({
		...orpc.cards.setSpend.mutationOptions(),
		onSuccess: () => qc.invalidateQueries(),
	});
	const rows = profile.data ?? [];
	if (rows.length === 0) return null;

	return (
		<section className="flex flex-col gap-4">
			<h2 className="border-border border-b-2 pb-2 font-display font-medium text-xl">
				Monthly spend profile
			</h2>
			<ul className="flex flex-col gap-2">
				{rows.map((r) => (
					<li key={r.category} className="flex items-center gap-3 text-sm">
						<span className="w-40 text-muted-foreground">{r.category}</span>
						<span className="tnum flex-1">{money.fmt(r.monthlyAmount)}/mo</span>
						<input
							type="number"
							inputMode="numeric"
							defaultValue={r.monthlyAmount}
							onBlur={(e) => {
								const v = Number(e.target.value);
								if (v >= 0 && v !== r.monthlyAmount)
									setSpend.mutate({ category: r.category, monthlyAmount: v });
							}}
							className="tnum w-28 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus-visible:border-ring"
						/>
					</li>
				))}
			</ul>
		</section>
	);
}

function Tag({ children, tone }: { children: ReactNode; tone?: "warn" }) {
	return (
		<span
			className={`rounded-full px-2 py-0.5 text-xs ${tone === "warn" ? "bg-[var(--uncovered)]/15 text-[var(--uncovered)]" : "bg-secondary text-secondary-foreground"}`}
		>
			{children}
		</span>
	);
}
