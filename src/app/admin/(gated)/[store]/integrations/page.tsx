import type { Metadata } from "next";
import Link from "next/link";

import { IntegrationMark } from "@/components/admin/integration-mark";
import { adminLangOf } from "@/lib/admin-lang";
import { countWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { INTEGRATIONS } from "@/lib/integrations";
import { CARRIERS } from "@/lib/shipping-carriers";
import { requirePermission } from "@/server/permissions";
import { listIntegrations } from "@/server/integrations";
import { listEndpoints } from "@/server/webhook-endpoints";
import { listCarriers } from "@/server/shipping-carriers";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Integrations" };

/** Every integration a store can turn on (D41), and how each connected one is doing. */
export default async function IntegrationsPage({ params }: PageProps<"/admin/[store]/integrations">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "notifications");
  const carrierWords = adminText(lang, "shipping").carrier.carriers as Record<string, { summary: string } | undefined>;
  const w = all.integrations;
  const k = w.carrier;
  const [connected, carriers, endpoints] = await Promise.all([listIntegrations(store.id), listCarriers(store.id), listEndpoints(store.id)]);
  const base = `/admin/${store.slug}/integrations`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={<>{w.description}</>}
      />
      <ul className="grid gap-4 sm:grid-cols-2">
        {INTEGRATIONS.map((info) => {
          const status = connected.find((c) => c.provider === info.id);
          const badge = info.comingSoon
            ? { text: w.comingSoon, tone: "bg-sunken text-muted" }
            : !status
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
                  <p className="text-sm text-muted">{w.infos[info.id]?.summary ?? info.summary}</p>
                </div>
              </div>
              <div className="mt-auto">
                {info.comingSoon ? (
                  <p className="text-sm text-muted">{w.notYet}</p>
                ) : (
                  <Link
                    href={`${base}/${info.id}`}
                    className={`inline-flex min-h-10 items-center rounded-pill px-4 text-sm font-medium ${
                      status ? "border border-edge hover:bg-sunken" : "bg-brand text-brand-ink"
                    }`}
                  >
                    {status ? w.manage : w.setUp} <span className="sr-only">&nbsp;{info.name}</span>
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <Card
        title={w.endpoints.cardTitle}
        description={w.endpoints.cardDescription}
        aside={endpoints.length > 0 ? <span className="text-sm text-muted">{countWords(endpoints.length, w.endpoints.cardCount)}</span> : undefined}
        className="flex flex-col gap-3"
        compact
      >
        <Link href={`${base}/endpoints`} className="inline-flex min-h-10 w-fit items-center rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken">
          {w.endpoints.cardButton}
        </Link>
      </Card>
      <section aria-labelledby="shipping-carriers" className="flex flex-col gap-4">
        <div>
          <h2 id="shipping-carriers" className="text-title text-ink">
            {w.carriers}
          </h2>
          <p className="text-sm text-muted">{w.carriersHint}</p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {CARRIERS.map((info) => {
            const saved = carriers.find((c) => c.carrier === info.id);
            const badge = !saved
              ? { text: info.available.length > 0 ? k.available : k.preparing, tone: "bg-sunken text-muted" }
              : saved.complete
                ? info.available.length > 0
                  ? saved.check?.ok
                    ? { text: k.connected, tone: "bg-positive-soft text-positive-text" }
                    : { text: saved.check ? k.notAccepted : k.check, tone: "bg-warning-soft text-warning-text" }
                  : { text: k.saved, tone: "bg-positive-soft text-positive-text" }
                : { text: k.needs, tone: "bg-warning-soft text-warning-text" };
            return (
              <li key={info.id} className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
                <div className="flex items-start gap-3">
                  <IntegrationMark id={info.id} />
                  <div className="min-w-0 flex-1">
                    <h3 className="flex flex-wrap items-center gap-2 text-body-strong text-ink">
                      {info.name}
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.tone}`}>{badge.text}</span>
                    </h3>
                    <p className="text-sm text-muted">{carrierWords[info.id]?.summary ?? info.summary}</p>
                  </div>
                </div>
                <div className="mt-auto">
                  <Link
                    href={`${base}/shipping/${info.id}`}
                    className={`inline-flex min-h-10 items-center rounded-pill px-4 text-sm font-medium ${
                      saved ? "border border-edge hover:bg-sunken" : "bg-brand text-brand-ink"
                    }`}
                  >
                    {saved ? w.manage : info.available.length > 0 ? k.connect : k.getReady} <span className="sr-only">&nbsp;{info.name}</span>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <Card title={w.googleTitle} description={w.googleDescription} className="flex flex-col gap-3" compact>
        <Link href={`${base}/google-reviews`} className="inline-flex min-h-10 w-fit items-center rounded-pill border border-edge px-4 text-sm font-medium hover:bg-sunken">
          {w.googleSetUp}
        </Link>
      </Card>
    </div>
  );
}
