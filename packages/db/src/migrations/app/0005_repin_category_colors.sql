-- Re-point the four seeded pins. 0004 seeded them blue/green/magenta/yellow; slot 3 has since become a
-- brick red (magenta could not survive the all-pairs colour-blindness check once slots were pinned to
-- categories), and the assignment itself changed:
--
--   card_bill  → 3 red     the biggest bar, and a saturated blue at that size dominates the page
--   upi_merchant → 4 yellow
--   rent       → 5 purple
--   tax_paid   → 1 blue
--
-- Green (slot 2) is deliberately left unpinned: it means "covered" everywhere else in this app, and
-- reading as "good" inside an all-expenses stack is worse than leaving a slot spare.
--
-- Unconditional, unlike 0004's IS NULL guard: this has to move rows 0004 already wrote. It runs once, so a
-- pin you set afterwards is safe.
UPDATE `categories` SET `color_slot` = 3 WHERE `key` = 'card_bill';--> statement-breakpoint
UPDATE `categories` SET `color_slot` = 4 WHERE `key` = 'upi_merchant';--> statement-breakpoint
UPDATE `categories` SET `color_slot` = 5 WHERE `key` = 'rent';--> statement-breakpoint
UPDATE `categories` SET `color_slot` = 1 WHERE `key` = 'tax_paid';
