CREATE TABLE "commerce"."platform_languages" (
	"lang" text PRIMARY KEY NOT NULL,
	"locales" text[] NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"direction" text DEFAULT 'ltr' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_languages_lang" CHECK ("commerce"."platform_languages"."lang" ~ '^[a-z]{2,3}$'),
	CONSTRAINT "platform_languages_direction" CHECK ("commerce"."platform_languages"."direction" in ('ltr', 'rtl')),
	CONSTRAINT "platform_languages_locales" CHECK (cardinality("commerce"."platform_languages"."locales") >= 1)
);
--> statement-breakpoint
CREATE TABLE "commerce"."ui_translations" (
	"lang" text NOT NULL,
	"key" text NOT NULL,
	"text" text NOT NULL,
	"source_hash" text NOT NULL,
	"origin" text DEFAULT 'ai' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ui_translations_lang_key_pk" PRIMARY KEY("lang","key"),
	CONSTRAINT "ui_translations_origin" CHECK ("commerce"."ui_translations"."origin" in ('ai', 'staff'))
);
--> statement-breakpoint
ALTER TABLE "commerce"."ui_translations" ADD CONSTRAINT "ui_translations_lang_platform_languages_lang_fk" FOREIGN KEY ("lang") REFERENCES "commerce"."platform_languages"("lang") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Like every commerce table: row-level security on, no policies.
ALTER TABLE commerce.platform_languages ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE commerce.ui_translations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- The languages stores could already be written in (D109), now data (D111).
INSERT INTO commerce.platform_languages (lang, locales, name) VALUES
  ('en', ARRAY['en-GB', 'en-IE', 'en-MT'], 'English'),
  ('nb', ARRAY['nb-NO'], 'Norwegian Bokmål'),
  ('sv', ARRAY['sv-SE', 'sv-FI'], 'Swedish'),
  ('da', ARRAY['da-DK'], 'Danish'),
  ('fi', ARRAY['fi-FI'], 'Finnish'),
  ('de', ARRAY['de-DE', 'de-AT', 'de-BE', 'de-LU'], 'German'),
  ('nl', ARRAY['nl-NL', 'nl-BE'], 'Dutch'),
  ('fr', ARRAY['fr-FR', 'fr-BE', 'fr-LU'], 'French'),
  ('es', ARRAY['es-ES'], 'Spanish'),
  ('it', ARRAY['it-IT'], 'Italian'),
  ('pt', ARRAY['pt-PT'], 'Portuguese'),
  ('pl', ARRAY['pl-PL'], 'Polish'),
  ('cs', ARRAY['cs-CZ'], 'Czech'),
  ('sk', ARRAY['sk-SK'], 'Slovak'),
  ('hu', ARRAY['hu-HU'], 'Hungarian'),
  ('ro', ARRAY['ro-RO'], 'Romanian'),
  ('bg', ARRAY['bg-BG'], 'Bulgarian'),
  ('el', ARRAY['el-GR', 'el-CY'], 'Greek'),
  ('hr', ARRAY['hr-HR'], 'Croatian'),
  ('sl', ARRAY['sl-SI'], 'Slovenian'),
  ('et', ARRAY['et-EE'], 'Estonian'),
  ('lv', ARRAY['lv-LV'], 'Latvian'),
  ('lt', ARRAY['lt-LT'], 'Lithuanian'),
  ('mt', ARRAY['mt-MT'], 'Maltese'),
  ('ga', ARRAY['ga-IE'], 'Irish'),
  ('lb', ARRAY['lb-LU'], 'Luxembourgish')
ON CONFLICT (lang) DO NOTHING;
