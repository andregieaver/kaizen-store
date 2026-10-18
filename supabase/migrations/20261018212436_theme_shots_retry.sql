-- D278: photographs of themes are taken one look at a time across the job's runs. Before, runs that overlapped had two browsers at
-- once in one function, which ran out of memory ("The browser stopped …"), and the looks that failed three times so kept their
-- theme's highlights waiting for good. Those looks are tried again from the start.
UPDATE "commerce"."theme_shots"
   SET "status" = 'waiting', "tries" = 0, "problem" = NULL, "claimed_until" = NULL
 WHERE "status" = 'failed' AND "problem" LIKE 'The browser stopped%';
