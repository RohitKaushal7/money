import type { FlowLeaf, MoneyFlow as MoneyFlowData } from "@money/shared";
import { useIsPhone } from "@money/ui/hooks/use-media-query";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { DateRange } from "@/components/date-range-picker";
import { useMoney } from "@/lib/currency";
import { orpc } from "@/utils/orpc";

/**
 * The **Flow** tab: an income-allocation Sankey. Reads the pure {@link MoneyFlowData} from
 * `spending.flow` (monthly-average income → spent / invested / saved) and lays out a five-column flow —
 * income sources → active/passive → Income → {Expenses, Investments, Savings} → leaf categories.
 *
 * Colour carries meaning, not identity, so it stays inside the app's five CVD-safe hues: blue = active
 * income, green = passive income & savings (the "good" colours), amber = spent (pressure), purple =
 * invested, red = drawn from reserves. There is no per-category rainbow — leaves are told apart by label,
 * size and order.
 */

// ── role palette (semantic, from the app's CVD-safe vars) ─────────────────────────────────────────────
const BLUE = "var(--cat-1)";
const GREEN = "var(--covered)";
const AMBER = "var(--uncovered)";
const PURPLE = "var(--cat-5)";
const RED = "var(--cat-3)";
const NEUTRAL = "var(--muted-foreground)";

// ── layout constants (internal SVG coords; the viewBox scales to the container) ───────────────────────
const COLX = [250, 440, 600, 772, 932];
const NODEW = 15;
const TOP = 44;
const HSVG = 600;
const USABLE = HSVG - TOP * 2;
const GAP = 17;

interface FNode {
	id: string;
	col: number;
	value: number;
	label: string;
	color: string;
	hub?: boolean;
	x: number;
	y0: number;
	h: number;
	cy: number;
	labelY: number;
	outOff: number;
	inOff: number;
}
interface FLink {
	s: string;
	t: string;
	v: number;
	color: string;
	sy: number;
	ty: number;
	th: number;
}

/** Category labels carry a parenthetical gloss ("… (Wint Wealth)") — too long for a Sankey leaf. */
const short = (label: string): string => label.replace(/\s*\([^)]*\)\s*$/, "");

