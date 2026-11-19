import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { orpc } from "@/utils/orpc";

/**
 * A small chip reflecting the passive-income KPI's tax mode, clickable to toggle it. `post-tax` nets the
 * marginal rate off fixed-income returns (the after-tax KPI switch); `pre-tax` shows gross. The setting is
 * global (ADR-0011 / issue 005), so every coverage surface flips together on click.
 */
export function TaxModeChip({ className }: { className?: string }) {
	const qc = useQueryClient();
	const kpi = useQuery(orpc.tax.getKpiConfig.queryOptions());
	const setKpi = useMutation({
		...orpc.tax.setKpiConfig.mutationOptions(),
		onSuccess: () => qc.invalidateQueries(),
	});
	if (kpi.data == null) return null;
	const afterTax = kpi.data.enabled;
	return (
		<button
			type="button"
			onClick={() => setKpi.mutate({ enabled: !afterTax })}
			title="Toggle pre-tax / post-tax passive income"
			className={`relative whitespace-nowrap rounded-full bg-secondary px-1.5 py-0.5 text-[0.6rem] normal-case tracking-normal transition-colors after:absolute after:-inset-3 hover:bg-secondary/70 max-md:px-2.5 max-md:py-1 max-md:text-xs ${className ?? ""}`}
		>
			{afterTax ? "post-tax" : "pre-tax"}
		</button>
	);
}
