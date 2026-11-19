import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerTitle,
} from "@money/ui/components/drawer";
import { cn } from "@money/ui/lib/utils";
import { XIcon } from "lucide-react";
import type * as React from "react";

/**
 * A sheet from the foot of the screen, the phone's answer to a popover or a dialog. Swipe it down to close.
 *
 * No trigger of its own: the caller owns `open`, so a row tap, a filter chip or a Select can each open one.
 * The same shell everywhere: a grab bar, a title, a 44px close, a 28px top radius, and padding that clears
 * the home indicator. From `md` up it stays a sheet but is held to a phone's width in the middle, since a
 * caller that chose a sheet has no single control to hang a popover from.
 */
export function Sheet({
	open,
	onOpenChange,
	title,
	description,
	children,
	footer,
	className,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: React.ReactNode;
	description?: React.ReactNode;
	children: React.ReactNode;
	/** pinned under the scrolling body, e.g. a Save button that must stay in reach */
	footer?: React.ReactNode;
	className?: string;
}) {
	return (
		<Drawer open={open} onOpenChange={onOpenChange}>
			<DrawerContent
				className={cn(
					"rounded-t-[28px] border-0 bg-card text-base text-card-foreground [--drawer-bleed-background:var(--color-card)] data-[swipe-direction=down]:rounded-t-[28px] data-[swipe-direction=down]:border-t-0 md:mx-auto md:max-w-[28rem]",
					className,
				)}
			>
				<div
					className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/40"
					aria-hidden="true"
				/>
				<div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-3">
					<div className="min-w-0">
						<DrawerTitle className="font-display font-medium text-foreground text-xl tracking-tight">
							{title}
						</DrawerTitle>
						{description ? (
							<DrawerDescription className="mt-1 text-pretty text-muted-foreground text-sm leading-snug">
								{description}
							</DrawerDescription>
						) : null}
					</div>
					<DrawerClose
						aria-label="Close"
						className="-mt-1.5 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-secondary"
					>
						<XIcon className="size-5" />
					</DrawerClose>
				</div>
				<div
					className={cn(
						"flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-5 pt-3",
						footer ? "pb-3" : "pb-[max(1.5rem,env(safe-area-inset-bottom))]",
					)}
				>
					{children}
				</div>
				{footer ? (
					<div className="shrink-0 border-border border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
						{footer}
					</div>
				) : null}
			</DrawerContent>
		</Drawer>
	);
}

/**
 * One row in a sheet's list: 52px, full width, the whole row is the target. `selected` shows a check.
 * For pickers (a Select on a phone, a filter) and for action lists (row → "Create rule", "Split").
 */
export function SheetRow({
	children,
	onClick,
	selected,
	destructive,
	disabled,
	trailing,
	className,
	style,
}: {
	children: React.ReactNode;
	onClick?: () => void;
	selected?: boolean;
	destructive?: boolean;
	disabled?: boolean;
	trailing?: React.ReactNode;
	className?: string;
	style?: React.CSSProperties;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-pressed={selected}
			style={style}
			className={cn(
				"-mx-2 flex min-h-13 w-[calc(100%+1rem)] items-center gap-3 rounded-xl px-3 text-left text-base transition-colors active:bg-secondary disabled:opacity-50",
				selected && "bg-secondary/70 font-medium",
				destructive && "text-destructive",
				className,
			)}
		>
			<span className="min-w-0 flex-1 truncate">{children}</span>
			{trailing}
			{selected ? (
				<svg
					viewBox="0 0 24 24"
					className="size-5 shrink-0 text-primary"
					fill="none"
					stroke="currentColor"
					strokeWidth="2.4"
					strokeLinecap="round"
					strokeLinejoin="round"
					aria-hidden="true"
				>
					<path d="M20 6 9 17l-5-5" />
				</svg>
			) : null}
		</button>
	);
}
