CREATE TABLE "commerce"."product_market_texts" (
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"market_code" char(2) NOT NULL,
	"locale" text NOT NULL,
	"description" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_market_texts_product_id_market_code_locale_pk" PRIMARY KEY("product_id","market_code","locale"),
	CONSTRAINT "product_market_texts_description" CHECK (length("commerce"."product_market_texts"."description") between 1 and 20000)
);
--> statement-breakpoint
ALTER TABLE "commerce"."product_market_texts" ADD CONSTRAINT "product_market_texts_product_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "commerce"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."product_market_texts" ADD CONSTRAINT "product_market_texts_market_fk" FOREIGN KEY ("store_id","market_code") REFERENCES "commerce"."markets"("store_id","code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_market_texts_market_idx" ON "commerce"."product_market_texts" USING btree ("store_id","market_code");