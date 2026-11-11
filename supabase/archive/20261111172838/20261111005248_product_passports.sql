CREATE TABLE "commerce"."product_passports" (
	"id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"published_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_passports_store_id_product_id_pk" PRIMARY KEY("store_id","product_id"),
	CONSTRAINT "product_passports_data" CHECK (jsonb_typeof("commerce"."product_passports"."data") = 'object' and pg_column_size("commerce"."product_passports"."data") < 65536)
);
--> statement-breakpoint
ALTER TABLE "commerce"."product_passports" ADD CONSTRAINT "product_passports_updated_by_accounts_id_fk" FOREIGN KEY ("updated_by") REFERENCES "commerce"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_passports" ADD CONSTRAINT "product_passports_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_passports_id_key" ON "commerce"."product_passports" USING btree ("id");--> statement-breakpoint
CREATE INDEX "product_passports_updated_by_idx" ON "commerce"."product_passports" USING btree ("updated_by");--> statement-breakpoint
ALTER TABLE "commerce"."product_passports" ENABLE ROW LEVEL SECURITY;
