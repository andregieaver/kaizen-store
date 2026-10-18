-- D279: three photographs were kept although the page had not drawn yet: one flat white, one screen long, a first screen of about 2 KB
-- where a real one is 57 KB or more (Orbit's own look and its Nebula preset at a computer's width, Arcade's Vapor at a phone's). They are
-- taken again, and so are the highlights composed from them (Orbit's card and highlights showed white). Their files are written again in
-- place when they are made.
WITH "blank" AS (
  SELECT "preset_id", "version", "variation", "showcase_store_id"
    FROM "commerce"."theme_shots"
   WHERE "status" = 'done' AND "kind" IN ('computer', 'phone') AND ("pictures"->'screen'->>'bytes')::int < 5000
)
UPDATE "commerce"."theme_shots" "t"
   SET "status" = 'waiting', "tries" = 0, "problem" = NULL, "claimed_until" = NULL, "pictures" = NULL, "parts" = NULL, "finished_at" = NULL
  FROM "blank" "b"
 WHERE "t"."preset_id" = "b"."preset_id" AND "t"."version" = "b"."version" AND "t"."variation" IS NOT DISTINCT FROM "b"."variation"
   AND "t"."showcase_store_id" = "b"."showcase_store_id" AND "t"."status" = 'done'
   AND ("t"."kind" = 'highlights' OR ("t"."pictures"->'screen'->>'bytes')::int < 5000);
