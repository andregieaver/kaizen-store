import type { Metadata } from "next";
import Link from "next/link";

import { IntegrationMark } from "@/components/admin/integration-mark";
import { INTEGRATIONS } from "@/lib/integrations";
import { requireMember } from "@/server/auth";
import { listIntegrations } from "@/server/integrations";

export const metadata: Metadata = { title: "Integrations" };

/** Every integration a store can turn on (D41), and how each connected one is doing. */
export default async function IntegrationsPage({ params }: PageProps<"/admin/[store]/integrations">) {
  const { store } = await requireMember((await params).store);
  const connected = await listIntegrations(store.id);
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
    </div>
  );
}
