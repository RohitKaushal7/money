CREATE TABLE `change_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`source` text NOT NULL,
	`token_name` text,
	`procedure` text NOT NULL,
	`input` text NOT NULL,
	`entity` text,
	`entity_id` integer,
	`before` text,
	`after` text,
	`undone_at` integer
);
--> statement-breakpoint
CREATE INDEX `change_log_batch_idx` ON `change_log` (`batch_id`);