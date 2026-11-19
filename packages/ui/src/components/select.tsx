"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Sheet, SheetRow } from "@money/ui/components/sheet";
import { useIsPhone } from "@money/ui/hooks/use-media-query";
import { cn } from "@money/ui/lib/utils";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

/**
 * Themed Select built on `@base-ui/react` — replaces native `<select>` (which ignores the app theme and
 * renders the OS-default dropdown). Convenience `options` / `groups` API so a native select converts ~1:1:
 *
 *   <Select value={x} onValueChange={setX} options={[{ value, label }]} />
 *   <Select value={x} onValueChange={setX} groups={[{ label, options }]} placeholder="— pick —" />
 *
 * On a phone the same props open a bottom sheet of 52px rows instead of a popover of 12px ones, with a search
 * field once there are more than eight options (the category pickers). Callers don't branch.
 */

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectOptionGroup = {
	label: string;
	options: SelectOption[];
	/** optional group-label colour (e.g. per-Kind on the category pickers) */
	color?: string;
};

type SelectProps = {
	value: string;
	onValueChange: (value: string) => void;
	options?: SelectOption[];
	groups?: SelectOptionGroup[];
	placeholder?: string;
	disabled?: boolean;
	id?: string;
	"aria-label"?: string;
	/** trigger classes (size/width/colour overrides) */
	className?: string;
	/** trigger inline style (e.g. per-kind colouring on the transactions picker) */
	style?: React.CSSProperties;
	/** sheet title on a phone; defaults to the aria-label, then the placeholder */
	sheetTitle?: string;
};

const TRIGGER =
	"flex h-8 w-full items-center justify-between gap-2 rounded-lg border border-input bg-transparent px-2.5 text-foreground text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-popup-open:border-ring dark:bg-input/30 touch:h-11 touch:px-3 touch:text-base";

function flatItems(
	options?: SelectOption[],
	groups?: SelectOptionGroup[],
): { value: string; label: string }[] {
	return [...(options ?? []), ...(groups ?? []).flatMap((g) => g.options)].map(
		(o) => ({ value: o.value, label: o.label }),
	);
}

export function Select(props: SelectProps) {
	const phone = useIsPhone();
	return phone ? <SheetSelect {...props} /> : <PopoverSelect {...props} />;
}

function PopoverSelect({
	value,
	onValueChange,
	options,
	groups,
	placeholder = "Select…",
	disabled,
	id,
	className,
	style,
	sheetTitle: _sheetTitle,
	...rest
}: SelectProps) {
	const items = flatItems(options, groups);
	// base-ui shows the placeholder only for a null value; coerce an unmatched "" (a command-style picker
	// that always resets, e.g. "File under…") to null so the placeholder shows instead of a blank trigger.
	const rootValue =
		value === "" && !items.some((i) => i.value === "") ? null : value;
	return (
		<SelectPrimitive.Root
			items={items}
			value={rootValue}
			onValueChange={(v) => onValueChange(v as string)}
			disabled={disabled}
		>
			<SelectPrimitive.Trigger
				id={id}
				aria-label={rest["aria-label"]}
				style={style}
				className={cn(TRIGGER, className)}
			>
				<SelectPrimitive.Value
					placeholder={placeholder}
					className="truncate data-[placeholder]:text-muted-foreground"
				/>
				<SelectPrimitive.Icon className="shrink-0 text-muted-foreground">
					<ChevronDownIcon className="size-4" />
				</SelectPrimitive.Icon>
			</SelectPrimitive.Trigger>
			<SelectPrimitive.Portal>
				<SelectPrimitive.Positioner
					sideOffset={4}
					alignItemWithTrigger={false}
					className="z-50 outline-none"
				>
					<SelectPrimitive.Popup className="max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto overflow-x-hidden rounded-xl bg-popover p-1 text-popover-foreground shadow-md outline-none ring-1 ring-foreground/10">
						{options?.map((o) => (
							<Item key={o.value} option={o} />
						))}
						{groups?.map((g) => (
							<SelectPrimitive.Group key={g.label}>
								<SelectPrimitive.GroupLabel
									className="px-2 py-1.5 font-medium text-muted-foreground text-xs"
									style={g.color ? { color: g.color } : undefined}
								>
									{g.label}
								</SelectPrimitive.GroupLabel>
								{g.options.map((o) => (
									<Item key={o.value} option={o} />
								))}
							</SelectPrimitive.Group>
						))}
					</SelectPrimitive.Popup>
				</SelectPrimitive.Positioner>
			</SelectPrimitive.Portal>
		</SelectPrimitive.Root>
	);
}

