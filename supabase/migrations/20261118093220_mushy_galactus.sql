CREATE TABLE "commerce"."privacy_officers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"store_id" uuid,
	"account_id" uuid,
	"name" text,
	"email" text,
	"phone" text,
	"firm" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_officers_who" CHECK ("commerce"."privacy_officers"."account_id" is not null or (coalesce(length(trim("commerce"."privacy_officers"."name")), 0) > 0 and coalesce("commerce"."privacy_officers"."email", '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
	CONSTRAINT "privacy_officers_sizes" CHECK (coalesce(char_length("commerce"."privacy_officers"."name"), 0) <= 200 and coalesce(char_length("commerce"."privacy_officers"."email"), 0) <= 254 and coalesce(char_length("commerce"."privacy_officers"."phone"), 0) <= 40 and coalesce(char_length("commerce"."privacy_officers"."firm"), 0) <= 200)
);
--> statement-breakpoint
ALTER TABLE "commerce"."privacy_officers" ADD CONSTRAINT "privacy_officers_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "commerce"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."privacy_officers" ADD CONSTRAINT "privacy_officers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."privacy_officers" ADD CONSTRAINT "privacy_officers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."privacy_officers" ADD CONSTRAINT "privacy_officers_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_officers_account_default" ON "commerce"."privacy_officers" USING btree ("organisation_id") WHERE "commerce"."privacy_officers"."store_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "privacy_officers_store" ON "commerce"."privacy_officers" USING btree ("store_id") WHERE "commerce"."privacy_officers"."store_id" is not null;