CREATE TABLE "commerce"."extension_offers" (
	"organisation_id" uuid NOT NULL,
	"extension_id" text NOT NULL,
	"offered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"declined_at" timestamp with time zone,
	CONSTRAINT "extension_offers_organisation_id_extension_id_pk" PRIMARY KEY("organisation_id","extension_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."extension_offers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commerce"."extension_offers" ADD CONSTRAINT "extension_offers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "commerce"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."extension_offers" ADD CONSTRAINT "extension_offers_extension_id_extensions_id_fk" FOREIGN KEY ("extension_id") REFERENCES "commerce"."extensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extension_offers_extension_idx" ON "commerce"."extension_offers" USING btree ("extension_id");