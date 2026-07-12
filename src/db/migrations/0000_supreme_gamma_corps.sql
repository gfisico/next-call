CREATE TABLE `genre_tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genre_tags_name_unique` ON `genre_tags` (`name`);--> statement-breakpoint
CREATE TABLE `instruments` (
	`code` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pending_songs` (
	`song_id` integer PRIMARY KEY NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `performance_front_instruments` (
	`performance_id` integer NOT NULL,
	`instrument_code` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`performance_id`, `position`),
	FOREIGN KEY (`performance_id`) REFERENCES `performances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`instrument_code`) REFERENCES `instruments`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `performances` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`song_id` integer NOT NULL,
	`order_index` integer NOT NULL,
	`participated` integer DEFAULT false NOT NULL,
	`instrument` text DEFAULT 'NONE' NOT NULL,
	`called_by_me` integer DEFAULT false NOT NULL,
	`no_chart` integer DEFAULT false NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_performances_session` ON `performances` (`session_id`);--> statement-breakpoint
CREATE TABLE `recommendation_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`request_id` integer NOT NULL,
	`song_id` integer NOT NULL,
	`candidate_type` text DEFAULT 'NORMAL' NOT NULL,
	`score` real NOT NULL,
	`reasons` text DEFAULT '[]' NOT NULL,
	`is_conditional` integer DEFAULT false NOT NULL,
	`condition_label` text,
	`display_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`request_id`) REFERENCES `recommendation_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reco_candidates_request` ON `recommendation_candidates` (`request_id`);--> statement-breakpoint
CREATE TABLE `recommendation_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`requested_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`horns` text NOT NULL,
	`beginner` text NOT NULL,
	`kurobon1_only` integer DEFAULT false NOT NULL,
	`genre_override` text,
	`rare` integer DEFAULT 0 NOT NULL,
	`long_unplayed` integer DEFAULT 0 NOT NULL,
	`safety` integer DEFAULT 0 NOT NULL,
	`mood` integer DEFAULT 0 NOT NULL,
	`ballad` integer DEFAULT 0 NOT NULL,
	`seasonal` integer DEFAULT false NOT NULL,
	`listener_focus` integer DEFAULT false NOT NULL,
	`condition_signature` text NOT NULL,
	`pool_size` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_reco_requests_session` ON `recommendation_requests` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_reco_requests_signature` ON `recommendation_requests` (`condition_signature`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_date` text NOT NULL,
	`venue_id` integer NOT NULL,
	`has_listeners` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`venue_id`) REFERENCES `venues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `song_genre_tags` (
	`song_id` integer NOT NULL,
	`genre_tag_id` integer NOT NULL,
	PRIMARY KEY(`song_id`, `genre_tag_id`),
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`genre_tag_id`) REFERENCES `genre_tags`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `songs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`title_normalized` text NOT NULL,
	`song_key` text,
	`form` text DEFAULT 'OTHER' NOT NULL,
	`composer` text,
	`has_played` integer DEFAULT false NOT NULL,
	`no_chart_ok` integer DEFAULT false NOT NULL,
	`is_standard` integer DEFAULT false NOT NULL,
	`simple_form` integer DEFAULT false NOT NULL,
	`in_kurobon1` integer DEFAULT false NOT NULL,
	`season` text DEFAULT 'ALL' NOT NULL,
	`listener_level` integer DEFAULT 3 NOT NULL,
	`energy_level` integer DEFAULT 3 NOT NULL,
	`needs_review` integer DEFAULT false NOT NULL,
	`note` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `songs_title_unique` ON `songs` (`title`);--> statement-breakpoint
CREATE INDEX `idx_songs_title_normalized` ON `songs` (`title_normalized`);--> statement-breakpoint
CREATE TABLE `venues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`is_home` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `venues_name_unique` ON `venues` (`name`);