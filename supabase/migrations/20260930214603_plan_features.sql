CREATE TABLE "commerce"."plan_feature_grants" (
	"feature_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	CONSTRAINT "plan_feature_grants_feature_id_plan_id_pk" PRIMARY KEY("feature_id","plan_id")
);
--> statement-breakpoint
CREATE TABLE "commerce"."plan_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "plan_features_name" CHECK (length(trim("commerce"."plan_features"."name")) between 1 and 80),
	CONSTRAINT "plan_features_category" CHECK (length(trim("commerce"."plan_features"."category")) between 1 and 60),
	CONSTRAINT "plan_features_description" CHECK (length("commerce"."plan_features"."description") <= 300)
);
--> statement-breakpoint
ALTER TABLE "commerce"."plan_feature_grants" ADD CONSTRAINT "plan_feature_grants_feature_id_plan_features_id_fk" FOREIGN KEY ("feature_id") REFERENCES "commerce"."plan_features"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plan_feature_grants" ADD CONSTRAINT "plan_feature_grants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "commerce"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."plan_features" ADD CONSTRAINT "plan_features_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_feature_grants_plan_idx" ON "commerce"."plan_feature_grants" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "plan_features_updated_by_idx" ON "commerce"."plan_features" USING btree ("updated_by");