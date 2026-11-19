import { Input } from "@money/ui/components/input";
import { cn } from "@money/ui/lib/utils";
import { useId, useMemo, useState } from "react";
import { matchSuggestions, type Suggestion } from "@/lib/suggestions";

export type { Suggestion } from "@/lib/suggestions";
export { suggestionsFrom } from "@/lib/suggestions";

/**
 * A free-text field that suggests what you've used before, so a group or platform is picked rather than
 * retyped (and mistyped into a second group).
 *
 * Typing filters the list — prefix matches first. **Tab** or **Enter** takes the highlighted one (the first,
 * once you've typed something), ↑/↓ move, Esc closes. Taking a suggestion closes the list, so the next Tab
 * moves on as usual. It never forces a choice: anything typed is kept as typed.
 */
export function SuggestInput({
	value,
	onChange,
	suggestions,
	placeholder,
	className,
	id,
	maxLength,
	"aria-label": ariaLabel,
}: {
	value: string;
	onChange: (v: string) => void;
	suggestions: Suggestion[];
	placeholder?: string;
	className?: string;
	id?: string;
	maxLength?: number;
	"aria-label"?: string;
}) {
	const listId = useId();
	const [open, setOpen] = useState(false);
	// -1 = nothing highlighted: on an empty field the list is a menu to browse, and Tab should just move on.
	const [active, setActive] = useState(-1);
	const matches = useMemo(
		() => matchSuggestions(suggestions, value),
		[suggestions, value],
	);
	const shown = open && matches.length > 0;
	const highlighted = shown && active >= 0 ? matches[active] : undefined;

	const take = (s: Suggestion) => {
		onChange(s.value);
		setOpen(false);
		setActive(-1);
	};

	return (
		<div className={cn("relative", className)}>
			<Input
				id={id}
				aria-label={ariaLabel}
				role="combobox"
				aria-autocomplete="list"
				aria-expanded={shown}
				aria-controls={listId}
				aria-activedescendant={highlighted ? `${listId}-${active}` : undefined}
				autoComplete="off"
				value={value}
				maxLength={maxLength}
				placeholder={placeholder}
				onFocus={() => setOpen(true)}
				onBlur={() => {
					setOpen(false);
					setActive(-1);
				}}
				onChange={(e) => {
					onChange(e.target.value);
					setOpen(true);
					setActive(e.target.value.trim() ? 0 : -1);
				}}
				onKeyDown={(e) => {
					if (e.key === "ArrowDown" || e.key === "ArrowUp") {
						if (!matches.length) return;
						e.preventDefault();
						setOpen(true);
						const step = e.key === "ArrowDown" ? 1 : -1;
						setActive((i) => (i + step + matches.length) % matches.length);
					} else if ((e.key === "Tab" || e.key === "Enter") && highlighted) {
						if (e.shiftKey) return;
						e.preventDefault();
						take(highlighted);
					} else if (e.key === "Escape" && shown) {
						e.preventDefault();
						e.stopPropagation(); // close the list, not the dialog around it
						setOpen(false);
					}
				}}
			/>
			{shown && (
				<div
					id={listId}
					role="listbox"
					className="absolute inset-x-0 top-full z-50 mt-1 max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover py-1 pointer-coarse:text-base text-popover-foreground text-xs shadow-md"
				>
					{matches.map((s, i) => (
						<div
							key={s.value}
							id={`${listId}-${i}`}
							role="option"
							// focus stays in the input (aria-activedescendant); -1 only satisfies "options are focusable"
							tabIndex={-1}
							aria-selected={i === active}
							// mousedown, not click: a click lands after the input's blur has closed the list
							onMouseDown={(e) => {
								e.preventDefault();
								take(s);
							}}
							onMouseEnter={() => setActive(i)}
							className={cn(
								"flex pointer-coarse:min-h-11 cursor-pointer items-center gap-2 pointer-coarse:px-3 px-2.5 py-1.5",
								i === active && "bg-secondary",
							)}
						>
							<span className="min-w-0 flex-1 truncate">{s.value}</span>
							{s.hint && (
								<span className="shrink-0 text-muted-foreground">{s.hint}</span>
							)}
							{i === active && (
								<kbd className="pointer-coarse:hidden shrink-0 rounded border border-border px-1 text-[0.6rem] text-muted-foreground">
									Tab
								</kbd>
							)}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
