ALTER TYPE "public"."scheduling_step" ADD VALUE 'choose_service';--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_phone_unique" UNIQUE("phone")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "service" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "customer_name" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "name_asked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduling_sessions" ADD COLUMN "service" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;