CREATE TABLE "commerce"."shop_move_items" (
	"store_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_move_items_pkey" PRIMARY KEY("store_id","kind","ref"),
	CONSTRAINT "shop_move_items_kind" CHECK ("commerce"."shop_move_items"."kind" in ('job', 'customer', 'product', 'page', 'menu', 'discount', 'subscriber', 'gift_card', 'theme', 'market')),
	CONSTRAINT "shop_move_items_ref" CHECK (char_length("commerce"."shop_move_items"."ref") between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "commerce"."shop_move_items" ADD CONSTRAINT "shop_move_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "commerce"."shop_move_items" ENABLE ROW LEVEL SECURITY;
