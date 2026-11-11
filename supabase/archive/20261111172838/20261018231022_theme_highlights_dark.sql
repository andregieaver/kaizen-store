-- D280: a look's swatch is now the palette it is shown in, and the highlights' backdrop is drawn from it. The highlights of the themes whose
-- own look is always dark (Orbit, Arcade) were composed over their light palette's colours: they are composed again from the photographs
-- already made, under their own addresses.
UPDATE "commerce"."theme_shots" "t"
   SET "status" = 'waiting', "tries" = 0, "problem" = NULL, "claimed_until" = NULL, "pictures" = NULL, "parts" = NULL, "finished_at" = NULL
  FROM "commerce"."design_presets" "p"
 WHERE "p"."id" = "t"."preset_id" AND "t"."kind" = 'highlights' AND "t"."variation" IS NULL AND "t"."status" = 'done'
   AND "p"."snapshot"->'theme'->'settings'->>'mode' = 'dark';
