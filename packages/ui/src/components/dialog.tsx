"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { Drawer, DrawerContent } from "@money/ui/components/drawer";
import { useIsPhone } from "@money/ui/hooks/use-media-query";
import { cn } from "@money/ui/lib/utils";
import { XIcon } from "lucide-react";
import * as React from "react";

/**
 * A dialog that changes shape rather than scale.
 *
 * On a phone it is a real bottom sheet: Base UI's Drawer, so it follows the finger and closes on a swipe
 * down, the way every native sheet does; full width, rounded at the top, scrolling inside. On a wider
 * screen it is a centred modal. One component and one set of children for both, because a form long enough
 * to need a dialog is long enough that shrinking a desktop modal onto a 375px screen puts its actions off
 * the bottom of the viewport. The parts (Trigger, Close, Title, Description) follow whichever root is
 * rendering, so callers never branch.
 */

const PhoneDialog = React.createContext(false);

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
	const phone = useIsPhone();
	return (
		<PhoneDialog.Provider value={phone}>
			{phone ? (
				<Drawer {...(props as React.ComponentProps<typeof Drawer>)} />
			) : (
				<DialogPrimitive.Root data-slot="dialog" {...props} />
			)}
		</PhoneDialog.Provider>
	);
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
	const phone = React.useContext(PhoneDialog);
	return phone ? (
		<DrawerPrimitive.Trigger
			data-slot="dialog-trigger"
			{...(props as DrawerPrimitive.Trigger.Props)}
		/>
	) : (
		<DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
	);
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
	const phone = React.useContext(PhoneDialog);
	return phone ? (
		<DrawerPrimitive.Close
			data-slot="dialog-close"
			{...(props as DrawerPrimitive.Close.Props)}
		/>
	) : (
		<DialogPrimitive.Close data-slot="dialog-close" {...props} />
	);
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
	const phone = React.useContext(PhoneDialog);
	const cls = cn("font-display font-medium text-lg", className);
	return phone ? (
		<DrawerPrimitive.Title
			data-slot="dialog-title"
			className={cn(cls, "text-xl tracking-tight")}
			{...(props as DrawerPrimitive.Title.Props)}
		/>
	) : (
		<DialogPrimitive.Title
			data-slot="dialog-title"
			className={cls}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	const phone = React.useContext(PhoneDialog);
	const cls = cn("text-muted-foreground text-sm", className);
	return phone ? (
		<DrawerPrimitive.Description
			data-slot="dialog-description"
			className={cls}
			{...(props as DrawerPrimitive.Description.Props)}
		/>
	) : (
		<DialogPrimitive.Description
			data-slot="dialog-description"
			className={cls}
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
	const phone = React.useContext(PhoneDialog);
	if (phone) {
		return (
			<DrawerContent
				data-slot="dialog-content"
				className={cn(
					"rounded-t-[28px] bg-card text-base text-card-foreground [--drawer-bleed-background:var(--color-card)] data-[swipe-direction=down]:rounded-t-[28px]",
					className,
				)}
				{...(props as DrawerPrimitive.Popup.Props)}
			>
				<div
					aria-hidden="true"
					className="mx-auto mt-3 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/40"
				/>
				<div className="flex shrink-0 items-start justify-between gap-4 px-5 pt-3 pb-1">
					<div className="flex min-w-0 flex-col gap-1">
						<DialogTitle>{title}</DialogTitle>
						{description && (
							<DialogDescription>{description}</DialogDescription>
						)}
					</div>
					<DrawerPrimitive.Close
						aria-label="Close"
						className="-mt-1.5 -mr-2.5 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-secondary"
					>
						<XIcon className="size-5" />
					</DrawerPrimitive.Close>
				</div>
				{/* Same padding as the desktop popup, so content that pins itself to the bottom edge (Plan's Save
				    bar) lines up in both shapes. */}
				<div className="flex min-h-0 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
					{children}
				</div>
			</DrawerContent>
		);
	}
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
					"inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-[28px] border-x-0 border-b-0 pb-[max(1.25rem,env(safe-area-inset-bottom))]",
					"data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full",
					// tablet and up: a centred modal
					"sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-h-[85vh] sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border-x sm:border-b sm:pb-5",
					"sm:data-[ending-style]:translate-y-[-46%] sm:data-[starting-style]:translate-y-[-46%]",
					"transition-[transform,opacity] duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0",
					className,
				)}
				{...props}
			>
				<div
					aria-hidden="true"
					className="mx-auto -mt-2 -mb-1 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/40 sm:hidden"
				/>
				<div className="flex items-start justify-between gap-4">
					<div className="flex min-w-0 flex-col gap-1">
						<DialogTitle>{title}</DialogTitle>
						{description && (
							<DialogDescription>{description}</DialogDescription>
						)}
					</div>
					<DialogPrimitive.Close
						aria-label="Close"
						className="-mt-1 touch:-mt-2.5 -mr-1 touch:-mr-2.5 flex touch:size-11 shrink-0 cursor-pointer items-center justify-center rounded-md touch:rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
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
