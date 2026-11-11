import { englishLater, LATER_AREAS, settledEnglish } from "@/components/admin/admin-text-later";

/**
 * Every area whose English a part fetches when nothing handed it down (`admin-text-later.ts`): a unit test draws a part on its own with
 * `renderToStaticMarkup()`, which cannot wait, so their English is fetched and settled before any test runs.
 */
await Promise.all(LATER_AREAS.map(async (area) => settledEnglish(area, await englishLater(area))));
