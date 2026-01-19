CREATE EXTENSION vector;

CREATE TABLE "project_embeddings" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_path" text NOT NULL,
	"file" text NOT NULL,
	"file_path" text NOT NULL,
	"content" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "embeddingIndex" ON "project_embeddings" USING hnsw ("embedding" vector_cosine_ops);