/** Build positioned nodes + links from the flow data. Pure — deterministic given `f`. */
function buildLayout(f: MoneyFlowData): { nodes: FNode[]; links: FLink[] } {
	const nodes: FNode[] = [];
	const links: Omit<FLink, "sy" | "ty" | "th">[] = [];
	const byId = new Map<string, FNode>();
	const add = (
		n: Omit<FNode, "x" | "y0" | "h" | "cy" | "labelY" | "outOff" | "inOff">,
	) => {
		const node = {
			...n,
			x: 0,
			y0: 0,
			h: 0,
			cy: 0,
			labelY: 0,
			outOff: 0,
			inOff: 0,
		};
		nodes.push(node);
		byId.set(node.id, node);
	};

	for (const c of f.incomeActive)
		add({
			id: c.key,
			col: 0,
			value: c.value,
			label: short(c.label),
			color: BLUE,
		});
	for (const c of f.incomePassive)
		add({
			id: c.key,
			col: 0,
			value: c.value,
			label: short(c.label),
			color: GREEN,
		});
	if (f.reserves > 0)
		add({
			id: "reserves",
			col: 0,
			value: f.reserves,
			label: "From reserves",
			color: RED,
		});
	if (f.incomeActiveTotal > 0)
		add({
			id: "active",
			col: 1,
			value: f.incomeActiveTotal,
			label: "Active",
			color: BLUE,
		});
	if (f.incomePassiveTotal > 0)
		add({
			id: "passive",
			col: 1,
			value: f.incomePassiveTotal,
			label: "Passive",
			color: GREEN,
		});
	add({
		id: "hub",
		col: 2,
		value: f.incomeTotal + f.reserves,
		label: f.reserves > 0 ? "Total in" : "Income",
		color: NEUTRAL,
		hub: true,
	});
	if (f.expenseTotal > 0)
		add({
			id: "exp",
			col: 3,
			value: f.expenseTotal,
			label: "Expenses",
			color: AMBER,
		});
	if (f.investTotal > 0)
		add({
			id: "inv",
			col: 3,
			value: f.investTotal,
			label: "Investments",
			color: PURPLE,
		});
	if (f.savings > 0)
		add({
			id: "sav",
			col: 3,
			value: f.savings,
			label: "Savings",
			color: GREEN,
		});
	for (const c of f.expenses)
		add({
			id: c.key,
			col: 4,
			value: c.value,
			label: short(c.label),
			color: AMBER,
		});
	for (const c of f.investments)
		add({
			id: c.key,
			col: 4,
			value: c.value,
			label: short(c.label),
			color: PURPLE,
		});

	for (const c of f.incomeActive)
		links.push({ s: c.key, t: "active", v: c.value, color: BLUE });
	for (const c of f.incomePassive)
		links.push({ s: c.key, t: "passive", v: c.value, color: GREEN });
	if (f.reserves > 0)
		links.push({ s: "reserves", t: "hub", v: f.reserves, color: RED });
	if (f.incomeActiveTotal > 0)
		links.push({ s: "active", t: "hub", v: f.incomeActiveTotal, color: BLUE });
	if (f.incomePassiveTotal > 0)
		links.push({
			s: "passive",
			t: "hub",
			v: f.incomePassiveTotal,
			color: GREEN,
		});
	if (f.expenseTotal > 0)
		links.push({ s: "hub", t: "exp", v: f.expenseTotal, color: AMBER });
	if (f.investTotal > 0)
		links.push({ s: "hub", t: "inv", v: f.investTotal, color: PURPLE });
	if (f.savings > 0)
		links.push({ s: "hub", t: "sav", v: f.savings, color: GREEN });
	for (const c of f.expenses)
		links.push({ s: "exp", t: c.key, v: c.value, color: AMBER });
	for (const c of f.investments)
		links.push({ s: "inv", t: c.key, v: c.value, color: PURPLE });

	// vertical scale: the tightest column decides the unit so every column fits within USABLE.
	const cols = new Map<number, FNode[]>();
	for (const n of nodes)
		(cols.get(n.col) ?? cols.set(n.col, []).get(n.col))?.push(n);
	let unit = Number.POSITIVE_INFINITY;
	for (const list of cols.values()) {
		const cv = list.reduce((s, n) => s + n.value, 0);
		const u = (USABLE - (list.length - 1) * GAP) / cv;
		if (u < unit) unit = u;
	}
	for (const [col, list] of cols) {
		const cv = list.reduce((s, n) => s + n.value, 0);
		const totalH = cv * unit + (list.length - 1) * GAP;
		let y = TOP + (USABLE - totalH) / 2;
		for (const n of list) {
			n.x = COLX[col] ?? 0;
			n.y0 = y;
			n.h = n.value * unit;
			n.cy = y + n.h / 2;
			n.labelY = n.cy;
			n.outOff = y;
			n.inOff = y;
			y += n.h + GAP;
		}
	}

	// leaf columns span a huge dynamic range (salary vs ₹57 interest) — nudge overlapping labels apart.
	const MINL = 30;
	const topB = TOP + 4;
	const botB = HSVG - TOP - 4;
	for (const col of [0, 4]) {
		const s = (cols.get(col) ?? []).slice().sort((a, b) => a.cy - b.cy);
		for (let i = 1; i < s.length; i++)
			if ((s[i]?.labelY ?? 0) < (s[i - 1]?.labelY ?? 0) + MINL)
				(s[i] as FNode).labelY = (s[i - 1]?.labelY ?? 0) + MINL;
		const last = s[s.length - 1];
		const over = last ? last.labelY - botB : 0;
		if (over > 0) {
			for (const n of s) n.labelY -= over;
			if (s[0] && s[0].labelY < topB) s[0].labelY = topB;
			for (let i = 1; i < s.length; i++)
				if ((s[i]?.labelY ?? 0) < (s[i - 1]?.labelY ?? 0) + MINL)
					(s[i] as FNode).labelY = (s[i - 1]?.labelY ?? 0) + MINL;
		}
	}

	// assign link bands along each node edge, ordered by the other endpoint's position.
	const out = new Map<string, FLink[]>();
	const inc = new Map<string, FLink[]>();
	const full = links.map((l) => ({ ...l, sy: 0, ty: 0, th: 0 }) as FLink);
	for (const l of full) {
		(out.get(l.s) ?? out.set(l.s, []).get(l.s))?.push(l);
		(inc.get(l.t) ?? inc.set(l.t, []).get(l.t))?.push(l);
	}
	for (const ls of out.values())
		ls.sort((a, b) => (byId.get(a.t)?.cy ?? 0) - (byId.get(b.t)?.cy ?? 0));
	for (const ls of inc.values())
		ls.sort((a, b) => (byId.get(a.s)?.cy ?? 0) - (byId.get(b.s)?.cy ?? 0));
	for (const l of full) {
		const s = byId.get(l.s);
		const t = byId.get(l.t);
		if (!s || !t) continue;
		l.th = l.v * unit;
		l.sy = s.outOff;
		s.outOff += l.th;
		l.ty = t.inOff;
		t.inOff += l.th;
	}

	return { nodes, links: full };
}

