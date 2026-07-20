CREATE TABLE `accounts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`parent_account_id` integer,
	`institution` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `investment_valuations_manual` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`investment_id` integer NOT NULL,
	`as_of` text NOT NULL,
	`value` real NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ivm_investment_idx` ON `investment_valuations_manual` (`investment_id`);--> statement-breakpoint
CREATE TABLE `investments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`income_class` text DEFAULT 'income' NOT NULL,
	`valuation_source` text DEFAULT 'manual' NOT NULL,
	`is_passive_income_source` integer DEFAULT false NOT NULL,
	`platform` text,
	`group` text,
	`isin` text,
	`principal` real,
	`annual_rate` real,
	`expected_monthly_interest` real,
	`interest_cadence` text,
	`payout` text DEFAULT 'accrue' NOT NULL,
	`principal_cadence` text,
	`start_date` text,
	`maturity_date` text,
	`action_on_maturity` text,
	`current_value` real,
	`currency` text DEFAULT 'INR' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`terms` text,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recurring_expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'INR' NOT NULL,
	`cadence` text DEFAULT 'monthly' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`start_date` text,
	`end_date` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`match_type` text DEFAULT 'substring' NOT NULL,
	`pattern` text NOT NULL,
	`assign_kind` text NOT NULL,
	`assign_category_key` text NOT NULL,
	`assign_investment_id` integer,
	`min_amount` real,
	`max_amount` real,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rules_priority_idx` ON `rules` (`priority`);--> statement-breakpoint
CREATE TABLE `transaction_manual_splits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`txn_id` text NOT NULL,
	`seq` integer NOT NULL,
	`amount` real NOT NULL,
	`kind` text NOT NULL,
	`category_key` text NOT NULL,
	`investment_id` integer,
	`cashflow_type` text,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tms_txn_idx` ON `transaction_manual_splits` (`txn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tms_txn_seq_uq` ON `transaction_manual_splits` (`txn_id`,`seq`);--> statement-breakpoint
CREATE TABLE `transaction_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`txn_id` text NOT NULL,
	`override_category_key` text,
	`override_kind` text,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_overrides_txn_id_unique` ON `transaction_overrides` (`txn_id`);--> statement-breakpoint
CREATE TABLE `networth_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`as_of` text NOT NULL,
	`value` real NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `networth_logs_as_of_unique` ON `networth_logs` (`as_of`);--> statement-breakpoint
CREATE TABLE `saved_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tax_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fy` text NOT NULL,
	`regime_choice` text,
	`salary_income` real,
	`other_income` real,
	`basic_salary` real,
	`hra_received` real,
	`rent_paid` real,
	`metro` integer,
	`capital_gains` text,
	`deductions` text,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_profiles_fy_unique` ON `tax_profiles` (`fy`);