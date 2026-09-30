import type { Metadata } from "next";
import Link from "next/link";

import { IntegrationMark } from "@/components/admin/integration-mark";
import { INTEGRATIONS } from "@/lib/integrations";
import { CARRIERS } from "@/lib/shipping-carriers";
import { requireMember } from "@/server/auth";
import { listIntegrations } from "@/server/integrations";
import { listCarriers } from "@/server/shipping-carriers";

export const metadata: Metadata = { title: "Integrations" };

/** Every integration a store can turn on (D41), and how each connected one is doing. */
export default async function IntegrationsPage({ params }: PageProps<"/admin/[store]/integrations">) {
  const { store } = await requireMember((await params).store);
  const [connected, carriers] = await Promise.all([listIntegrations(store.id), listCarriers(store.id)]);
  const base = `/admin/${store.slug}/integrations`;

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="text-sm text-muted">Connect Kaizen to the services you already use. Orders, customers and subscriptions go there as they happen.</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2">
        {INTEGRATIONS.map((info) => {
          const status = connected.find((c) => c.provider === info.id);
          const badge = info.comingSoon
            ? { text: "Coming soon", tone: "bg-surface text-muted" }
            : !status
              ? null
              : status.enabled
                ? status.recentFailures > 0
                  ? { text: "On · some failed", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" }
                  : { text: "On", tone: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" }
                : { text: "Off", tone: "bg-surface text-muted" };
          return (
            <li key={info.id} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
              <div className="flex items-start gap-3">
                <IntegrationMark id={info.id} />
                <div className="min-w-0 flex-1">
                  <h2 className="flex flex-wrap items-center gap-2 font-medium">
                    {info.name}
                    {badge && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.tone}`}>{badge.text}</span>}
                  </h2>
                  <p className="text-sm text-muted">{info.summary}</p>
                </div>
              </div>
              <div className="mt-auto">
                {info.comingSoon ? (
                  <p className="text-sm text-muted">Not available yet.</p>
                ) : (
                  <Link
                    href={`${base}/${info.id}`}
                    className={`inline-flex min-h-10 items-center rounded-md px-4 text-sm font-medium ${
                      status ? "border border-border hover:bg-surface" : "bg-foreground text-background"
                    }`}
                  >
                    {status ? "Manage" : "Set up"} <span className="sr-only">&nbsp;{info.name}</span>
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <section aria-labelledby="shipping-carriers" className="flex flex-col gap-4">
        <div>
          <h2 id="shipping-carriers" className="text-lg font-semibold">
            Shipping carriers
          </h2>
          <p className="text-sm text-muted">
            Labels, tracking, pickup points and delivery options from the carriers you have an agreement with. Posten / Bring is
            ready to connect; the others are being built: save your details now and they are ready when each arrives.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-2">
          {CARRIERS.map((info) => {
            const saved = carriers.find((c) => c.carrier === info.id);
            const badge = !saved
              ? { text: info.available.length > 0 ? "Available" : "Preparing", tone: "bg-surface text-muted" }
              : saved.complete
                ? info.available.length > 0
                  ? saved.check?.ok
                    ? { text: "Connected", tone: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" }
                    : { text: saved.check ? "Not accepted" : "Check connection", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" }
                  : { text: "Details saved", tone: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" }
                : { text: "Needs details", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" };
            return (
              <li key={info.id} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
                <div className="flex items-start gap-3">
                  <IntegrationMark id={info.id} />
                  <div className="min-w-0 flex-1">
                    <h3 className="flex flex-wrap items-center gap-2 font-medium">
                      {info.name}
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.tone}`}>{badge.text}</span>
                    </h3>
                    <p className="text-sm text-muted">{info.summary}</p>
                  </div>
                </div>
                <div className="mt-auto">
                  <Link
                    href={`${base}/shipping/${info.id}`}
                    className={`inline-flex min-h-10 items-center rounded-md px-4 text-sm font-medium ${
                      saved ? "border border-border hover:bg-surface" : "bg-foreground text-background"
                    }`}
                  >
                    {saved ? "Manage" : info.available.length > 0 ? "Connect" : "Get ready"} <span className="sr-only">&nbsp;{info.name}</span>
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-labelledby="google-reviews" className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5">
        <div>
          <h2 id="google-reviews" className="font-medium">
            Google reviews
          </h2>
          <p className="text-sm text-muted">Show your rating and reviews on Google in Testimonials components on your pages.</p>
        </div>
        <Link href={`${base}/google-reviews`} className="inline-flex min-h-10 w-fit items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-surface">
          Set up Google reviews
        </Link>
      </section>
    </div>
  );
}
