import { formatDate, toISODate } from "@money/shared";
import { Input } from "@money/ui/components/input";
import { cn } from "@money/ui/lib/utils";
import { CalendarDays } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * The app's one date field: typed and shown as `DD-MM-YYYY`, emitted as `YYYY-MM-DD`.
 *
 * A native `type="date"` can't do this — it shows whatever the browser's locale says (`MM/DD/YYYY` on an
 * en-US browser). So the field is text, and the native picker sits behind the calendar button, opened with
 * `showPicker()`, for when clicking a day is easier than typing one.
 *
 * Typing accepts `15-11-2026`, `15/11/2026`, `15.11.2026`, `5-1-2027` and `15112026`, and tidies to
 * `15-11-2026` on blur. `onChange` gets `YYYY-MM-DD`, `""` when emptied, or `null` while the text isn't a
 * real day within `min`/`max` — so a form can refuse to save rather than send a wrong date.
 */
export function DateInput({
	value,
	onChange,
	min,
	max,
	className,
	inputClassName,
	required,
	id,
	"aria-label": ariaLabel,
}: {
	/** `YYYY-MM-DD`, `""` for none, or the `null` this field emitted for text that isn't a date yet. */
	value: string | null;
	onChange: (iso: string | null) => void;
	/** inclusive bounds, `YYYY-MM-DD` */
	min?: string;
	max?: string;
	/** on the wrapper: width, margins */
	className?: string;
	/** on the text field itself: height, text size, border — to match the inputs around it */
	inputClassName?: string;
	required?: boolean;
	id?: string;
	"aria-label"?: string;
}) {
	const [text, setText] = useState(() => formatDate(value ?? ""));
	const [focused, setFocused] = useState(false);
	const picker = useRef<HTMLInputElement>(null);
	// The last value this field emitted. A `value` that differs came from outside (a reset, a preset), so
	// the text follows it; one that matches is our own echo, and the text the person is typing stays.
	const emitted = useRef<string | null>(value);

	useEffect(() => {
		if (value !== emitted.current) {
			emitted.current = value;
			setText(formatDate(value ?? ""));
		}
	}, [value]);

	const parse = (t: string): string | null => {
		if (t.trim() === "") return "";
		const iso = toISODate(t);
		if (!iso) return null;
		if ((min && iso < min) || (max && iso > max)) return null;
		return iso;
	};

	const emit = (iso: string | null) => {
		emitted.current = iso;
		onChange(iso);
	};

	const parsed = parse(text);
	const invalid = parsed === null || (required === true && parsed === "");

	return (
		<div className={cn("relative", className)}>
			<Input
				id={id}
				aria-label={ariaLabel}
				type="text"
				inputMode="numeric"
				autoComplete="off"
				placeholder="DD-MM-YYYY"
				value={text}
				required={required}
				aria-invalid={!focused && text !== "" && invalid ? true : undefined}
				onFocus={() => setFocused(true)}
				onBlur={() => {
					setFocused(false);
					if (parsed) setText(formatDate(parsed));
				}}
				onChange={(e) => {
					setText(e.target.value);
					emit(parse(e.target.value));
				}}
				className={cn("tnum w-full pointer-coarse:pr-11 pr-8", inputClassName)}
			/>
			<button
				type="button"
				tabIndex={-1}
				aria-label="Pick a date"
				onClick={() => {
					const el = picker.current;
					if (!el) return;
					el.value = parsed || "";
					try {
						el.showPicker();
					} catch {
						el.focus();
					}
				}}
				className="absolute inset-y-0 right-0 flex pointer-coarse:w-11 w-8 items-center justify-center text-muted-foreground hover:text-foreground"
			>
				<CalendarDays className="pointer-coarse:size-4 size-3.5" />
			</button>
			{/* The native picker, invisible, anchored under the button so its popup opens there. */}
			<input
				ref={picker}
				type="date"
				tabIndex={-1}
				aria-hidden
				min={min}
				max={max}
				onChange={(e) => {
					const iso = e.target.value;
					setText(formatDate(iso));
					emit(parse(iso));
				}}
				className="pointer-events-none absolute right-0 bottom-0 h-0 pointer-coarse:w-11 w-8 opacity-0"
			/>
		</div>
	);
}
