ALTER TABLE `tax_profiles` DROP COLUMN `capital_gains_stcg`;--> statement-breakpoint
ALTER TABLE `tax_profiles` DROP COLUMN `capital_gains_ltcg`;--> statement-breakpoint
ALTER TABLE `tax_profiles` ADD `basic_salary` real;--> statement-breakpoint
ALTER TABLE `tax_profiles` ADD `hra_received` real;--> statement-breakpoint
ALTER TABLE `tax_profiles` ADD `metro` integer;--> statement-breakpoint
ALTER TABLE `tax_profiles` ADD `capital_gains` text;
