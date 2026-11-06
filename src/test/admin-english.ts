import { settledEnglish } from "@/components/admin/admin-text-later";
import { movingEn } from "@/lib/admin-messages/moving.en";
import { setupEn } from "@/lib/admin-messages/setup.en";
import { shellEn } from "@/lib/admin-messages/shell.en";

/**
 * The areas the layouts hand down, whose English a part outside them fetches when it first reads it (`admin-text-later.ts`): a unit
 * test draws a part on its own with `renderToStaticMarkup()`, which cannot wait, so their English is there already.
 */
settledEnglish("setup", setupEn);
settledEnglish("shell", shellEn);
settledEnglish("moving", movingEn);
