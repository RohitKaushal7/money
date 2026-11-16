-- "Paid with" becomes free text the owner writes (v1.3.0 had a method enum + a card id; not everyone's
-- cards are in the cards table). Carry over anything already set: the card's name, else the method's label.
ALTER TABLE `recurring_expenses` ADD `paid_with` text;--> statement-breakpoint
UPDATE `recurring_expenses` SET `paid_with` = COALESCE(
	(SELECT `name` FROM `cards` WHERE `cards`.`id` = `recurring_expenses`.`card_id`),
	CASE `payment_method`
		WHEN 'card' THEN 'Credit card'
		WHEN 'upi_autopay' THEN 'UPI AutoPay'
		WHEN 'upi' THEN 'UPI'
		WHEN 'auto_debit' THEN 'Auto-debit'
		WHEN 'debit_card' THEN 'Debit card'
		WHEN 'net_banking' THEN 'Net banking'
		WHEN 'cash' THEN 'Cash'
		WHEN 'other' THEN 'Other'
	END
) WHERE `payment_method` IS NOT NULL OR `card_id` IS NOT NULL;
