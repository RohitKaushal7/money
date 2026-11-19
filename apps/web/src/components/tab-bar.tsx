import { haptics } from "@/lib/haptics";

/**
 * The app's one tab bar. On desktop an underlined strip, not pills. On a phone it becomes a segmented
 * control: a 44px pill group whose current segment is a raised chip, the shape a thumb expects, and wide
 * enough per segment to hit without aiming. If the labels don't fit the width, the group scrolls sideways
 * rather than wrapping.
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
			className={`scrollbar-none flex gap-1 overflow-x-auto max-md:rounded-full max-md:bg-secondary max-md:p-1 md:border-border md:border-b ${className ?? ""}`}
		>
			{tabs.map((t) => (
				<button
					key={t.key}
					type="button"
					role="tab"
					aria-selected={t.key === active}
					onClick={() => {
						if (t.key !== active) haptics.selected();
						onSelect(t.key);
					}}
					className={`shrink-0 whitespace-nowrap text-sm transition-colors max-md:h-9 max-md:flex-1 max-md:rounded-full max-md:px-4 md:-mb-px md:border-b-2 md:px-3 md:py-2 ${
						t.key === active
							? "font-medium text-foreground max-md:bg-card max-md:shadow-sm md:border-foreground"
							: "text-muted-foreground hover:text-foreground md:border-transparent"
					}`}
				>
					{t.label}
				</button>
			))}
		</div>
	);
}
