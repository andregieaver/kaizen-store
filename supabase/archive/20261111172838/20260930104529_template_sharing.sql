CREATE TABLE "commerce"."template_activations" (
	"store_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"active" boolean NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid,
	CONSTRAINT "template_activations_store_id_part_id_pk" PRIMARY KEY("store_id","part_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD COLUMN "sharing" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD COLUMN "hidden_by" uuid;--> statement-breakpoint
-- Templates (D125): Kaizen's own saved parts (no store) fold into the marketplace, published by Kaizen.
UPDATE "commerce"."saved_parts" SET "sharing" = 'marketplace' WHERE "store_id" IS NULL;--> statement-breakpoint
ALTER TABLE "commerce"."template_activations" ADD CONSTRAINT "template_activations_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."template_activations" ADD CONSTRAINT "template_activations_part_id_saved_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "commerce"."saved_parts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."template_activations" ADD CONSTRAINT "template_activations_changed_by_accounts_id_fk" FOREIGN KEY ("changed_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "template_activations_part_idx" ON "commerce"."template_activations" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "template_activations_changed_by_idx" ON "commerce"."template_activations" USING btree ("changed_by");--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD CONSTRAINT "saved_parts_hidden_by_accounts_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_parts_hidden_by_idx" ON "commerce"."saved_parts" USING btree ("hidden_by");--> statement-breakpoint
CREATE INDEX "saved_parts_shared_idx" ON "commerce"."saved_parts" USING btree ("sharing","updated_at") WHERE "commerce"."saved_parts"."sharing" <> 'private';--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD CONSTRAINT "saved_parts_sharing" CHECK ("commerce"."saved_parts"."sharing" in ('private', 'stores', 'marketplace'));--> statement-breakpoint
ALTER TABLE "commerce"."saved_parts" ADD CONSTRAINT "saved_parts_kaizen_sharing" CHECK ("commerce"."saved_parts"."store_id" is not null or "commerce"."saved_parts"."sharing" = 'marketplace');--> statement-breakpoint
-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.template_activations ENABLE ROW LEVEL SECURITY;
