ALTER TABLE `recurring_expenses` ADD `payment_method` text;--> statement-breakpoint
ALTER TABLE `recurring_expenses` ADD `card_id` integer REFERENCES cards(id) ON DELETE SET NULL;