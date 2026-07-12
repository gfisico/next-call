ALTER TABLE `recommendation_requests` ADD `seed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_reco_requests_requested_at` ON `recommendation_requests` (`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_reco_requests_signature_requested` ON `recommendation_requests` (`condition_signature`,`requested_at`);--> statement-breakpoint
CREATE INDEX `idx_performances_song` ON `performances` (`song_id`);--> statement-breakpoint
CREATE INDEX `idx_performances_session_order` ON `performances` (`session_id`,`order_index`);