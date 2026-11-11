-- When an AI's picture was known to carry IPTC's digital source type in its XMP (AI Act Art. 50(2), docs/ai-act.md). New pictures set it
-- when they are made; the aiPictureMarks job reads each older one's file and marks it, so nothing is set here by date.
ALTER TABLE "commerce"."media" ADD COLUMN "ai_marked_at" timestamp with time zone;