/** A filled Sankey ribbon between two equal-thickness bands. */
function ribbon(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	th: number,
): string {
	const xm = (x0 + x1) / 2;
	return `M${x0},${y0} C${xm},${y0} ${xm},${y1} ${x1},${y1} L${x1},${y1 + th} C${xm},${y1 + th} ${xm},${y0 + th} ${x0},${y0 + th} Z`;
}

const HALO: React.CSSProperties = {
	paintOrder: "stroke",
	stroke: "var(--card)",
	strokeWidth: 3,
	strokeLinejoin: "round",
};

interface Tip {
	text: string;
	sub: string;
	x: number;
	y: number;
}

export function MoneyFlow({ range }: { range: DateRange }) {
	const { fmt, fmtc } = useMoney();
	const q = useQuery(
		orpc.spending.flow.queryOptions({
			input: { from: range.from, to: range.to },
		}),
	);
	const f = q.data as MoneyFlowData | undefined;
	const layout = useMemo(() => (f?.hasData ? buildLayout(f) : null), [f]);
	const [tip, setTip] = useState<Tip | null>(null);
	const phone = useIsPhone();

	if (q.isLoading)
		return <p className="py-4 text-muted-foreground text-sm">Loading…</p>;
	if (!f?.hasData || !layout)
		return (
			<div className="flex flex-col items-start gap-3 rounded-2xl border border-border border-dashed px-8 py-14">
				<p className="font-display font-medium text-xl">Nothing to flow yet</p>
				<p className="max-w-md text-muted-foreground text-sm">
					Once income and spending are categorised over this range, this tab
					maps where every rupee goes — spent, invested, or saved.
				</p>
			</div>
		);

	const income = f.incomeTotal;
	const pct = (v: number) => Math.round((v / income) * 100);
	const covPct = Math.round(f.passiveCoveragePct);

	return (
		<section className="flex flex-col gap-4">
			{phone ? (
				<FlowList f={f} />
			) : (
				<div>
					<svg
						viewBox={`0 0 1160 ${HSVG}`}
						className="block h-auto w-full"
						preserveAspectRatio="xMidYMid meet"
						role="img"
						aria-label="Money flow: income allocated to spending, investments and savings"
						onMouseLeave={() => setTip(null)}
					>
						<title>Money flow — income allocation</title>
						{layout.links.map((l, i) => {
							const s = layout.nodes.find((n) => n.id === l.s);
							const t = layout.nodes.find((n) => n.id === l.t);
							if (!s || !t) return null;
							return (
								// biome-ignore lint/a11y/noStaticElementInteractions: hover surfaces a value already labelled on both nodes
								<path
									key={`${l.s}-${l.t}-${i}`}
									d={ribbon(s.x + NODEW / 2, l.sy, t.x - NODEW / 2, l.ty, l.th)}
									fill={l.color}
									fillOpacity={0.34}
									className="cursor-default transition-[fill-opacity]"
									onMouseMove={(e) =>
										setTip({
											text: `${short(s.label)} → ${short(t.label)}`,
											sub: `${fmt(l.v)}/mo`,
											x: e.clientX,
											y: e.clientY,
										})
									}
								/>
							);
						})}

						{layout.nodes.map((n) => {
							const anchor: "start" | "middle" | "end" =
								n.col === 4 ? "start" : n.col === 2 ? "middle" : "end";
							const tx =
								n.col === 4
									? n.x + NODEW / 2 + 9
									: n.col === 2
										? n.x
										: n.x - NODEW / 2 - 9;
							const p = pct(n.value);
							return (
								// biome-ignore lint/a11y/noStaticElementInteractions: hover surfaces the same figure shown as a label
								<g
									key={n.id}
									onMouseMove={(e) =>
										setTip({
											text: n.label,
											sub: `${fmt(n.value)}/mo · ${p}% of income`,
											x: e.clientX,
											y: e.clientY,
										})
									}
								>
									<rect
										x={n.x - NODEW / 2}
										y={n.y0}
										width={NODEW}
										height={Math.max(1, n.h)}
										rx={3}
										fill={n.color}
										fillOpacity={n.hub ? 0.55 : 0.92}
									/>
									{Math.abs(n.labelY - n.cy) > 7 && (
										<path
											d={`M${anchor === "end" ? n.x - NODEW / 2 - 4 : n.x + NODEW / 2 + 4},${n.cy} L${anchor === "end" ? tx + 4 : tx - 4},${n.labelY + 4}`}
											fill="none"
											stroke="var(--border)"
											strokeWidth={1}
										/>
									)}
									{n.hub ? (
										<>
											<text
												x={tx}
												y={n.y0 - 16}
												textAnchor={anchor}
												className="fill-foreground font-semibold text-[14px]"
												style={HALO}
											>
												{n.label}
											</text>
											<text
												x={tx}
												y={n.y0 - 2}
												textAnchor={anchor}
												className="fill-muted-foreground text-[11.5px]"
												style={HALO}
											>
												{fmtc(n.value)}/mo
											</text>
										</>
									) : (
										<>
											<text
												x={tx}
												y={n.labelY - 3}
												textAnchor={anchor}
												className="fill-foreground font-semibold"
												style={{ ...HALO, fontSize: n.col === 3 ? 13.5 : 12.5 }}
											>
												{n.label}
											</text>
											<text
												x={tx}
												y={n.labelY + 12}
												textAnchor={anchor}
												className="fill-muted-foreground text-[11.5px]"
												style={HALO}
											>
												{fmtc(n.value)} · {p}%
											</text>
										</>
									)}
								</g>
							);
						})}
					</svg>
				</div>
			)}

			<p className="px-1 text-muted-foreground text-sm leading-relaxed">
				{f.reserves > 0 ? (
					<>
						This period you put{" "}
						<b className="text-foreground">{fmt(f.investTotal)}/mo</b> into
						investments and spent{" "}
						<b className="text-foreground">{fmt(f.expenseTotal)}/mo</b> — more
						than the <b className="text-foreground">{fmt(income)}/mo</b> that
						came in. The <b style={{ color: RED }}>{fmt(f.reserves)}/mo gap</b>{" "}
						is drawn from reserves.{" "}
						{f.redemptionNetted > 0 && (
							<>
								Matured principal ({fmtc(f.redemptionNetted)}/mo) is already
								netted out of investments.{" "}
							</>
						)}
						Passive income covers{" "}
						<b style={{ color: covPct >= 100 ? GREEN : undefined }}>
							{covPct}%
						</b>{" "}
						of expenses.
					</>
				) : (
					<>
						Income splits into{" "}
						<b className="text-foreground">{fmt(f.expenseTotal)}</b> spent,{" "}
						<b className="text-foreground">{fmt(f.investTotal)}</b> invested,
						and <b style={{ color: GREEN }}>{fmt(f.savings)}</b> saved. Passive
						income covers{" "}
						<b style={{ color: covPct >= 100 ? GREEN : undefined }}>
							{covPct}%
						</b>{" "}
						of expenses.
					</>
				)}
			</p>

			<div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-muted-foreground text-xs">
				<Key color={BLUE} label="Active income" />
				<Key color={GREEN} label="Passive income · Savings" />
				<Key color={AMBER} label="Expenses" />
				<Key color={PURPLE} label="Investments" />
				{f.reserves > 0 && <Key color={RED} label="Drawn from reserves" />}
			</div>

			{tip && (
				<div
					className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[140%] whitespace-nowrap rounded-md bg-foreground px-2.5 py-1 text-background text-xs shadow-lg"
					style={{ left: tip.x, top: tip.y }}
				>
					<span className="font-medium">{tip.text}</span>
					<span className="ml-1.5 opacity-80">{tip.sub}</span>
				</div>
			)}
		</section>
	);
}

