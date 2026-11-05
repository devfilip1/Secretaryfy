CREATE TABLE "knowledge_sections" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"tagline" text,
	"data" jsonb NOT NULL,
	"position" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_sections_key_unique" UNIQUE("key"),
	CONSTRAINT "knowledge_sections_kind_check" CHECK ("knowledge_sections"."kind" in ('treatment', 'info'))
);
