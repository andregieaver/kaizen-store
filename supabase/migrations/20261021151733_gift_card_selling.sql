ALTER TABLE "commerce"."cart_lines" DROP CONSTRAINT "cart_lines_cart_variant_plan_key";--> statement-breakpoint
ALTER TABLE "commerce"."gift_card_entries" DROP CONSTRAINT "gift_card_entries_staff";--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" DROP CONSTRAINT "notification_settings_notification";--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" DROP CONSTRAINT "notification_settings_required";--> statement-breakpoint
ALTER TABLE "commerce"."products" DROP CONSTRAINT "products_kind";--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD COLUMN "gift_card_key" text;--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD COLUMN "gift_card_to" text;--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD COLUMN "gift_card_to_name" text;--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD COLUMN "gift_card_from" text;--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD COLUMN "gift_card_message" text;--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD COLUMN "gift_card_send_on" date;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "gift_card_to" text;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "gift_card_to_name" text;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "gift_card_from" text;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "gift_card_message" text;--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD COLUMN "gift_card_send_on" date;--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_cart_variant_plan_key" UNIQUE NULLS NOT DISTINCT("cart_id","variant_id","selling_plan_id","starts_at","gift_card_key");--> statement-breakpoint
ALTER TABLE "commerce"."cart_lines" ADD CONSTRAINT "cart_lines_gift_card" CHECK (("commerce"."cart_lines"."gift_card_key" is null) = ("commerce"."cart_lines"."gift_card_to" is null) and (("commerce"."cart_lines"."gift_card_to" is null and "commerce"."cart_lines"."gift_card_to_name" is null and "commerce"."cart_lines"."gift_card_from" is null and "commerce"."cart_lines"."gift_card_message" is null and "commerce"."cart_lines"."gift_card_send_on" is null)
      or ("commerce"."cart_lines"."gift_card_to" is not null and "commerce"."cart_lines"."gift_card_send_on" is not null))
    and char_length("commerce"."cart_lines"."gift_card_to") <= 254 and char_length("commerce"."cart_lines"."gift_card_to_name") <= 60 and char_length("commerce"."cart_lines"."gift_card_from") <= 60
    and char_length("commerce"."cart_lines"."gift_card_message") <= 300
    and ("commerce"."cart_lines"."gift_card_message" is null or cardinality(string_to_array("commerce"."cart_lines"."gift_card_message", chr(10))) <= 6));--> statement-breakpoint
ALTER TABLE "commerce"."gift_card_entries" ADD CONSTRAINT "gift_card_entries_staff" CHECK (("commerce"."gift_card_entries"."kind" <> 'adjust' or "commerce"."gift_card_entries"."account_id" is not null) and ("commerce"."gift_card_entries"."kind" <> 'void' or "commerce"."gift_card_entries"."account_id" is not null or "commerce"."gift_card_entries"."order_id" is not null));--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" ADD CONSTRAINT "notification_settings_notification" CHECK ("commerce"."notification_settings"."notification" in ('order.confirmation', 'subscription.renewed', 'order.changed', 'order.sent', 'order.parcel_out_for_delivery', 'order.parcel_delivered', 'order.refunded', 'order.cancelled', 'order.payment_due', 'order.payment_overdue', 'gift_card.issued', 'order.ready_for_pickup', 'order.out_for_delivery', 'return.acknowledgement', 'return.approved', 'return.declined', 'return.received', 'return.refunded', 'return.exchange_proposed', 'return.exchange_to_pay', 'return.exchanged', 'return.exchange_lapsed', 'return.label_ready'));--> statement-breakpoint
ALTER TABLE "commerce"."notification_settings" ADD CONSTRAINT "notification_settings_required" CHECK ("commerce"."notification_settings"."enabled" or "commerce"."notification_settings"."notification" not in ('order.confirmation', 'subscription.renewed', 'order.changed', 'gift_card.issued', 'return.acknowledgement', 'return.approved', 'return.declined', 'return.exchange_to_pay', 'return.exchanged'));--> statement-breakpoint
ALTER TABLE "commerce"."order_lines" ADD CONSTRAINT "order_lines_gift_card" CHECK ((("commerce"."order_lines"."gift_card_to" is null and "commerce"."order_lines"."gift_card_to_name" is null and "commerce"."order_lines"."gift_card_from" is null and "commerce"."order_lines"."gift_card_message" is null and "commerce"."order_lines"."gift_card_send_on" is null)
      or ("commerce"."order_lines"."gift_card_to" is not null and "commerce"."order_lines"."gift_card_send_on" is not null))
    and char_length("commerce"."order_lines"."gift_card_to") <= 254 and char_length("commerce"."order_lines"."gift_card_to_name") <= 60 and char_length("commerce"."order_lines"."gift_card_from") <= 60
    and char_length("commerce"."order_lines"."gift_card_message") <= 300
    and ("commerce"."order_lines"."gift_card_message" is null or cardinality(string_to_array("commerce"."order_lines"."gift_card_message", chr(10))) <= 6));--> statement-breakpoint
ALTER TABLE "commerce"."products" ADD CONSTRAINT "products_kind" CHECK ("commerce"."products"."kind" in ('goods', 'appointment', 'stay', 'rental', 'gift_card'));