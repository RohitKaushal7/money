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
			<div className="flex flex-wrap items-end justify-between gap-3 border-border border-b-2 pb-2">
				<h2 className="font-display font-medium text-xl">{title}</h2>
				{action}
			</div>
			{children}
		</section>
	);
}

/** A labelled control. The label is the small upper-case caption used across settings. */
export function Field({
	label,
	children,
}: {
	label: string;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<span className="text-[0.65rem] text-muted-foreground uppercase tracking-wider">
				{label}
			</span>
			{children}
		</div>
	);
}

/** The bordered text input used by settings forms. */
export function TextInput(props: React.ComponentProps<"input">) {
	return (
		<input
			{...props}
			className={`rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 ${props.className ?? ""}`}
		/>
	);
}
