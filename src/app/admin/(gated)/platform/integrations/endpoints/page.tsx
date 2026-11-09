import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { Card, PageHeader } from "@/components/admin/ui";
import { AddEndpoint, EndpointCard, type EndpointActions, type EndpointView } from "@/components/admin/webhook-endpoints";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { DEFAULT_PLATFORM_EVENTS, PLATFORM_EVENTS } from "@/lib/platform-integrations";
import { ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/webhook-signature";
import { platformCan, requirePlatformReader } from "@/server/auth";
import { listPlatformEndpointDeliveries, listPlatformEndpoints } from "@/server/platform-endpoints";

import {
  addPlatformEndpointAction,
  removePlatformEndpointAction,
  renewPlatformSecretAction,
  resendPlatformDeliveryAction,
  switchPlatformEndpointAction,
  testPlatformEndpointAction,
  updatePlatformEndpointAction,
} from "./actions";

export const metadata: Metadata = { title: "Your own endpoints" };

/**
 * Kaizena Flow's own endpoints (C4, D515): a store's own endpoints (D354) for the platform's events. A platform owner adds one, chooses its
 * events, sees its secret once, tests it and sends a delivery again; every role on the team reads them.
 */
export default async function PlatformEndpointsPage() {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const all = adminText(lang, "notifications").integrations;
  const w = all.endpoints;
  const own = adminText(lang, "platform").integrations;
  const owner = platformCan(admin, "settings");
  const topics = PLATFORM_EVENTS.map((event) => ({ id: event, label: own.events[event]?.label ?? event, hint: own.events[event]?.hint ?? "" }));
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const endpoints = await listPlatformEndpoints();
  const views: EndpointView[] = await Promise.all(
    endpoints.map(async (endpoint) => ({
      id: endpoint.id,
      name: endpoint.name,
      hint: endpoint.hint,
      topics: endpoint.topics,
      enabled: endpoint.enabled,
      failingSince: endpoint.failingSince ? when(endpoint.failingSince) : null,
      failingOff: endpoint.disabledReason === "failing",
      deliveries: (await listPlatformEndpointDeliveries(endpoint.id)).map((d) => ({
        id: d.id,
        event: d.event,
        status: d.status,
        when: when(d.createdAt),
        problem: d.status === "delivered" || !d.lastError ? null : `${d.lastStatus ? `${d.lastStatus}: ` : ""}${d.lastError}`,
      })),
    })),
  );
  const actions: EndpointActions = {
    add: addPlatformEndpointAction,
    update: updatePlatformEndpointAction,
    switchOn: switchPlatformEndpointAction,
    renew: renewPlatformSecretAction,
    remove: removePlatformEndpointAction,
    test: testPlatformEndpointAction,
    resend: resendPlatformDeliveryAction,
  };

  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <div>
          <Link href="/admin/platform/integrations" className="text-sm underline">
            {w.back}
          </Link>
          <PageHeader title={w.title} description={<>{w.description}</>} />
        </div>
        {owner ? (
          <Card title={w.add} description={w.addHint}>
            <p className="mb-4 text-sm text-muted">{own.endpointsPrivacy}</p>
            <AddEndpoint topics={topics} defaults={[...DEFAULT_PLATFORM_EVENTS]} add={actions.add} />
          </Card>
        ) : (
          <p className="text-sm text-ink-2">{own.endpointsOwnerOnly}</p>
        )}
        {views.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          views.map((endpoint) => <EndpointCard key={endpoint.id} endpoint={endpoint} topics={topics} owner={owner} actions={actions} />)
        )}
        <Card title={w.verifyTitle} compact>
          <div className="flex flex-col gap-2 text-sm text-ink-2">
            <p>{fillWords(w.verify, { id: ID_HEADER, timestamp: TIMESTAMP_HEADER, signature: SIGNATURE_HEADER })}</p>
            <p>{own.endpointsPayload}</p>
          </div>
        </Card>
      </div>
    </AdminTextScope>
  );
}
