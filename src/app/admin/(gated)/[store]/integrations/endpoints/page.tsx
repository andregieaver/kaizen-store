import type { Metadata } from "next";
import Link from "next/link";

import { AdminTextScope } from "@/components/admin/admin-text";
import { Card, PageHeader } from "@/components/admin/ui";
import { AddEndpoint, EndpointCard, type EndpointActions, type EndpointView } from "@/components/admin/webhook-endpoints";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { EVENTS } from "@/lib/integrations";
import { featureOn } from "@/lib/store-features";
import { ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/webhook-signature";
import { DEFAULT_EVENTS } from "@/server/integrations";
import { memberCan, requirePermission } from "@/server/permissions";
import { listEndpointDeliveries, listEndpoints } from "@/server/webhook-endpoints";

import {
  addEndpointAction,
  removeEndpointAction,
  renewSecretAction,
  resendDeliveryAction,
  switchEndpointAction,
  testEndpointAction,
  updateEndpointAction,
} from "./actions";

export const metadata: Metadata = { title: "Your own endpoints" };

/** An owner's own endpoints (D354): add one, choose its events, see its secret once, test it and send a delivery again. */
export default async function EndpointsPage({ params }: PageProps<"/admin/[store]/integrations/endpoints">) {
  const member = await requirePermission((await params).store, "settings:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const all = adminText(lang, "notifications").integrations;
  const w = all.endpoints;
  const owner = memberCan(member, "owner");
  const subscriptionsOn = featureOn(store, "subscriptions");
  const topics = EVENTS.filter((event) => !event.id.startsWith("subscription.") || subscriptionsOn).map((event) => ({
    id: event.id,
    label: all.events[event.id]?.label ?? event.label,
    hint: all.events[event.id]?.hint ?? event.hint,
  }));
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone || "Europe/Oslo" });
  const endpoints = await listEndpoints(store.id);
  const views: EndpointView[] = await Promise.all(
    endpoints.map(async (endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      hint: endpoint.hint,
      topics: endpoint.topics,
      enabled: endpoint.enabled,
      failingSince: endpoint.failingSince ? when(endpoint.failingSince) : null,
      failingOff: endpoint.disabledReason === "failing",
      deliveries: (await listEndpointDeliveries(store.id, endpoint.id)).map((d) => ({
        id: d.id,
        event: d.event,
        status: d.status,
        when: when(d.createdAt),
        problem: d.status === "delivered" || !d.lastError ? null : `${d.lastStatus ? `${d.lastStatus}: ` : ""}${d.lastError}`,
      })),
    })),
  );
  const slug = store.slug;
  const actions: EndpointActions = {
    add: addEndpointAction.bind(null, slug),
    update: updateEndpointAction.bind(null, slug),
    switchOn: switchEndpointAction.bind(null, slug),
    renew: renewSecretAction.bind(null, slug),
    remove: removeEndpointAction.bind(null, slug),
    test: testEndpointAction.bind(null, slug),
    resend: resendDeliveryAction.bind(null, slug),
  };

  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <div>
          <Link href={`/admin/${slug}/integrations`} className="text-sm underline">
            {w.back}
          </Link>
          <PageHeader title={w.title} description={<>{w.description}</>} />
        </div>
        {owner ? (
          <Card title={w.add} description={w.addHint}>
            <p className="mb-4 text-sm text-muted">{w.privacy}</p>
            <AddEndpoint topics={topics} defaults={DEFAULT_EVENTS} add={actions.add} />
          </Card>
        ) : (
          <p className="text-sm text-ink-2">{w.ownerOnly}</p>
        )}
        {views.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          views.map((endpoint) => <EndpointCard key={endpoint.id} endpoint={endpoint} topics={topics} owner={owner} actions={actions} />)
        )}
        <Card title={w.verifyTitle} compact>
          <div className="flex flex-col gap-2 text-sm text-ink-2">
            <p>{fillWords(w.verify, { id: ID_HEADER, timestamp: TIMESTAMP_HEADER, signature: SIGNATURE_HEADER })}</p>
            <p>{w.payload}</p>
          </div>
        </Card>
      </div>
    </AdminTextScope>
  );
}
