CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`hypothesis_ids` text DEFAULT '[]' NOT NULL,
	`title` text NOT NULL,
	`objective` text NOT NULL,
	`protocol` text NOT NULL,
	`baselines` text DEFAULT '' NOT NULL,
	`dataset` text DEFAULT '' NOT NULL,
	`required_runs` integer DEFAULT 1 NOT NULL,
	`seeds` text DEFAULT '[]' NOT NULL,
	`environment_notes` text DEFAULT '' NOT NULL,
	`predictions` text DEFAULT '[]' NOT NULL,
	`results_path` text NOT NULL,
	`results_schema` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`locked_at` integer,
	`lock_hash` text,
	`lock_repo_head` text,
	`verdict` text,
	`verdict_evidence` text,
	`interpretation` text,
	`interpretation_concern` integer DEFAULT false NOT NULL,
	`override_verdict` text,
	`override_reason` text,
	`override_at` integer,
	`replication_of` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `experiments_family_idx` ON `experiments` (`family_id`);
--> statement-breakpoint
CREATE INDEX `experiments_status_idx` ON `experiments` (`status`);
