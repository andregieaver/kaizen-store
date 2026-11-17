import "server-only";

import { ROLE_SEGMENT } from "@/lib/ab-site";
import { readPreview, signPreview } from "@/lib/ab-preview-sign";
import { marketPath, storeSiteUrl } from "@/lib/paths";

import { getStore, storeSlugOf } from "./stores";
import { runningExperiments, type RunningExperiment } from "./experiments";
import { unlockSecret } from "./private-secret";

/**
 * Preview links to share (D148 phase 20, `src/lib/ab-preview.ts`): the link for one version of a running test, made for a member of the store,
 * and what the link does when opened (`/api/ab/preview`): the address it lands on, or none when the test has stopped or the link is not good.
 */

/** Where a version is seen on the live site: the page under test, the working page or the front page for what every page shows. */
function landingPath(store: string, market: string, test: Pick<RunningExperiment, "kind" | "role" | "slug">): string {
  const home = marketPath(store, market);
  if (test.kind === "page") return `${home}/${test.slug}`;
  if (test.kind === "role" && test.role && ROLE_SEGMENT[test.role]) return `${home}/${ROLE_SEGMENT[test.role]}`;
  return home || "/";
}

/** The link that shows a version of a running test to whoever opens it, or null when the test is not running, has no such version, or no secret is set. */
export async function previewLink(store: { id: string; slug: string }, experimentId: string, version: string): Promise<string | null> {
  const secret = unlockSecret();
  if (!secret || version === "a") return null;
  const test = (await runningExperiments(store.id)).find((t) => t.id === experimentId);
  if (!test || !test.variants.some((v) => v.key === version)) return null;
  const token = signPreview(secret, { storeId: store.id, experiment: experimentId, version });
  return `${storeSiteUrl(store.slug)}/api/ab/preview?t=${encodeURIComponent(token)}`;
}

/** What opening a link does: the token to keep and the address to go to while its test runs, or only the store's front door once it has stopped. */
export async function openPreview(token: string | null): Promise<{ keep: boolean; to: string; experiment: string } | null> {
  const preview = readPreview(unlockSecret(), token);
  if (!preview) return null;
  const slug = await storeSlugOf(preview.storeId);
  const store = slug ? await getStore(slug) : null;
  if (!store) return null;
  const market = store.markets[0]?.slug ?? "";
  const test = (await runningExperiments(store.id)).find((t) => t.id === preview.experiment);
  if (!test || !test.variants.some((v) => v.key === preview.version)) return { keep: false, to: marketPath(store.slug, market) || "/", experiment: preview.experiment };
  return { keep: true, to: landingPath(store.slug, market, test), experiment: preview.experiment };
}
