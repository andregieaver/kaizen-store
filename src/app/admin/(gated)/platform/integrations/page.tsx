import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { IntegrationMark } from "@/components/admin/integration-mark";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { INTEGRATIONS, isProvider } from "@/lib/integrations";
import { requirePlatformReader } from "@/server/auth";
import { countWords } from "@/lib/admin-fill";
import { listPlatformEndpoints } from "@/server/platform-endpoints";
import { listPlatformIntegrations } from "@/server/platform-integrations";

export const metadata: Metadata = { title: "Integrations" };

/**
 * Kaizena Flow's own integrations (D465, `docs/platform-parity.md`): the services a store connects under its Integrations, connected here
 * for the platform's own events, each with how it is doing. One card each, as the store's page has; the services that are a store's only
 * (accounting, carriers) are not offered.
 */
export default async function PlatformIntegrationsPage() {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const all = adminText(lang, "notifications");
  const w = all.integrations;
  const platformWords = adminText(lang, "platform");
  const own = { ...platformWords.integrations, api: platformWords.api };
  const [connected, endpoints] = await Promise.all([listPlatformIntegrations(), listPlatformEndpoints()]);
  const services = INTEGRATIONS.filter((info) => isProvider(info.id));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={own.title} description={own.description} />
      <ul className="grid gap-4 sm:grid-cols-2">
        {services.map((info) => {
          const status = connected.find((c) => c.provider === info.id);
          const badge = !status
            ? null
            : status.enabled
              ? status.recentFailures > 0
                ? { text: w.someFailed, tone: "bg-warning-soft text-warning-text" }
                : { text: all.common.on, tone: "bg-positive-soft text-positive-text" }
              : { text: all.common.off, tone: "bg-sunken text-muted" };
          return (
            <li key={info.id} className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
              <div className="flex items-start gap-3">
                <IntegrationMark id={info.id} />
                <div className="min-w-0 flex-1">
                  <h2 className="flex flex-wrap items-center gap-2 text-title text-ink">
                    {info.name}
                    {badge && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.tone}`}>{badge.text}</span>}
                  </h2>
                  <p className="text-sm text-muted">{own.summaries[info.id] ?? info.summary}</p>
                </div>
              </div>
              <div className="mt-auto">
                <Link
                  href={`/admin/platform/integrations/${info.id}`}
                  className={`inline-flex min-h-10 items-center rounded-pill px-4 text-sm font-medium ${
                    status ? "border border-edge hover:bg-sunken" : "bg-brand text-brand-ink"
                  }`}
                >
                  {status ? w.manage : w.setUp} <span className="sr-only">&nbsp;{info.name}</span>
                </Link>
              </div>
            </li>
          );
        })}
        {/* Kaizena Flow's own API (C4 step 4, D518): its tools read the platform with a token. */}
        <li className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
          <div className="min-w-0">
            <h2 className="text-title text-ink">{own.api.title}</h2>
            <p className="text-sm text-muted">{own.api.cardDescription}</p>
          </div>
          <div className="mt-auto">
            <Link href="/admin/platform/integrations/api" className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken">
              {own.api.cardButton}
            </Link>
          </div>
        </li>
        {/* Kaizena Flow's own endpoints (C4, D515): its events, signed, to addresses of its own. */}
        <li className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2 text-title text-ink">
              {w.endpoints.cardTitle}
              {endpoints.length > 0 && <span className="rounded bg-sunken px-1.5 py-0.5 text-xs font-medium text-muted">{countWords(endpoints.length, w.endpoints.cardCount)}</span>}
            </h2>
            <p className="text-sm text-muted">{w.endpoints.cardDescription}</p>
          </div>
          <div className="mt-auto">
            <Link href="/admin/platform/integrations/endpoints" className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken">
              {w.endpoints.cardButton}
            </Link>
          </div>
        </li>
      </ul>
      <p className="text-sm text-muted">{own.storesHave}</p>
    </div>
  );
}
