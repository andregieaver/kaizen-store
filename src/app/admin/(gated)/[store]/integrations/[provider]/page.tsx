import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { IntegrationMark } from "@/components/admin/integration-mark";
import { TestSendButton } from "@/components/admin/test-send-button";
import { EVENTS, INTEGRATIONS, isProvider } from "@/lib/integrations";
import { requireMember } from "@/server/auth";
import { getIntegration, listDeliveries, type DeliveryRow } from "@/server/integrations";

import { removeIntegrationAction, saveIntegrationAction, sendTestAction } from "../actions";

export const metadata: Metadata = { title: "Integration" };

const card = "rounded-lg border border-border bg-background p-5";
const STATUS: Record<DeliveryRow["status"], { text: string; tone: string }> = {
  delivered: { text: "Delivered", tone: "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" },
  pending: { text: "Trying again", tone: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  failed: { text: "Failed", tone: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

/** One integration (D41): how to connect it, what it gets, a test, and what was sent lately. */
export default async function IntegrationPage({ params }: PageProps<"/admin/[store]/integrations/[provider]">) {
  const { store: slug, provider } = await params;
  const { store, role } = await requireMember(slug);
  const info = INTEGRATIONS.find((i) => i.id === provider);
  if (!info || info.comingSoon || !isProvider(provider)) notFound();
  const [integration, deliveries] = await Promise.all([getIntegration(store.id, provider), listDeliveries(store.id, provider)]);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const owner = role === "owner";
  const chosen = new Set(integration?.events ?? ["order.paid", "order.sent", "order.refunded", "customer.created"]);
  const eventLabel = (id: string) => (id === "test" ? "Test" : (EVENTS.find((e) => e.id === id)?.label ?? id));

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/integrations`} className="text-sm underline">
          Integrations
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <IntegrationMark id={info.id} />
          <div>
            <h1 className="text-2xl font-semibold">{info.name}</h1>
            <p className="text-sm text-muted">
              {integration ? (integration.enabled ? `On · sending to ${integration.hint}` : `Off · address ${integration.hint}`) : "Not set up"}
            </p>
          </div>
        </div>
      </div>

      <section aria-labelledby="how" className={card}>
        <h2 id="how" className="mb-2 font-medium">How to connect</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          {info.steps?.map((step) => <li key={step}>{step}</li>)}
        </ol>
        {info.docs && (
          <p className="mt-3 text-sm">
            <a href={info.docs} target="_blank" rel="noreferrer" className="underline">
              {info.name}&apos;s guide to webhooks
            </a>
          </p>
        )}
      </section>

      <section aria-labelledby="settings" className={card}>
        <h2 id="settings" className="mb-1 font-medium">Settings</h2>
        <p className="mb-4 text-sm text-muted">
          Kaizen sends shoppers&apos; names, emails and addresses to {info.name}. Make sure your agreement with {info.name} covers
          personal data (a data processing agreement).
        </p>
        {owner ? (
          <ActionForm action={saveIntegrationAction.bind(null, store.slug, provider)} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor="webhook-url">{integration ? "New webhook address" : "Webhook address"}</label>
              <input
                id="webhook-url"
                name="url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                required={!integration}
                placeholder={info.example}
                aria-describedby="webhook-url-hint"
                className="min-h-10 rounded-md border border-border bg-background px-3 font-mono text-sm font-normal"
              />
              <p id="webhook-url-hint" className="font-normal text-muted">
                {integration
                  ? `Leave empty to keep sending to ${integration.hint}. The address is kept encrypted.`
                  : "The address is kept encrypted, and only ever sent to."}
              </p>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Events to send</legend>
              {EVENTS.map((event) => (
                <label key={event.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="events" value={event.id} defaultChecked={chosen.has(event.id)} className="mt-0.5 size-4" />
                  <span>
                    {event.label}
                    <span className="block text-xs text-muted">{event.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="enabled" defaultChecked={integration ? integration.enabled : true} className="size-4" />
              On: send these events as they happen
            </label>
            <div>
              <SubmitButton>{integration ? "Save" : `Connect ${info.name}`}</SubmitButton>
            </div>
          </ActionForm>
        ) : (
          <p className="text-sm">Only an owner can connect or change {info.name}.</p>
        )}
      </section>

      {integration && owner && (
        <section aria-labelledby="test" className={card}>
          <h2 id="test" className="mb-1 font-medium">Test</h2>
          <p className="mb-3 text-sm text-muted">
            Sends your latest order (or a sample one) now, marked as a test, so {info.name} can learn the fields. It is sent even while
            the integration is off.
          </p>
          <TestSendButton action={sendTestAction.bind(null, store.slug, provider)} />
        </section>
      )}

      {integration && (
        <section aria-labelledby="log" className={card}>
          <h2 id="log" className="mb-1 font-medium">Recently sent</h2>
          <p className="mb-3 text-sm text-muted">Events that did not get through are tried again for about eight hours.</p>
          {deliveries.length === 0 ? (
            <p className="text-sm text-muted">Nothing sent yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="py-2 pr-4 font-medium">Event</th>
                    <th scope="col" className="py-2 pr-4 font-medium">When</th>
                    <th scope="col" className="py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((d) => (
                    <tr key={d.id} className="border-b border-border align-top last:border-0">
                      <td className="py-2 pr-4">{eventLabel(d.event)}</td>
                      <td className="py-2 pr-4 whitespace-nowrap">{when(d.createdAt)}</td>
                      <td className="py-2">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS[d.status].tone}`}>{STATUS[d.status].text}</span>
                        {d.status !== "delivered" && d.lastError && (
                          <span className="block text-xs text-muted">
                            {d.lastStatus ? `${d.lastStatus}: ` : ""}
                            {d.lastError}
                            {d.status === "pending" && d.attempts > 0 && ` · next try ${when(d.nextAttemptAt)}`}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {integration && owner && (
        <DeleteDiscountButton
          action={removeIntegrationAction.bind(null, store.slug, provider)}
          code={info.name}
          question={`Disconnect ${info.name}? Kaizen stops sending to it and forgets the address.`}
          label={`Disconnect ${info.name}`}
        />
      )}
    </div>
  );
}
