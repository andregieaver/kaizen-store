CREATE TABLE "commerce"."kaizen_life_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"life_user_id" uuid NOT NULL,
	"how" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlinked_at" timestamp with time zone,
	"unlinked_from" text,
	CONSTRAINT "kaizen_life_accounts_how" CHECK ("commerce"."kaizen_life_accounts"."how" in ('identity', 'email', 'backfill')),
	CONSTRAINT "kaizen_life_accounts_unlinked" CHECK (("commerce"."kaizen_life_accounts"."unlinked_at" is null) = ("commerce"."kaizen_life_accounts"."unlinked_from" is null) and coalesce("commerce"."kaizen_life_accounts"."unlinked_from" in ('flow', 'life'), true))
);
--> statement-breakpoint
CREATE TABLE "commerce"."kaizen_life_jtis" (
	"jti" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "kaizen_life_jtis_jti" CHECK (length("commerce"."kaizen_life_jtis"."jti") between 16 and 100)
);
--> statement-breakpoint
ALTER TABLE "commerce"."kaizen_life_accounts" ADD CONSTRAINT "kaizen_life_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kaizen_life_accounts_pair_key" ON "commerce"."kaizen_life_accounts" USING btree ("account_id","life_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kaizen_life_accounts_account_live_key" ON "commerce"."kaizen_life_accounts" USING btree ("account_id") WHERE "commerce"."kaizen_life_accounts"."unlinked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "kaizen_life_accounts_life_live_key" ON "commerce"."kaizen_life_accounts" USING btree ("life_user_id") WHERE "commerce"."kaizen_life_accounts"."unlinked_at" is null;--> statement-breakpoint
CREATE INDEX "kaizen_life_jtis_expires_idx" ON "commerce"."kaizen_life_jtis" USING btree ("expires_at");