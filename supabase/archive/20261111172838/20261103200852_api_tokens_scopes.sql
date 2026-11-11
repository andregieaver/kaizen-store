ALTER TABLE "commerce"."api_tokens" DROP CONSTRAINT "api_tokens_scopes";--> statement-breakpoint
ALTER TABLE "commerce"."api_tokens" ADD CONSTRAINT "api_tokens_scopes" CHECK (cardinality("commerce"."api_tokens"."scopes") between 1 and 40);
