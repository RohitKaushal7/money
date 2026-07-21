/**
 * The app's one tab bar: an underlined strip, not pills.
 *
 * Shared so pages can't drift into slightly different tabs. Generic over the key so each caller keeps its
 * own literal union and a typo in a key is a compile error rather than a tab that silently never activates.
 */
export function TabBar<K extends string>({
	tabs,
	active,
	onSelect,
	className,
}: {
	tabs: readonly { key: K; label: string }[];
	active: K;
	onSelect: (key: K) => void;
	className?: string;
}) {
	return (
		<div
			role="tablist"
			className={`flex gap-1 border-border border-b ${className ?? ""}`}
		>
			{tabs.map((t) => (
				<button
					key={t.key}
					type="button"
					role="tab"
					aria-selected={t.key === active}
					onClick={() => onSelect(t.key)}
					className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
						t.key === active
							? "border-foreground font-medium text-foreground"
							: "border-transparent text-muted-foreground hover:text-foreground"
					}`}
				>
					{t.label}
				</button>
			))}
		</div>
	);
}
