"use client";

import { Select as SelectPrimitive } from "@base-ui/react/select";
import { cn } from "@money/ui/lib/utils";
import { CheckIcon, ChevronDownIcon } from "lucide-react";
import type * as React from "react";

/**
 * Themed Select built on `@base-ui/react` — replaces native `<select>` (which ignores the app theme and
 * renders the OS-default dropdown). Convenience `options` / `groups` API so a native select converts ~1:1:
 *
 *   <Select value={x} onValueChange={setX} options={[{ value, label }]} />
 *   <Select value={x} onValueChange={setX} groups={[{ label, options }]} placeholder="— pick —" />
 */

export type SelectOption = { value: string; label: string; disabled?: boolean };
export type SelectOptionGroup = { label: string; options: SelectOption[] };

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
};

function flatItems(
	options?: SelectOption[],
	groups?: SelectOptionGroup[],
): { value: string; label: string }[] {
	return [...(options ?? []), ...(groups ?? []).flatMap((g) => g.options)].map(
		(o) => ({ value: o.value, label: o.label }),
	);
}

export function Select({
	value,
	onValueChange,
	options,
	groups,
	placeholder = "Select…",
	disabled,
	id,
	className,
	style,
	...rest
}: SelectProps) {
	return (
		<SelectPrimitive.Root
			items={flatItems(options, groups)}
			value={value}
			onValueChange={(v) => onValueChange(v as string)}
			disabled={disabled}
		>
			<SelectPrimitive.Trigger
				id={id}
				aria-label={rest["aria-label"]}
				style={style}
				className={cn(
					"flex h-8 w-full items-center justify-between gap-2 rounded-none border border-input bg-transparent px-2.5 text-foreground text-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 data-popup-open:border-ring dark:bg-input/30",
					className,
				)}
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
					<SelectPrimitive.Popup className="max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto overflow-x-hidden rounded-none bg-popover p-1 text-popover-foreground shadow-md outline-none ring-1 ring-foreground/10">
						{options?.map((o) => (
							<Item key={o.value} option={o} />
						))}
						{groups?.map((g) => (
							<SelectPrimitive.Group key={g.label}>
								<SelectPrimitive.GroupLabel className="px-2 py-1.5 text-muted-foreground text-xs">
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
			className="relative flex cursor-default select-none items-center gap-2 rounded-none py-1.5 pr-8 pl-2 text-xs outline-none data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50"
		>
			<SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
			<SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
				<CheckIcon className="size-4" />
			</SelectPrimitive.ItemIndicator>
		</SelectPrimitive.Item>
	);
}
