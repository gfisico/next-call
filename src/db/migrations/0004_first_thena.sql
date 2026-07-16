CREATE TABLE `session_participants` (
	`session_id` integer NOT NULL,
	`instrument_code` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`session_id`, `instrument_code`),
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_code`) REFERENCES `instruments`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD `host_instrument_code` text REFERENCES instruments(code);--> statement-breakpoint
ALTER TABLE `sessions` ADD `listener_count` integer;--> statement-breakpoint
INSERT OR IGNORE INTO `instruments` (`code`, `label`, `sort_order`) VALUES ('pf','ピアノ',13),('b','ベース',14),('ds','ドラム',15);