CREATE TABLE "commerce"."form_view_counts" (
	"form_id" uuid NOT NULL,
	"store_id" uuid,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "form_view_counts_form_id_day_pk" PRIMARY KEY("form_id","day"),
	CONSTRAINT "form_view_counts_views" CHECK ("commerce"."form_view_counts"."views" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."form_view_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."form_view_counts" ADD CONSTRAINT "form_view_counts_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "commerce"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."form_view_counts" ADD CONSTRAINT "form_view_counts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_view_counts_store_idx" ON "commerce"."form_view_counts" USING btree ("store_id","day");