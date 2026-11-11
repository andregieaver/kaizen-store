CREATE TABLE "commerce"."signup_incentives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"discount_id" uuid NOT NULL,
	"email" text NOT NULL,
	"code_item_id" uuid,
	"form_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signup_incentives_once" UNIQUE("store_id","discount_id","email"),
	CONSTRAINT "signup_incentives_email" CHECK ("commerce"."signup_incentives"."email" = lower("commerce"."signup_incentives"."email") and char_length("commerce"."signup_incentives"."email") between 3 and 254),
	CONSTRAINT "signup_incentives_form" CHECK (char_length("commerce"."signup_incentives"."form_id") between 1 and 64)
);
--> statement-breakpoint
ALTER TABLE "commerce"."signup_incentives" ADD CONSTRAINT "signup_incentives_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."signup_incentives" ADD CONSTRAINT "signup_incentives_discount_fk" FOREIGN KEY ("store_id","discount_id") REFERENCES "commerce"."discount_codes"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."signup_incentives" ADD CONSTRAINT "signup_incentives_item_fk" FOREIGN KEY ("store_id","code_item_id") REFERENCES "commerce"."discount_code_items"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signup_incentives_email_idx" ON "commerce"."signup_incentives" USING btree ("store_id","email");--> statement-breakpoint
CREATE INDEX "signup_incentives_item_idx" ON "commerce"."signup_incentives" USING btree ("store_id","code_item_id");