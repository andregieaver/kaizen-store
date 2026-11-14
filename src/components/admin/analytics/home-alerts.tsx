import { AdminLink } from "@/components/admin/ui/link";

import { Section } from "@/components/admin/overview-parts";
import type { AdminLang } from "@/lib/admin-lang";
import { setAnalyticsLang } from "@/lib/analytics-lang";
import { analyticsWords } from "@/lib/analytics-words";
import { alertsForStore } from "@/server/analytics-insights";
import type { Store } from "@/server/stores";

import { askAboutAlert } from "@/lib/alert-ask";

import { AlertList } from "./alerts";
import { AskOnArrival } from "./ask-on-arrival";

/** How many alerts the store's home page shows; the rest are one click away on the Analytics overview. */
export const HOME_ALERTS = 3;

/**
 * The top of what Analytics found, under "Needs your attention" on a store's home page (D152). It reads on its own, inside a
 * `<Suspense>`, so the page does not wait for the reports behind it, and it never throws: with nothing to say (or a report that could
 * not be read) it draws nothing at all.
 */
export async function HomeAnalyticsAlerts({ store, base, now, lang = "en", ask = null }: { store: Store; base: string; now: Date; lang?: AdminLang; ask?: string | null }) {
  // The alerts' words and figures in the member's language (D312 A9), as on the Analytics overview.
  setAnalyticsLang(lang);
  let all;
  try {
    all = await alertsForStore(store, now);
  } catch {
    return null;
  }
  const alerts = all.slice(0, HOME_ALERTS);
  const w = analyticsWords().alerts;
  // The briefing's *Ask the AI manager* (D416): the alert asked about, if it still stands, opens the AI manager with its words.
  const asked = ask ? all.find((a) => a.id === ask) : undefined;
  const arrival = asked ? <AskOnArrival message={askAboutAlert(asked, w)} /> : null;
  if (alerts.length === 0) return arrival;
  return (
    <Section
      id="analytics-alerts-heading"
      title={w.homeTitle}
      action={
        <AdminLink href={`${base}/analytics`} className="text-sm underline">
          {w.seeAll}
        </AdminLink>
      }
    >
      <AlertList alerts={alerts} base={base} />
      {arrival}
    </Section>
  );
}

/** What stands in for the alerts while they are read: a quiet block the size of one alert. */
export function HomeAnalyticsAlertsFallback() {
  return <div aria-hidden="true" className="h-16 animate-pulse rounded-lg bg-card" />;
}
