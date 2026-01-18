CREATE TABLE `project_embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`project_path` text NOT NULL,
	`file` text NOT NULL,
	`file_path` text NOT NULL,
	`content` text NOT NULL,
	`chunk_index` integer NOT NULL,
	`vec_rowid` integer NOT NULL,
	`embedding` blob NOT NULL,
	`created_at` integer NOT NULL
);
