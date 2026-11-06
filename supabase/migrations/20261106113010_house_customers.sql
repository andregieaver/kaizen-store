CREATE TABLE "commerce"."house_customer_links" (
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"account_id" uuid,
	"request_id" uuid,
	"deal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "house_customer_links_store_id_customer_id_pk" PRIMARY KEY("store_id","customer_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."deals" DROP CONSTRAINT "deals_closed_via";--> statement-breakpoint
ALTER TABLE "commerce"."house_customer_links" ADD CONSTRAINT "house_customer_links_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."house_customer_links" ADD CONSTRAINT "house_customer_links_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."house_customer_links" ADD CONSTRAINT "house_customer_links_request_id_access_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "commerce"."access_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."house_customer_links" ADD CONSTRAINT "house_customer_links_customer_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "commerce"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."house_customer_links" ADD CONSTRAINT "house_customer_links_deal_fk" FOREIGN KEY ("store_id","deal_id") REFERENCES "commerce"."deals"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "house_customer_links_account_key" ON "commerce"."house_customer_links" USING btree ("account_id") WHERE "commerce"."house_customer_links"."account_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "house_customer_links_request_key" ON "commerce"."house_customer_links" USING btree ("request_id") WHERE "commerce"."house_customer_links"."request_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "house_customer_links_deal_key" ON "commerce"."house_customer_links" USING btree ("store_id","deal_id") WHERE "commerce"."house_customer_links"."deal_id" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."deals" ADD CONSTRAINT "deals_closed_via" CHECK ("commerce"."deals"."closed_via" is null or "commerce"."deals"."closed_via" in ('person', 'order', 'work_invoice', 'platform'));