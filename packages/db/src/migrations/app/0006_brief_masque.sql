CREATE TABLE `card_assignments` (
	`purpose` text PRIMARY KEY NOT NULL,
	`card_id` integer NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `card_extras` (
	`card_id` integer PRIMARY KEY NOT NULL,
	`milestones` text,
	`gotchas` text,
	`lounge` text,
	`exclusions` text,
	`best_for` text,
	`avoid_for` text,
	`redemption` text,
	`sources` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `card_reward_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`category` text NOT NULL,
	`rate` real,
	`cap` real,
	`condition` text,
	`reward_type` text,
	`point_value` real,
	`is_exclusion` integer DEFAULT false NOT NULL,
	`rate_text` text,
	`cap_text` text,
	`reward_currency` text,
	`is_base` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `crr_card_idx` ON `card_reward_rules` (`card_id`);--> statement-breakpoint
CREATE TABLE `card_spend_profile` (
	`category` text PRIMARY KEY NOT NULL,
	`monthly_amount` real NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`network` text,
	`issuer` text,
	`is_ltf` integer DEFAULT false NOT NULL,
	`annual_fee` real,
	`fee_waiver_spend` real,
	`forex_markup` real,
	`vintage_year` integer,
	`active` integer DEFAULT true NOT NULL,
	`variant` text,
	`status` text DEFAULT 'active',
	`joining_fee` real,
	`fee_waiver_condition` text,
	`forex_markup_text` text,
	`last_updated` text,
	`terms_effective` text,
	`confidence` text,
	`in_wallet` integer DEFAULT false NOT NULL,
	`tier` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_name_unique` ON `cards` (`name`);