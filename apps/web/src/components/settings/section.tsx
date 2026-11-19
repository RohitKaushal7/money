import type { ReactNode } from "react";

/**
 * A settings block: rule-underlined heading, optional action on the right, then the controls.
 *
 * Lifted out of the Currencies / After-tax cards so the tabs added later can't invent a second heading
 * style. The double bottom rule is the existing look — kept deliberately.
 */
export function Section({
	title,
	action,
	children,
}: {
	title: string;
	action?: ReactNode;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-4">
			{/* On a phone the double rule goes: the inset cards under it already mark where a block starts. */}
			<div className="flex flex-wrap items-end justify-between gap-3 border-border border-b-2 pb-2 max-md:items-center max-md:border-b-0 max-md:px-1 max-md:pb-0">
				<h2 className="font-display font-medium text-xl">{title}</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

/**
 * A labelled control. The label is the small upper-case caption used across settings; on a phone it is a
 * readable sentence-case label and the field takes the full width, so every form is a single column.
 */
export function Field({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1 max-md:w-full max-md:gap-1.5">
			<span className="text-[0.65rem] text-muted-foreground uppercase tracking-wider max-md:px-1 max-md:text-sm max-md:normal-case max-md:tracking-normal">
				{label}
			</span>
			{children}
		</div>
	);
}

/** The bordered text input used by settings forms. 44px and 16px on a phone, so iOS doesn't zoom into it. */
export function TextInput(props: React.ComponentProps<"input">) {
	return (
		<input
			{...props}
			className={`rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 max-md:h-11 max-md:rounded-lg max-md:px-3 max-md:text-base ${props.className ?? ""} max-md:w-full`}
		/>
	);
}

/** Phone-only sizing for a form's buttons: a full 44px row, sharing the width when there are two. */
export const PHONE_BUTTON = "max-md:min-h-11 max-md:flex-1";

/** Phone-only: a form sits in an inset card, the shape of a phone's own forms. */
export const PHONE_FORM =
	"max-md:rounded-2xl max-md:border max-md:border-border max-md:bg-card max-md:p-4";
