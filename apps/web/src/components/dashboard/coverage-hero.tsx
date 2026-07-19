import { useQuery } from "@tanstack/react-query";
import { useMoney } from "@/lib/currency";
import { formatPct, formatRatio } from "@/lib/format";
import { orpc } from "@/utils/orpc";

interface CoverageHeroProps {
	/** expected monthly passive income (the total-tier ladder numerator; ADR-0015) */
	interest: number;
	/** expected monthly recurring expenses */
	expenses: number;
	/** passiveIncome / expenses; null when there are no recurring expenses yet */
	ratio: number | null;
}

/**
 * The north-star KPI (ADR-0011 revised) as the emotional centerpiece: what fraction of your recurring
 * expenses your expected passive income covers, and how far from "1.0× = free". Plan-driven and monthly —
 * both sides come from the Plan, not the noisy statement. Green when covered, warm amber while not.
 */
export function CoverageHero({ interest, expenses, ratio }: CoverageHeroProps) {
	const m = useMoney();
	const kpi = useQuery(orpc.tax.getKpiConfig.queryOptions());
	const afterTax = kpi.data?.enabled ?? false;
	const passive = interest;
	const covered = ratio != null && ratio >= 1;
	const gap = Math.max(0, expenses - passive);
	const fill = ratio == null ? 1.5 : Math.max(1.5, Math.min(100, ratio * 100));
	const accent = covered ? "var(--covered)" : "var(--uncovered)";

	return (
		<section className="flex flex-col gap-8">
			<div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
				<div className="max-w-xl">
					<p className="flex items-center gap-2 font-medium text-[0.7rem] text-muted-foreground uppercase tracking-[0.22em]">
						Passive-income coverage · monthly
						{afterTax && (
							<span className="rounded-full bg-secondary px-1.5 py-0.5 text-[0.6rem] normal-case tracking-normal">
								after-tax
							</span>
						)}
					</p>
					<div className="mt-3 flex items-baseline gap-4">
						<span
							className="tnum font-display font-medium text-[clamp(4.5rem,15vw,10rem)] leading-[0.82] tracking-tight"
							style={{ color: accent }}
						>
							{ratio == null ? "—" : formatRatio(ratio)}
						</span>
					</div>
					<p className="mt-5 max-w-md text-foreground/80 text-lg leading-snug">
						{ratio == null ? (
							<>Add recurring expenses to complete the ratio.</>
						) : (
							<>
								Passive income covers{" "}
								<span className="font-semibold" style={{ color: accent }}>
									{formatPct(ratio)}
								</span>{" "}
								of your recurring expenses.{" "}
								{covered
									? "You're free — it fully covers your baseline."
									: "Keep growing it toward 1.0×."}
							</>
						)}
					</p>
				</div>

				<dl className="grid grid-cols-3 gap-x-8 gap-y-1 lg:text-right">
					<Stat label="Passive / mo" value={m.fmt(passive)} tone="covered" />
					<Stat label="Expenses / mo" value={m.fmt(expenses)} />
					<Stat
						label="Gap to freedom"
						value={m.fmt(gap)}
						tone={covered ? "covered" : "uncovered"}
					/>
				</dl>
			</div>

			{/* progress toward 1.0× */}
			<div className="flex flex-col gap-2">
				<div className="relative h-3 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full transition-[width] duration-700 ease-out"
						style={{ width: `${fill}%`, backgroundColor: accent }}
					/>
				</div>
				<div className="flex items-center justify-between text-muted-foreground text-xs">
					<span>now · {ratio == null ? "—" : formatRatio(ratio)}</span>
					<span className="font-medium text-foreground/70">
						1.0× — passive income covers everything
					</span>
				</div>
			</div>
		</section>
	);
}

function Stat({
	label,
	value,
	tone,
}: {
	label: string;
	value: string;
	tone?: "covered" | "uncovered";
}) {
	const color =
		tone === "covered"
			? "var(--covered)"
			: tone === "uncovered"
				? "var(--uncovered)"
				: undefined;
	return (
		<div className="flex flex-col lg:items-end">
			<dt className="order-2 text-muted-foreground text-xs">{label}</dt>
			<dd
				className="tnum order-1 font-display font-medium text-2xl"
				style={color ? { color } : undefined}
			>
				{value}
			</dd>
		</div>
	);
}
