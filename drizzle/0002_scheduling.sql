CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."calendar_status" AS ENUM('connected', 'needs_reauth');--> statement-breakpoint
CREATE TYPE "public"."scheduling_step" AS ENUM('choose_day', 'choose_slot', 'ask_name', 'confirm_booking', 'offer_reschedule', 'confirm_cancel', 'confirm_reschedule');--> statement-breakpoint
ALTER TYPE "public"."message_origin" ADD VALUE 'system';--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"google_event_id" text NOT NULL,
	"calendar_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"customer_name" text NOT NULL,
	"status" "appointment_status" DEFAULT 'booked' NOT NULL,
	"cancelled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_google_event_id_unique" UNIQUE("google_event_id")
);
--> statement-breakpoint
CREATE TABLE "calendar_connection" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"email" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text NOT NULL,
	"calendar_id" text NOT NULL,
	"calendar_name" text NOT NULL,
	"time_zone" text NOT NULL,
	"status" "calendar_status" DEFAULT 'connected' NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_connection_single_row" CHECK ("calendar_connection"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "scheduling_rules" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"weekly_hours" jsonb NOT NULL,
	"slot_minutes" integer NOT NULL,
	"min_notice_minutes" integer NOT NULL,
	"max_days_ahead" integer NOT NULL,
	"cancel_notice_minutes" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scheduling_rules_single_row" CHECK ("scheduling_rules"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "scheduling_sessions" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"flow" text NOT NULL,
	"step" "scheduling_step" NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"selected_start" timestamp with time zone,
	"customer_name" text,
	"appointment_id" uuid,
	"misunderstood_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "needs_attention" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_sessions" ADD CONSTRAINT "scheduling_sessions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_sessions" ADD CONSTRAINT "scheduling_sessions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_booked_start_uq" ON "appointments" USING btree ("calendar_id","starts_at") WHERE "appointments"."status" = 'booked';--> statement-breakpoint
CREATE INDEX "appointments_conversation_idx" ON "appointments" USING btree ("conversation_id","starts_at" DESC NULLS LAST);