function Item({ option }: { option: SelectOption }) {
	return (
		<SelectPrimitive.Item
			value={option.value}
			disabled={option.disabled}
			className="relative flex cursor-default select-none items-center gap-2 rounded-md py-1.5 pr-8 pl-2 text-xs outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50"
		>
			<SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
			<SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
				<CheckIcon className="size-4" />
			</SelectPrimitive.ItemIndicator>
		</SelectPrimitive.Item>
	);
}

/** The phone path: a trigger that looks the same, opening a sheet of big rows. */
function SheetSelect({
	value,
	onValueChange,
	options,
	groups,
	placeholder = "Select…",
	disabled,
	id,
	className,
	style,
	sheetTitle,
	...rest
}: SelectProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const items = flatItems(options, groups);
	const current = items.find((i) => i.value === value);
	const searchable = items.length > 8;
	const q = query.trim().toLowerCase();
	const match = (o: SelectOption) => !q || o.label.toLowerCase().includes(q);
	const pick = (v: string) => {
		onValueChange(v);
		setOpen(false);
		setQuery("");
	};
	const row = (o: SelectOption) => (
		<SheetRow
			key={o.value}
			selected={o.value === value}
			disabled={o.disabled}
			onClick={() => pick(o.value)}
		>
			{o.label}
		</SheetRow>
	);
	const visibleGroups = (groups ?? [])
		.map((g) => ({ ...g, options: g.options.filter(match) }))
		.filter((g) => g.options.length > 0);
	const visibleOptions = (options ?? []).filter(match);

	return (
		<>
			<button
				type="button"
				id={id}
				aria-label={rest["aria-label"]}
				aria-haspopup="dialog"
				disabled={disabled}
				style={style}
				onClick={() => setOpen(true)}
				data-popup-open={open ? "" : undefined}
				className={cn(TRIGGER, className)}
			>
				<span className={cn("truncate", !current && "text-muted-foreground")}>
					{current?.label ?? placeholder}
				</span>
				<ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
			</button>
			<Sheet
				open={open}
				onOpenChange={(o) => {
					setOpen(o);
					if (!o) setQuery("");
				}}
				title={sheetTitle ?? rest["aria-label"] ?? placeholder}
			>
				{searchable && (
					<label className="sticky top-0 z-10 -mx-1 flex h-11 items-center gap-2 rounded-xl bg-secondary px-3">
						<SearchIcon className="size-4 shrink-0 text-muted-foreground" />
						<input
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							placeholder="Search"
							enterKeyHint="search"
							className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
						/>
					</label>
				)}
				<div className="flex flex-col">
					{visibleOptions.map(row)}
					{visibleGroups.map((g) => (
						<div key={g.label} className="flex flex-col">
							<p
								className="pt-3 pb-1 font-medium text-muted-foreground text-xs"
								style={g.color ? { color: g.color } : undefined}
							>
								{g.label}
							</p>
							{g.options.map(row)}
						</div>
					))}
					{visibleOptions.length === 0 && visibleGroups.length === 0 && (
						<p className="py-6 text-center text-muted-foreground text-sm">
							Nothing matches “{query}”
						</p>
					)}
				</div>
			</Sheet>
		</>
	);
}
