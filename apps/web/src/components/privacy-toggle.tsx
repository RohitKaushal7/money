import { Button } from "@money/ui/components/button";
import { useHotkey } from "@tanstack/react-hotkeys";
import { Eye, EyeOff } from "lucide-react";
import {
	readPreference,
	usePreference,
	writePreference,
} from "@/lib/preferences";

export const PRIVACY_HOTKEY = "Shift+H";

/**
 * Hide every amount on screen, for when someone else is looking at it.
 *
 * A shoulder-surfing guard, not a security control: the real values are still in the DOM and one keystroke
 * away. It exists so a friend at your laptop sees the shape of the app without seeing the size of your
 * portfolio. The lock screen is the thing that keeps them out.
 */
export function PrivacyToggle() {
	const [hidden, setHidden] = usePreference("privacy.hidden");
	const Icon = hidden ? EyeOff : Eye;
	const label = hidden ? "Show amounts" : "Hide amounts";
	return (
		<Button
			variant="outline"
			size="icon"
			onClick={() => setHidden(!hidden)}
			aria-pressed={hidden}
			title={`${label} · ⇧H`}
			// Privacy mode is easy to leave on by accident — the lit button is how you find out why every
			// figure is dots, so it has to read as *on*, not merely as a button you pressed once.
			className={
				hidden
					? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary dark:bg-primary/15"
					: undefined
			}
		>
			<Icon className="h-[1.2rem] w-[1.2rem]" />
			<span className="sr-only">{label}</span>
		</Button>
	);
}

/**
 * ⇧H toggles privacy mode from anywhere.
 *
 * Registered once by the authenticated layout rather than by {@link PrivacyToggle}, because the sidebar
 * renders twice — the desktop rail and the mobile drawer are both mounted at every width — and two
 * registrations would toggle twice per press and cancel out.
 *
 * Reads through the store instead of closing over state, so the handler has nothing to go stale. The
 * library's `ignoreInputs` defaults to true for Shift combos, so typing an H in the transaction search box
 * doesn't blank the page.
 */
export function usePrivacyHotkey() {
	useHotkey(PRIVACY_HOTKEY, () => {
		writePreference("privacy.hidden", !readPreference("privacy.hidden"));
	});
}
