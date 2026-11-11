CREATE TABLE "commerce"."order_discount_codes" (
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"code" text NOT NULL,
	"discount_id" uuid,
	"item_id" uuid,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_discount_codes_order_id_position_pk" PRIMARY KEY("order_id","position"),
	CONSTRAINT "order_discount_codes_position" CHECK ("commerce"."order_discount_codes"."position" between 1 and 5),
	CONSTRAINT "order_discount_codes_amount" CHECK ("commerce"."order_discount_codes"."amount_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commerce"."carts" ADD COLUMN "more_codes" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD COLUMN "combines_with" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce"."orders" ADD COLUMN "entered_codes" text[];--> statement-breakpoint
ALTER TABLE "commerce"."order_discount_codes" ADD CONSTRAINT "order_discount_codes_order_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "commerce"."orders"("store_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_discount_codes_discount_idx" ON "commerce"."order_discount_codes" USING btree ("store_id","discount_id");--> statement-breakpoint
CREATE INDEX "order_discount_codes_item_idx" ON "commerce"."order_discount_codes" USING btree ("store_id","item_id") WHERE "commerce"."order_discount_codes"."item_id" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."discount_codes" ADD CONSTRAINT "discount_codes_combines_with" CHECK (jsonb_typeof("commerce"."discount_codes"."combines_with") = 'array' and "commerce"."discount_codes"."combines_with" <@ '["products", "order", "shipping"]'::jsonb);