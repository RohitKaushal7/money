"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@money/ui/lib/utils";
import { XIcon } from "lucide-react";
import type * as React from "react";

/**
 * A dialog that changes shape rather than scale.
 *
 * On a phone it is a sheet: anchored to the bottom edge, full width, rounded only at the top, capped at
 * 90vh and scrolling inside. On a wider screen it is a centred modal. This is one component and one set of
 * children — a form long enough to need a dialog is long enough that shrinking a desktop modal onto a
 * 375px screen puts its actions off the bottom of the viewport.
 */

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cn("font-display font-medium text-lg", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cn("text-muted-foreground text-sm", className)}
			{...props}
		/>
	);
}

function DialogContent({
	className,
	children,
	title,
	description,
	...props
}: DialogPrimitive.Popup.Props & {
	/** Required: a dialog with no title is unnavigable by screen reader. */
	title: React.ReactNode;
	description?: React.ReactNode;
}) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Backdrop
				data-slot="dialog-backdrop"
				className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0"
			/>
			<DialogPrimitive.Popup
				data-slot="dialog-content"
				className={cn(
					"fixed z-50 flex flex-col gap-4 border border-border bg-card p-5 shadow-xl outline-none",
					// phone: a bottom sheet that can scroll rather than push its buttons off-screen
					"inset-x-0 bottom-0 max-h-[90vh] overflow-y-auto rounded-t-2xl",
					"data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
					// tablet and up: a centred modal
					"sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[85vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl",
					"sm:data-[ending-style]:translate-y-[-46%] sm:data-[starting-style]:translate-y-[-46%]",
					"transition-[transform,opacity] duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
					className,
				)}
				{...props}
			>
				<div className="flex items-start justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-1">
						<DialogTitle>{title}</DialogTitle>
						{description && (
							<DialogDescription>{description}</DialogDescription>
						)}
					</div>
					<DialogPrimitive.Close
						aria-label="Close"
						className="-mt-1 -mr-1 shrink-0 cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
					>
						<XIcon className="size-4" />
					</DialogPrimitive.Close>
				</div>
				{children}
			</DialogPrimitive.Popup>
		</DialogPrimitive.Portal>
	);
}

export {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogTitle,
	DialogTrigger,
};
