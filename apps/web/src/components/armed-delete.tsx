import { Button } from "@money/ui/components/button";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

/** Long enough to read the warning and reach for it, short enough that a stray tap expires unused. */
const DISARM_MS = 4000;

/**
 * Delete that takes two taps: the first turns it red and says so, the second does it.
 *
 * Inline rather than a dialog — what you're deleting is right there in the row, and a modal would cover
 * the one detail worth checking before you commit. It stays a single element across both states so
 * keyboard focus survives arming, and it disarms itself after a moment: a tap you didn't mean to make
 * should expire on its own rather than sit waiting to be finished by your next one.
 */
export function ArmedDelete({
	onConfirm,
	label,
	title = "Delete",
	disabled,
	size = "icon-sm",
	className = "",
}: {
	onConfirm: () => void;
	/** Text beside the icon when idle. Omit for an icon-only button. */
	label?: string;
	title?: string;
	disabled?: boolean;
	size?: "xs" | "sm" | "icon-xs" | "icon-sm";
	className?: string;
}) {
	const [armed, setArmed] = useState(false);

	useEffect(() => {
		if (!armed) return;
		const timer = setTimeout(() => setArmed(false), DISARM_MS);
		return () => clearTimeout(timer);
	}, [armed]);

	return (
		<Button
			type="button"
			// The icon sizes are square and can't hold the warning, so armed always falls back to the text size.
			size={armed ? (size.replace("icon-", "") as "xs" | "sm") : size}
			variant={armed ? "destructive" : "ghost"}
			disabled={disabled}
			title={armed ? undefined : title}
			aria-label={armed ? "Tap again to delete" : title}
			onClick={() => {
				if (!armed) {
					setArmed(true);
					return;
				}
				setArmed(false);
				onConfirm();
			}}
			onKeyDown={(e) => {
				if (e.key === "Escape") setArmed(false);
			}}
			onBlur={() => setArmed(false)}
			className={`${armed ? "" : "text-muted-foreground hover:text-[var(--uncovered)]"} ${className}`}
		>
			<Trash2 className="size-3.5" />
			{armed ? (
				<span className="whitespace-nowrap">Tap again to delete</span>
			) : (
				label && <span>{label}</span>
			)}
		</Button>
	);
}
