CREATE TYPE "public"."message_origin" AS ENUM('customer', 'assistant', 'operator', 'phone');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('received', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('text', 'audio', 'image', 'video', 'document', 'sticker', 'location', 'contact', 'other');--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"name" text,
	"last_message_at" timestamp with time zone NOT NULL,
	"last_message_preview" text NOT NULL,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"assistant_paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"wa_message_id" text,
	"origin" "message_origin" NOT NULL,
	"type" "message_type" NOT NULL,
	"text" text,
	"status" "message_status" NOT NULL,
	"error" text,
	"sent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_wa_message_id_unique" UNIQUE("wa_message_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_last_message_at_idx" ON "conversations" USING btree ("last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_conversation_sent_at_idx" ON "messages" USING btree ("conversation_id","sent_at" DESC NULLS LAST,"created_at" DESC NULLS LAST,"id" DESC NULLS LAST);