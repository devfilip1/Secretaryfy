CREATE TABLE "clinic_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"assistant_name" text,
	"kind" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clinic_settings_single_row" CHECK ("clinic_settings"."id" = 1)
);
