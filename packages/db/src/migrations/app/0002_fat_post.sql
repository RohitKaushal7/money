CREATE TABLE `import_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`filename` text NOT NULL,
	`format_id` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_files_filename_unique` ON `import_files` (`filename`);--> statement-breakpoint
CREATE TABLE `statement_formats` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`builtin` text,
	`name` text NOT NULL,
	`system` integer DEFAULT false NOT NULL,
	`header_signature` text NOT NULL,
	`account_id` integer NOT NULL,
	`date_col` text NOT NULL,
	`date_fmt` text NOT NULL,
	`amount_mode` text NOT NULL,
	`amount_col` text,
	`sign_convention` text,
	`debit_col` text,
	`credit_col` text,
	`indicator_col` text,
	`credit_token` text,
	`narration_col` text NOT NULL,
	`ref_col` text,
	`balance_col` text,
	`value_date_col` text,
	`anchor` text NOT NULL,
	`quirks` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `statement_formats_builtin_unique` ON `statement_formats` (`builtin`);--> statement-breakpoint
CREATE UNIQUE INDEX `statement_formats_header_signature_unique` ON `statement_formats` (`header_signature`);