function Key({ color, label }: { color: string; label: string }) {
	return (
		<span className="inline-flex items-center gap-1.5">
			<span
				className="inline-block size-2.5 rounded-[3px]"
				style={{ backgroundColor: color }}
			/>
			{label}
		</span>
	);
}

interface FlowGroup {
	id: string;
	label: string;
	value: number;
	color: string;
	leaves: FlowLeaf[];
}

/**
 * The phone's Flow. The Sankey's 1160-unit canvas scales to a third of its size at phone width, which puts
 * its 12px labels near 4px, and its leaf columns have no room to spread. So a phone gets the same flow as
 * two ranked lists, in and out, each a group (Active, Expenses, …) over its leaves, with a bar per row on
 * one scale so a ₹57 interest line and the salary still compare at a glance. Same role colours, same
 * "% of income" as the Sankey's labels, and every value is printed rather than behind a hover.
 */
function FlowList({ f }: { f: MoneyFlowData }) {
	const { fmtc } = useMoney();
	const hubTotal = f.incomeTotal + f.reserves;
	// One scale for every bar in both lists: the bigger side of the hub.
	const scale = Math.max(
		hubTotal,
		f.expenseTotal + f.investTotal + f.savings,
		1,
	);
	const pct = (v: number) =>
		f.incomeTotal > 0 ? Math.round((v / f.incomeTotal) * 100) : 0;

	const into: FlowGroup[] = [];
	if (f.incomeActiveTotal > 0)
		into.push({
			id: "active",
			label: "Active",
			value: f.incomeActiveTotal,
			color: BLUE,
			leaves: f.incomeActive,
		});
	if (f.incomePassiveTotal > 0)
		into.push({
			id: "passive",
			label: "Passive",
			value: f.incomePassiveTotal,
			color: GREEN,
			leaves: f.incomePassive,
		});
	if (f.reserves > 0)
		into.push({
			id: "reserves",
			label: "From reserves",
			value: f.reserves,
			color: RED,
			leaves: [],
		});
	const out: FlowGroup[] = [];
	if (f.expenseTotal > 0)
		out.push({
			id: "exp",
			label: "Expenses",
			value: f.expenseTotal,
			color: AMBER,
			leaves: f.expenses,
		});
	if (f.investTotal > 0)
		out.push({
			id: "inv",
			label: "Investments",
			value: f.investTotal,
			color: PURPLE,
			leaves: f.investments,
		});
	if (f.savings > 0)
		out.push({
			id: "sav",
			label: "Savings",
			value: f.savings,
			color: GREEN,
			leaves: [],
		});

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-baseline justify-between gap-3 border-border border-b pb-3">
				<span className="font-medium">
					{f.reserves > 0 ? "Total in" : "Income"}
				</span>
				<span className="tnum font-display font-medium text-2xl">
					{fmtc(hubTotal)}
					<span className="ml-1 font-normal font-sans text-muted-foreground text-sm">
						/mo
					</span>
				</span>
			</div>
			<FlowSection title="Coming in" groups={into} scale={scale} pct={pct} />
			<FlowSection title="Going out" groups={out} scale={scale} pct={pct} />
		</div>
	);
}

