CREATE TABLE "commerce"."api_idempotency_keys" (
	"token_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_idempotency_keys_token_id_key_pk" PRIMARY KEY("token_id","key"),
	CONSTRAINT "api_idempotency_keys_key" CHECK (char_length("commerce"."api_idempotency_keys"."key") between 1 and 255)
);
--> statement-breakpoint
ALTER TABLE "commerce"."api_idempotency_keys" ADD CONSTRAINT "api_idempotency_keys_token_id_api_tokens_id_fk" FOREIGN KEY ("token_id") REFERENCES "commerce"."api_tokens"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_idempotency_keys_created_idx" ON "commerce"."api_idempotency_keys" USING btree ("created_at");--> statement-breakpoint
-- Written only by src/server/api-idempotency.ts, never through the Data API.
ALTER TABLE "commerce"."api_idempotency_keys" ENABLE ROW LEVEL SECURITY;
