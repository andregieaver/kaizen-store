CREATE TABLE "commerce"."organisation_members" (
	"organisation_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisation_members_organisation_id_account_id_pk" PRIMARY KEY("organisation_id","account_id"),
	CONSTRAINT "organisation_members_role" CHECK ("commerce"."organisation_members"."role" in ('owner', 'member'))
);
--> statement-breakpoint
CREATE TABLE "commerce"."organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"platform" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_name_present" CHECK (length(trim("commerce"."organisations"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD COLUMN "organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_members" ADD CONSTRAINT "organisation_members_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "commerce"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."organisation_members" ADD CONSTRAINT "organisation_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organisation_members_account_idx" ON "commerce"."organisation_members" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_one_platform" ON "commerce"."organisations" USING btree ("platform") WHERE "commerce"."organisations"."platform";--> statement-breakpoint
ALTER TABLE "commerce"."stores" ADD CONSTRAINT "stores_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "commerce"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stores_organisation_idx" ON "commerce"."stores" USING btree ("organisation_id");