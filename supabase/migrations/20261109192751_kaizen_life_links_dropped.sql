-- D525: the retired OAuth bridge's table (D96's tokens for the AI manager at Kaizen Life). It never had a row, and no running code names
-- it since account erasure stopped deleting from it (the change before this one).
DROP TABLE "commerce"."kaizen_life_links" CASCADE;