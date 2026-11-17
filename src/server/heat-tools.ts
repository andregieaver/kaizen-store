import "server-only";

import { FLAG_VERSION_VIEWS, HEAT_DEVICES, type HeatDevice } from "@/lib/page-heat";
import { frustratedVersion } from "@/lib/heat-read";
import { hubFigures, pageFigures, versionFigures } from "@/lib/heat-tools";
import { addDays, todayIn } from "@/lib/analytics-period";
import { variantNameText } from "@/lib/experiment-words";
import type { OwnerToolInput } from "@/lib/owner-tools";

import { getExperiment } from "./experiment-admin";
import { OwnerToolError } from "./owner-tool-error";
import { heatPages, mapLayoutOf, pageDevices, pageHeat, versionBehaviour } from "./page-heat-read";
import type { Store } from "./stores";

/**
 * The AI manager's heatmap tools (D656 step 14): the same reads as Analytics → Heatmaps and an A/B test's page, written out by code in
 * `src/lib/heat-tools.ts`. Read-only and ungated. No tool here reads recordings: they never go to a model.
 */

type Ctx = { store: Store };

const PAGE_KEY = /^\/[a-z0-9-]{2,40}(\/.*)?$/;
const DEVICE_WORDS: Record<HeatDevice, string> = { mobile: "phone", tablet: "tablet", desktop: "computer" };

export async function pageBehaviourTool({ store }: Ctx, { page, days, device }: OwnerToolInput<"page_behaviour">) {
  const today = todayIn(new Date(), store.timeZone);
  const period = { from: addDays(today, 1 - days), to: addDays(today, 1) };
  const measuring = store.heatmaps ? "Heatmaps are on." : "Heatmaps are off: nothing new is measured. The owner switches them on in Analytics → Settings.";
  const base = `/admin/${store.slug}/analytics/heatmaps`;
  const periodWords = `${period.from} to ${today} (${days} days)`;
  if (!page) {
    const rows = await heatPages(store.id, { ...period, device });
    return { measuring, period: periodWords, device: device ? DEVICE_WORDS[device] : "all", ...hubFigures(rows), page: base };
  }
  if (!PAGE_KEY.test(page)) throw new OwnerToolError("That is not a page key: use one as page_behaviour lists them, such as /no/p/mug.");
  const devices = await pageDevices(store.id, page, period);
  const chosen: HeatDevice = device ?? HEAT_DEVICES.reduce((best, d) => (devices[d] > devices[best] ? d : best), "mobile" as HeatDevice);
  const [heat, layout] = await Promise.all([pageHeat(store.id, { page, device: chosen, ...period }), mapLayoutOf(store.id, page, chosen)]);
  return {
    measuring,
    period: periodWords,
    device: DEVICE_WORDS[chosen],
    page_views_per_device: Object.fromEntries(HEAT_DEVICES.map((d) => [DEVICE_WORDS[d], devices[d]])),
    ...pageFigures({ ...heat, layout }),
    page: `${base}?${new URLSearchParams({ page, device: chosen, days: String(days) }).toString()}`,
  };
}

export async function versionBehaviourTool({ store }: Ctx, { experiment }: OwnerToolInput<"version_behaviour">) {
  const test = await getExperiment(store.id, experiment);
  if (!test) throw new OwnerToolError("No A/B test of this store has that id: list_experiments gives them.");
  const rows = await versionBehaviour(store.id, test.id);
  const byKey = new Map(rows.map((r) => [r.version, r]));
  const flagged = frustratedVersion(rows, FLAG_VERSION_VIEWS);
  const name = (key: string) => variantNameText(test.variants.find((v) => v.key === key)?.name ?? key.toUpperCase());
  return {
    measuring: store.heatmaps || rows.length > 0 ? "From heatmaps' daily totals over every page the test touched; never a visitor." : "Heatmaps are off and the test has no totals: nothing to say.",
    test: test.name,
    versions: versionFigures(
      test.variants.map((v) => {
        const r = byKey.get(v.key);
        return { name: name(v.key), views: r?.views ?? 0, reachedHalf: r?.reachedHalf ?? 0, rageShare: r?.rageShare ?? 0, deadShare: r?.deadShare ?? 0 };
      }),
    ),
    clearly_more_frustrated: flagged ? `${name(flagged)} gets clearly more rage or dead clicks than the original. It is a warning; nothing stops the test for it.` : null,
    page: `/admin/${store.slug}/experiments/${test.id}#ab-behaviour`,
  };
}
