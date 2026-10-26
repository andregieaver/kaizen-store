CREATE TABLE "commerce"."review_pictures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"review_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"thumb_bytes" integer NOT NULL,
	"hidden_at" timestamp with time zone,
	"hidden_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_pictures_store_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "review_pictures_position_key" UNIQUE("store_id","review_id","position"),
	CONSTRAINT "review_pictures_position" CHECK (position between 0 and 2),
	CONSTRAINT "review_pictures_type" CHECK ("commerce"."review_pictures"."type" in ('image/webp', 'image/jpeg')),
	CONSTRAINT "review_pictures_size" CHECK (width between 1 and 1600 and height between 1 and 1600),
	CONSTRAINT "review_pictures_bytes" CHECK (bytes between 1 and 614400 and thumb_bytes between 1 and 153600),
	CONSTRAINT "review_pictures_hidden" CHECK (("commerce"."review_pictures"."hidden_at" is null) = ("commerce"."review_pictures"."hidden_by" is null))
);
--> statement-breakpoint
ALTER TABLE "commerce"."review_pictures" ADD CONSTRAINT "review_pictures_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."review_pictures" ADD CONSTRAINT "review_pictures_hidden_by_accounts_id_fk" FOREIGN KEY ("hidden_by") REFERENCES "commerce"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."review_pictures" ADD CONSTRAINT "review_pictures_review_fk" FOREIGN KEY ("store_id","review_id") REFERENCES "commerce"."product_reviews"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "review_pictures_hidden_by_idx" ON "commerce"."review_pictures" USING btree ("hidden_by");