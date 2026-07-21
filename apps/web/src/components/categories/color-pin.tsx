import { COLOR_SLOTS, type ColorSlot, slotVar } from "@money/shared";
import { useEffect, useRef, useState } from "react";

/**
 * Pin a category to a palette slot, or leave it free.
 *
 * Slots rather than a freeform colour picker, deliberately: the five `--cat-*` steps are validated
 * all-pairs for colour-blind separation, and an arbitrary hex would quietly break that. Five is the
 * ceiling — no sixth hue survives the check.
 *
 * Sharing a slot is allowed, because two categories only clash if they appear in the same chart at the
 * same time, and only you know whether they will. So the picker reports who else holds a slot rather than
 * refusing the pick.
 */
export function ColorPin({
	slot,
	slotUsers,
	onPick,
	disabled,
}: {
	slot: ColorSlot | null;
	/** Slot → labels of the other categories already pinned there. */
	slotUsers: Map<ColorSlot, string[]>;
	onPick: (slot: ColorSlot | null) => void;
	disabled?: boolean;
}) {
	const [open, setOpen] = useState(false);
	const box = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		const away = (e: MouseEvent) => {
			if (!box.current?.contains(e.target as Node)) setOpen(false);
		};
		const esc = (e: KeyboardEvent) => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", away);
		document.addEventListener("keydown", esc);
		return () => {
			document.removeEventListener("mousedown", away);
			document.removeEventListener("keydown", esc);
		};
	}, [open]);

	return (
		<div ref={box} className="relative">
			<button
				type="button"
				disabled={disabled}
				onClick={() => setOpen((o) => !o)}
				aria-label={slot ? `Colour slot ${slot}` : "No colour pinned"}
				title={
					slot
						? `Pinned to slot ${slot} — click to change`
						: "No colour pinned — takes a free slot when shown"
				}
				className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md hover:bg-secondary/60 disabled:opacity-40"
			>
				<span
					className={`size-3.5 rounded-full ${slot ? "" : "border border-muted-foreground/50 border-dashed"}`}
					style={slot ? { backgroundColor: slotVar(slot) } : undefined}
				/>
			</button>

			{open && (
				<div className="absolute top-8 right-0 z-20 flex items-center gap-1 rounded-lg border border-border bg-popover p-1.5 shadow-lg">
					{COLOR_SLOTS.map((s) => {
						const others = slotUsers.get(s) ?? [];
						return (
							<button
								key={s}
								type="button"
								onClick={() => {
									onPick(s);
									setOpen(false);
								}}
								aria-label={`Use slot ${s}`}
								title={
									others.length
										? `Also used by ${others.join(", ")}`
										: `Slot ${s} — free`
								}
								className={`grid size-6 cursor-pointer place-items-center rounded-md ${s === slot ? "ring-2 ring-foreground/60" : ""}`}
							>
								<span
									className="size-3.5 rounded-full"
									style={{ backgroundColor: slotVar(s) }}
								/>
								{others.length > 0 && (
									<span className="absolute -bottom-0.5 size-1 rounded-full bg-foreground/50" />
								)}
							</button>
						);
					})}
					<button
						type="button"
						onClick={() => {
							onPick(null);
							setOpen(false);
						}}
						className="ml-1 cursor-pointer whitespace-nowrap rounded-md px-1.5 py-1 text-muted-foreground text-xs hover:bg-secondary/60 hover:text-foreground"
						title="Let this category take whichever slot is free"
					>
						None
					</button>
				</div>
			)}
		</div>
	);
}
