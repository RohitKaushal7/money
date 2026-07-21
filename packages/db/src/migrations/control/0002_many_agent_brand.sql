ALTER TABLE `user` ADD `last_login_at` integer;--> statement-breakpoint
-- Backfill from sessions that still exist, so the column is right on day one rather than blank until
-- everyone happens to sign in again. Sessions are deleted on sign-out, so this recovers what's left and
-- no more; anyone with none stays NULL and reads as "never" until their next login stamps it.
UPDATE `user`
SET `last_login_at` = (
	SELECT MAX(s.`created_at`) FROM `session` s WHERE s.`user_id` = `user`.`id`
)
WHERE EXISTS (SELECT 1 FROM `session` s WHERE s.`user_id` = `user`.`id`);
