import Link from "next/link";

import { Section } from "@/components/admin/overview-parts";
import { alertsForStore } from "@/server/analytics-insights";
import type { Store } from "@/server/stores";

import { AlertList } from "./alerts";

/** How many alerts the store's home page shows; the rest are one click away on the Analytics overview. */
export const HOME_ALERTS = 3;

/**
 * The top of what Analytics found, under "Needs your attention" on a store's home page (D152). It reads on its own, inside a
 * `<Suspense>`, so the page does not wait for the reports behind it, and it never throws: with nothing to say (or a report that could
 * not be read) it draws nothing at all.
 */
export async function HomeAnalyticsAlerts({ store, base, now }: { store: Store; base: string; now: Date }) {
  let alerts;
  try {
    alerts = (await alertsForStore(store, now)).slice(0, HOME_ALERTS);
  } catch {
    return null;
  }
  if (alerts.length === 0) return null;
  return (
    <Section
      id="analytics-alerts-heading"
      title="Worth a look in Analytics"
      action={
        <Link href={`${base}/analytics`} className="text-sm underline">
          See all
        </Link>
      }
    >
      <AlertList alerts={alerts} base={base} />
    </Section>
  );
}

/** What stands in for the alerts while they are read: a quiet block the size of one alert. */
export function HomeAnalyticsAlertsFallback() {
  return <div aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-background" />;
}
