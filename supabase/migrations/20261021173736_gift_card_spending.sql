CREATE TABLE "commerce"."cart_gift_cards" (
	"store_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_gift_cards_store_id_cart_id_card_id_pk" PRIMARY KEY("store_id","cart_id","card_id")
);
--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD COLUMN "gift_card_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."cart_gift_cards" ADD CONSTRAINT "cart_gift_cards_cart_fk" FOREIGN KEY ("store_id","cart_id") REFERENCES "commerce"."carts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."cart_gift_cards" ADD CONSTRAINT "cart_gift_cards_card_fk" FOREIGN KEY ("store_id","card_id") REFERENCES "commerce"."gift_cards"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_gift_cards_card_idx" ON "commerce"."cart_gift_cards" USING btree ("store_id","card_id");--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_gift_card_fk" FOREIGN KEY ("store_id","gift_card_id") REFERENCES "commerce"."gift_cards"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payments_gift_card_idx" ON "commerce"."payments" USING btree ("store_id","gift_card_id") WHERE "commerce"."payments"."gift_card_id" is not null;--> statement-breakpoint
ALTER TABLE "commerce"."payments" ADD CONSTRAINT "payments_gift_card" CHECK (("commerce"."payments"."provider" = 'gift_card') = ("commerce"."payments"."gift_card_id" is not null) and ("commerce"."payments"."provider" <> 'gift_card' or "commerce"."payments"."provider_account" is null));