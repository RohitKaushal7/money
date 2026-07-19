CREATE TABLE `recurring_expenses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text,
	`amount` real NOT NULL,
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
DROP INDEX "account_userId_idx";--> statement-breakpoint
DROP INDEX "session_token_unique";--> statement-breakpoint
DROP INDEX "session_userId_idx";--> statement-breakpoint
DROP INDEX "user_email_unique";--> statement-breakpoint
DROP INDEX "verification_identifier_idx";--> statement-breakpoint
DROP INDEX "crr_card_idx";--> statement-breakpoint
DROP INDEX "cards_name_unique";--> statement-breakpoint
DROP INDEX "ivm_investment_idx";--> statement-breakpoint
DROP INDEX "rules_priority_idx";--> statement-breakpoint
DROP INDEX "tms_txn_idx";--> statement-breakpoint
DROP INDEX "tms_txn_seq_uq";--> statement-breakpoint
DROP INDEX "transaction_overrides_txn_id_unique";--> statement-breakpoint
DROP INDEX "tax_profiles_fy_unique";--> statement-breakpoint
ALTER TABLE `investments` ALTER COLUMN "income_class" TO "income_class" text NOT NULL DEFAULT 'income';--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE INDEX `crr_card_idx` ON `card_reward_rules` (`card_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cards_name_unique` ON `cards` (`name`);--> statement-breakpoint
CREATE INDEX `ivm_investment_idx` ON `investment_valuations_manual` (`investment_id`);--> statement-breakpoint
CREATE INDEX `rules_priority_idx` ON `rules` (`priority`);--> statement-breakpoint
CREATE INDEX `tms_txn_idx` ON `transaction_manual_splits` (`txn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tms_txn_seq_uq` ON `transaction_manual_splits` (`txn_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `transaction_overrides_txn_id_unique` ON `transaction_overrides` (`txn_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tax_profiles_fy_unique` ON `tax_profiles` (`fy`);--> statement-breakpoint
ALTER TABLE `investments` ADD `platform` text;--> statement-breakpoint
ALTER TABLE `investments` ADD `principal` real;--> statement-breakpoint
ALTER TABLE `investments` ADD `annual_rate` real;--> statement-breakpoint
ALTER TABLE `investments` ADD `expected_monthly_interest` real;--> statement-breakpoint
ALTER TABLE `investments` ADD `interest_cadence` text;--> statement-breakpoint
ALTER TABLE `investments` ADD `principal_cadence` text;--> statement-breakpoint
ALTER TABLE `investments` ADD `start_date` text;--> statement-breakpoint
ALTER TABLE `investments` ADD `maturity_date` text;--> statement-breakpoint
ALTER TABLE `investments` ADD `action_on_maturity` text;--> statement-breakpoint
ALTER TABLE `investments` ADD `current_value` real;--> statement-breakpoint
ALTER TABLE `investments` ADD `status` text DEFAULT 'active' NOT NULL;