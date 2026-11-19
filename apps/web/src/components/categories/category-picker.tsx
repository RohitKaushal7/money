import { SheetRow } from "@money/ui/components/sheet";
import { ChevronLeft, Search } from "lucide-react";
import { useState } from "react";
import { groupByKind, kindColor, useCategories } from "@/lib/categories";

/**
 * The category list as the body of a sheet that's already open: a search field over big rows grouped by
 * Kind. For a phone sheet that needs a category in one of its steps (a transaction, a split line, a rule).
 *
 * In the sheet rather than a second sheet on top of it: one sheet whose contents swap reads like a pushed
 * screen, where a stacked sheet reads as a dialog over a dialog (and a nested drawer was seen to stay
 * parked below the screen instead of rising).
 */
export function CategoryPicker({
	value,
	onPick,
	onBack,
	activeOnly = true,
	disabled,
}: {
	value: string;
	onPick: (key: string) => void;
	/** shows a Back row above the search, for a picker that is one step of a sheet */
	onBack?: () => void;
	/** hide categories the person has hidden (except the current one) */
	activeOnly?: boolean;
	disabled?: boolean;
}) {
	const catsQ = useCategories();
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();
	const groups = groupByKind(catsQ.data ?? [], { activeOnly, keepKey: value })
		.map((g) => ({
			...g,
			cats: g.cats.filter((c) => !q || c.label.toLowerCase().includes(q)),
		}))
		.filter((g) => g.cats.length > 0);

	return (
		<>
			{onBack && <BackRow onClick={onBack} />}
			<label className="sticky top-0 z-10 -mx-1 flex h-11 shrink-0 items-center gap-2 rounded-xl bg-secondary px-3">
				<Search className="size-4 shrink-0 text-muted-foreground" />
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search categories"
					enterKeyHint="search"
					aria-label="Search categories"
					className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
				/>
			</label>
			<div className="flex flex-col">
				{groups.map((g) => (
					<div key={g.kind} className="flex flex-col">
						<p
							className="pt-3 pb-1 font-medium text-sm"
							style={{ color: kindColor(g.kind) }}
						>
							{g.label}
						</p>
						{g.cats.map((c) => (
							<SheetRow
								key={c.key}
								selected={c.key === value}
								disabled={disabled}
								onClick={() => onPick(c.key)}
							>
								{c.label}
							</SheetRow>
						))}
					</div>
				))}
				{groups.length === 0 && (
					<p className="py-6 text-center text-muted-foreground text-sm">
						{q ? `Nothing matches “${query}”` : "No categories yet."}
					</p>
				)}
			</div>
		</>
	);
}

/** "‹ Back" at the top of a sheet's sub-step. 44px tall, like the top bar's back to More. */
export function BackRow({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			className="-ml-2 flex h-11 shrink-0 items-center gap-0.5 self-start rounded-full pr-3 pl-1 text-base text-primary active:bg-secondary"
		>
			<ChevronLeft className="size-5" />
			Back
		</button>
	);
}

/** A field in a phone sheet that opens a picker step: label above, current value, chevron. */
export function PickerField({
	label,
	value,
	placeholder = "Choose…",
	color,
	onClick,
	disabled,
}: {
	label: string;
	value: string | undefined;
	placeholder?: string;
	color?: string;
	onClick: () => void;
	disabled?: boolean;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-muted-foreground text-sm">{label}</span>
			<button
				type="button"
				onClick={onClick}
				disabled={disabled}
				aria-label={`${label}: ${value ?? placeholder}`}
				className="flex h-11 w-full items-center justify-between gap-2 rounded-xl border border-input bg-background px-3 text-left text-base active:bg-secondary disabled:opacity-50 dark:bg-input/30"
			>
				<span
					className={`truncate ${value ? "" : "text-muted-foreground"}`}
					style={value && color ? { color } : undefined}
				>
					{value ?? placeholder}
				</span>
				<ChevronLeft className="size-4 shrink-0 rotate-180 text-muted-foreground" />
			</button>
		</div>
	);
}

/** A 52px row with a switch on the right; the whole row toggles. */
export function SwitchRow({
	label,
	hint,
	checked,
	onChange,
	disabled,
}: {
	label: string;
	hint?: string;
	checked: boolean;
	onChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onChange(!checked)}
			className="-mx-2 flex min-h-13 w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-3 text-left text-base active:bg-secondary disabled:opacity-50"
		>
			<span className="flex min-w-0 flex-1 flex-col">
				<span>{label}</span>
				{hint && <span className="text-muted-foreground text-sm">{hint}</span>}
			</span>
			<span
				aria-hidden="true"
				className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}
			>
				<span
					className={`absolute top-0.5 size-6 rounded-full bg-background shadow-sm transition-transform ${checked ? "translate-x-5.5" : "translate-x-0.5"}`}
				/>
			</span>
		</button>
	);
}
