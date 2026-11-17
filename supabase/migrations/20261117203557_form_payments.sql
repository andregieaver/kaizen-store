CREATE TABLE "commerce"."form_payments" (
	"response_id" uuid PRIMARY KEY NOT NULL,
	"store_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce"."forms" ADD COLUMN "payment_variant_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce"."form_payments" ADD CONSTRAINT "form_payments_response_id_form_responses_id_fk" FOREIGN KEY ("response_id") REFERENCES "commerce"."form_responses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce"."form_payments" ADD CONSTRAINT "form_payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "commerce"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "form_payments_cart_idx" ON "commerce"."form_payments" USING btree ("store_id","cart_id");--> statement-breakpoint
ALTER TABLE "commerce"."forms" ADD CONSTRAINT "forms_payment" CHECK ("commerce"."forms"."payment_variant_id" is null or ("commerce"."forms"."store_id" is not null and "commerce"."forms"."kind" = 'message'));