function FlowSection({
	title,
	groups,
	scale,
	pct,
}: {
	title: string;
	groups: FlowGroup[];
	scale: number;
	pct: (v: number) => number;
}) {
	const { fmtc } = useMoney();
	if (groups.length === 0) return null;
	return (
		<section className="flex flex-col gap-4">
			<h3 className="text-muted-foreground text-sm">{title}</h3>
			{groups.map((g) => (
				<div key={g.id} className="flex flex-col gap-2">
					<FlowRow
						label={g.label}
						value={`${fmtc(g.value)}/mo`}
						share={`${pct(g.value)}%`}
						width={g.value / scale}
						color={g.color}
						strong
					/>
					{g.leaves.length > 0 && (
						<ul className="ml-3 flex flex-col gap-2.5 border-border border-l pl-3">
							{g.leaves.map((l) => (
								<li key={l.key}>
									<FlowRow
										label={short(l.label)}
										value={fmtc(l.value)}
										share={`${pct(l.value)}%`}
										width={l.value / scale}
										color={g.color}
									/>
								</li>
							))}
						</ul>
					)}
				</div>
			))}
		</section>
	);
}

/** A label and its figure on one line, the bar under them drawn to the list's shared scale. */
function FlowRow({
	label,
	value,
	share,
	width,
	color,
	strong,
}: {
	label: string;
	value: string;
	share: string;
	width: number;
	color: string;
	strong?: boolean;
}) {
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-baseline justify-between gap-3">
				<span
					className={`min-w-0 truncate ${strong ? "font-medium" : "text-sm"}`}
				>
					{label}
				</span>
				<span className="tnum shrink-0 text-sm">
					<span className={strong ? "font-medium" : undefined}>{value}</span>
					<span className="ml-1.5 text-muted-foreground text-xs">{share}</span>
				</span>
			</div>
			<div
				className={`rounded-full bg-muted ${strong ? "h-2" : "h-1.5"}`}
				aria-hidden
			>
				<span
					className="block h-full rounded-full"
					style={{
						width: `${Math.max(1, Math.min(100, width * 100))}%`,
						backgroundColor: color,
						opacity: strong ? 0.92 : 0.7,
					}}
				/>
			</div>
		</div>
	);
}
