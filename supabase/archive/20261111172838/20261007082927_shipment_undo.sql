ALTER TABLE "commerce"."shipments" ADD COLUMN "undone_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD COLUMN "undone_by" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD COLUMN "undo_reason" text;--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD CONSTRAINT "shipments_undone_by_accounts_id_fk" FOREIGN KEY ("undone_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shipments_undone_by_idx" ON "commerce"."shipments" USING btree ("undone_by");--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD CONSTRAINT "shipments_undo_reason" CHECK ("commerce"."shipments"."undo_reason" is null or ("commerce"."shipments"."undone_at" is not null and char_length("commerce"."shipments"."undo_reason") <= 200));--> statement-breakpoint
ALTER TABLE "commerce"."shipments" ADD CONSTRAINT "shipments_undone_by" CHECK ("commerce"."shipments"."undone_by" is null or "commerce"."shipments"."undone_at" is not null);