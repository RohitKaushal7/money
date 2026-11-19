import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The phone's grouped inset list, in the shape of a phone's own Settings: a rounded bordered card of rows
 * with hairlines between them, and a quiet label above. The More screen drew this first; Settings, Tax and
 * Admin reuse it here so the shapes can't drift apart.
 *
 * Row anatomy: an optional icon tile, a label over an optional hint, then a chevron where the row goes
 * somewhere or a control where it changes something in place. Rows are at least 56px, the whole row is the
 * target, and a press tints the row rather than relying on hover.
 */
export function ListGroup({
	label,
	footer,
	children,
	className = "",
}: {
	label?: ReactNode;
	/** a note under the card, e.g. what a switch affects */
	footer?: ReactNode;
	children: ReactNode;
	className?: string;
}) {
	return (
		<section className={`flex flex-col gap-2 ${className}`}>
			{label && (
				<h2 className="px-4 font-medium text-muted-foreground text-sm">
					{label}
				</h2>
			)}
			<div className="flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
				{children}
			</div>
			{footer && (
				<p className="px-4 text-muted-foreground text-sm leading-snug">
					{footer}
				</p>
			)}
		</section>
	);
}

export function IconTile({ children }: { children: ReactNode }) {
	return (
		<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary text-foreground">
			{children}
		</span>
	);
}

/** Label over hint, the middle of every row. */
export function RowText({
	label,
	hint,
}: {
	label: ReactNode;
	hint?: ReactNode;
}) {
	return (
		<span className="flex min-w-0 flex-1 flex-col">
			<span className="text-base">{label}</span>
			{hint && (
				<span className="text-muted-foreground text-sm leading-snug">
					{hint}
				</span>
			)}
		</span>
	);
}

export const ROW_CLASS =
	"flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-secondary/70 disabled:active:bg-transparent";

export function RowChevron() {
	return <ChevronRight className="size-5 shrink-0 text-muted-foreground/70" />;
}

/** A 51×31 switch, the size a thumb expects. Drawn only: the row around it is the control. */
export function Switch({ on }: { on: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={`relative block h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
				on ? "bg-primary" : "bg-muted-foreground/30"
			}`}
		>
			<span
				className={`absolute top-[2px] left-[2px] size-[27px] rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
					on ? "translate-x-5" : "translate-x-0"
				}`}
			/>
		</span>
	);
}

/** A whole row that flips a setting. `role="switch"` so a screen reader hears on/off, not "button". */
export function SwitchRow({
	on,
	onToggle,
	label,
	hint,
	icon,
	disabled,
}: {
	on: boolean;
	onToggle: () => void;
	label: ReactNode;
	hint?: ReactNode;
	icon?: ReactNode;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			role="switch"
			aria-checked={on}
			disabled={disabled}
			onClick={onToggle}
			className={`${ROW_CLASS} disabled:opacity-60`}
		>
			{icon && <IconTile>{icon}</IconTile>}
			<RowText label={label} hint={hint} />
			<Switch on={on} />
		</button>
	);
}
