CREATE TABLE "commerce"."legal_source_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_key" text NOT NULL,
	"language" text NOT NULL,
	"version" text,
	"status" text NOT NULL,
	"text_hash" text,
	"passage_count" integer,
	"problem" text,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "legal_source_reads_status" CHECK ("commerce"."legal_source_reads"."status" in ('ok', 'failed')),
	CONSTRAINT "legal_source_reads_text" CHECK (("commerce"."legal_source_reads"."status" = 'ok') = ("commerce"."legal_source_reads"."text_hash" is not null)),
	CONSTRAINT "legal_source_reads_language" CHECK ("commerce"."legal_source_reads"."language" in ('nb', 'sv', 'da', 'en')),
	CONSTRAINT "legal_source_reads_problem" CHECK ("commerce"."legal_source_reads"."problem" is null or length("commerce"."legal_source_reads"."problem") <= 500)
);
--> statement-breakpoint
CREATE TABLE "commerce"."legal_source_texts" (
	"hash" text PRIMARY KEY NOT NULL,
	"passages" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "commerce"."legal_source_reads" ADD CONSTRAINT "legal_source_reads_text_hash_legal_source_texts_hash_fk" FOREIGN KEY ("text_hash") REFERENCES "commerce"."legal_source_texts"("hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "legal_source_reads_source_idx" ON "commerce"."legal_source_reads" USING btree ("source_key","language","read_at");--> statement-breakpoint
CREATE INDEX "legal_source_reads_text_idx" ON "commerce"."legal_source_reads" USING btree ("text_hash");