ALTER TABLE `categories` ADD `color_slot` integer;--> statement-breakpoint
-- Seed the categories that actually dominate spend. Picked from the data, not by taste: over 24 months
-- these are the only expense categories that ever entered a month's top five. Everything else stays NULL
-- and claims a free slot at render time. Guarded on NULL so re-running can never stomp a user's own pick.
UPDATE `categories` SET `color_slot` = 1 WHERE `key` = 'card_bill' AND `color_slot` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color_slot` = 2 WHERE `key` = 'upi_merchant' AND `color_slot` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color_slot` = 3 WHERE `key` = 'rent' AND `color_slot` IS NULL;--> statement-breakpoint
UPDATE `categories` SET `color_slot` = 4 WHERE `key` = 'tax_paid' AND `color_slot` IS NULL;
