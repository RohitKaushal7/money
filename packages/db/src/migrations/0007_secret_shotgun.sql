CREATE TABLE `currencies` (
	`code` text PRIMARY KEY NOT NULL,
	`symbol` text NOT NULL,
	`rate_to_inr` real DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `investments` ADD `currency` text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `currency` text DEFAULT 'INR' NOT NULL;