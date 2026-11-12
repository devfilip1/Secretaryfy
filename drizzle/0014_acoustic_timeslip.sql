ALTER TABLE "clinic_settings" ADD COLUMN "offer_assessment" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "offer_follow_up" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "assessment_minutes" integer;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD COLUMN "follow_up_minutes" integer;--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD CONSTRAINT "clinic_settings_assessment_minutes" CHECK ("clinic_settings"."assessment_minutes" is null or ("clinic_settings"."assessment_minutes" between 15 and 240 and "clinic_settings"."assessment_minutes" % 5 = 0));--> statement-breakpoint
ALTER TABLE "clinic_settings" ADD CONSTRAINT "clinic_settings_follow_up_minutes" CHECK ("clinic_settings"."follow_up_minutes" is null or ("clinic_settings"."follow_up_minutes" between 15 and 240 and "clinic_settings"."follow_up_minutes" % 5 = 0));