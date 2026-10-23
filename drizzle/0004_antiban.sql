ALTER TYPE "public"."message_status" ADD VALUE 'blocked';--> statement-breakpoint
CREATE TABLE "connected_numbers" (
	"number" text PRIMARY KEY NOT NULL,
	"first_connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_connected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_preferences" (
	"phone" text PRIMARY KEY NOT NULL,
	"opted_out_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "protection_state" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"paused_until" timestamp with time zone,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "protection_state_single_row" CHECK ("protection_state"."id" = 1)
);
--> statement-breakpoint
CREATE INDEX "messages_outgoing_sent_at_idx" ON "messages" USING btree ("sent_at" DESC NULLS LAST) WHERE "messages"."origin" in ('assistant', 'operator') and "messages"."status" = 'sent';