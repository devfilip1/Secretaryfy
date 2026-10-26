CREATE TYPE "public"."reminder_status" AS ENUM('pending', 'sent', 'not_sent', 'not_needed');--> statement-breakpoint
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_conversation_id_conversations_id_fk";
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "phone" text;--> statement-breakpoint
-- Os agendamentos existentes recebem o telefone da conversa em que nasceram (specs/006 R1)
UPDATE "appointments" AS a SET "phone" = c."phone" FROM "conversations" AS c WHERE c."id" = a."conversation_id";--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "origin" text DEFAULT 'assistant' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_status" "reminder_status" DEFAULT 'not_needed' NOT NULL;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_reason" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "reminder_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "confirmed_by" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_phone_idx" ON "appointments" USING btree ("phone","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_reminder_idx" ON "appointments" USING btree ("reminder_status","starts_at");