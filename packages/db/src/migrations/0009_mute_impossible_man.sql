ALTER TABLE `card_extras` ADD `best_for` text;--> statement-breakpoint
ALTER TABLE `card_extras` ADD `avoid_for` text;--> statement-breakpoint
ALTER TABLE `card_extras` ADD `redemption` text;--> statement-breakpoint
ALTER TABLE `card_extras` ADD `sources` text;--> statement-breakpoint
ALTER TABLE `card_reward_rules` ADD `rate_text` text;--> statement-breakpoint
ALTER TABLE `card_reward_rules` ADD `cap_text` text;--> statement-breakpoint
ALTER TABLE `card_reward_rules` ADD `reward_currency` text;--> statement-breakpoint
ALTER TABLE `card_reward_rules` ADD `is_base` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `variant` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `status` text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE `cards` ADD `joining_fee` real;--> statement-breakpoint
ALTER TABLE `cards` ADD `fee_waiver_condition` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `forex_markup_text` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `last_updated` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `terms_effective` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `confidence` text;--> statement-breakpoint
ALTER TABLE `cards` ADD `in_wallet` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `cards` ADD `tier` text;