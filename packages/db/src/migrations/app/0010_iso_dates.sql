-- One stored date format: `YYYY-MM-DD` (the web shows and takes DD-MM-YYYY; the API now refuses
-- anything else). Holdings entered before that check carry day-first dates — `31/07/2027`,
-- `25-02-2027`, `7.6.2027` — which sort wrong as text and read ambiguously. Rewrite them, day-first
-- always (this app is Indian: `07/06/2027` is 7 June, as the app already read it).
--
-- Only real calendar days are rewritten (`date()` round-trips them unchanged); anything else — a
-- two-digit year, free text — is left as it was, and the app keeps treating it as no date. An empty
-- string is how the old recurring form cleared a date; it becomes NULL, which is what it meant.
UPDATE `investments` SET `start_date` = NULL WHERE trim(`start_date`) = '';
--> statement-breakpoint
UPDATE `investments` SET `start_date` = q.iso
FROM (
	SELECT id, printf('%04d-%02d-%02d', y, m, d) AS iso FROM (
		SELECT id, d,
			CAST(substr(r, 1, instr(r, '-') - 1) AS INTEGER) AS m,
			CAST(substr(r, instr(r, '-') + 1) AS INTEGER) AS y
		FROM (
			SELECT id,
				CAST(substr(v, 1, instr(v, '-') - 1) AS INTEGER) AS d,
				substr(v, instr(v, '-') + 1) AS r
			FROM (SELECT id, replace(replace(trim(`start_date`), '/', '-'), '.', '-') AS v FROM `investments`)
			WHERE v GLOB '[0-9]-[0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9][0-9]-[0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]'
		)
	)
) AS q
WHERE `investments`.`id` = q.id AND date(q.iso) = q.iso;
--> statement-breakpoint
UPDATE `investments` SET `maturity_date` = NULL WHERE trim(`maturity_date`) = '';
--> statement-breakpoint
UPDATE `investments` SET `maturity_date` = q.iso
FROM (
	SELECT id, printf('%04d-%02d-%02d', y, m, d) AS iso FROM (
		SELECT id, d,
			CAST(substr(r, 1, instr(r, '-') - 1) AS INTEGER) AS m,
			CAST(substr(r, instr(r, '-') + 1) AS INTEGER) AS y
		FROM (
			SELECT id,
				CAST(substr(v, 1, instr(v, '-') - 1) AS INTEGER) AS d,
				substr(v, instr(v, '-') + 1) AS r
			FROM (SELECT id, replace(replace(trim(`maturity_date`), '/', '-'), '.', '-') AS v FROM `investments`)
			WHERE v GLOB '[0-9]-[0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9][0-9]-[0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]'
		)
	)
) AS q
WHERE `investments`.`id` = q.id AND date(q.iso) = q.iso;
--> statement-breakpoint
UPDATE `recurring_expenses` SET `start_date` = NULL WHERE trim(`start_date`) = '';
--> statement-breakpoint
UPDATE `recurring_expenses` SET `start_date` = q.iso
FROM (
	SELECT id, printf('%04d-%02d-%02d', y, m, d) AS iso FROM (
		SELECT id, d,
			CAST(substr(r, 1, instr(r, '-') - 1) AS INTEGER) AS m,
			CAST(substr(r, instr(r, '-') + 1) AS INTEGER) AS y
		FROM (
			SELECT id,
				CAST(substr(v, 1, instr(v, '-') - 1) AS INTEGER) AS d,
				substr(v, instr(v, '-') + 1) AS r
			FROM (SELECT id, replace(replace(trim(`start_date`), '/', '-'), '.', '-') AS v FROM `recurring_expenses`)
			WHERE v GLOB '[0-9]-[0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9][0-9]-[0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]'
		)
	)
) AS q
WHERE `recurring_expenses`.`id` = q.id AND date(q.iso) = q.iso;
--> statement-breakpoint
UPDATE `recurring_expenses` SET `end_date` = NULL WHERE trim(`end_date`) = '';
--> statement-breakpoint
UPDATE `recurring_expenses` SET `end_date` = q.iso
FROM (
	SELECT id, printf('%04d-%02d-%02d', y, m, d) AS iso FROM (
		SELECT id, d,
			CAST(substr(r, 1, instr(r, '-') - 1) AS INTEGER) AS m,
			CAST(substr(r, instr(r, '-') + 1) AS INTEGER) AS y
		FROM (
			SELECT id,
				CAST(substr(v, 1, instr(v, '-') - 1) AS INTEGER) AS d,
				substr(v, instr(v, '-') + 1) AS r
			FROM (SELECT id, replace(replace(trim(`end_date`), '/', '-'), '.', '-') AS v FROM `recurring_expenses`)
			WHERE v GLOB '[0-9]-[0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9][0-9]-[0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]'
				OR v GLOB '[0-9][0-9]-[0-9][0-9]-[0-9][0-9][0-9][0-9]'
		)
	)
) AS q
WHERE `recurring_expenses`.`id` = q.id AND date(q.iso) = q.iso;
