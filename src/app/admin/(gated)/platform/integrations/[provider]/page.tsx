import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { IntegrationMark } from "@/components/admin/integration-mark";
import { TestSendButton } from "@/components/admin/test-send-button";
import { Chip, List, ListRow, PageHeader, RowDate, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { INTEGRATIONS, isProvider } from "@/lib/integrations";
import { PLATFORM_EVENTS } from "@/lib/platform-integrations";
import { requirePlatformReader } from "@/server/auth";
import { getPlatformIntegration, listPlatformDeliveries, platformDefaultEvents, type PlatformDeliveryRow } from "@/server/platform-integrations";

import { removePlatformIntegrationAction, savePlatformIntegrationAction, sendPlatformTestAction } from "../actions";

export const metadata: Metadata = { title: "Integration" };

const card = "rounded-lg border border-line bg-card p-5";
const SIGNAL: Record<PlatformDeliveryRow["status"], "positive" | "warning" | "danger"> = { delivered: "positive", pending: "warning", failed: "danger" };

/**
 * One of Kaizena Flow's own integrations (D465): how to make the service's webhook, which platform events it gets, a test, and what was sent
 * lately. The store's page (D41) is the model; the words they share are the store's, the events and what is sent are the platform's.
 */
export default async function PlatformIntegrationPage({ params }: PageProps<"/admin/platform/integrations/[provider]">) {
  await connection();
  const { provider } = await params;
  const admin = await requirePlatformReader();
  const info = INTEGRATIONS.find((i) => i.id === provider);
  if (!info || info.comingSoon || !isProvider(provider)) notFound();
  const lang = adminLangOf(admin.adminLocale);
  const all = adminText(lang, "notifications");
  const w = all.integrations.provider;
  const own = adminText(lang, "platform").integrations;
  const [integration, deliveries] = await Promise.all([getPlatformIntegration(provider), listPlatformDeliveries(provider)]);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const chosen = new Set<string>(integration?.events ?? platformDefaultEvents());
  const slack = provider === "slack";
  const eventLabel = (id: string) => (id === "test" ? w.testEvent : (own.events[id]?.label ?? id));
  const steps = all.integrations.infos[info.id]?.steps ?? info.steps ?? [];

  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
      <div className="flex flex-col gap-6">
        <div>
          <Link href="/admin/platform/integrations" className="text-sm underline">
            {own.title}
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <IntegrationMark id={info.id} />
            <PageHeader
              title={<>{info.name}</>}
              description={<>{integration ? fillWords(integration.enabled ? w.sendingTo : w.offAddress, { hint: integration.hint }) : w.notSetUp}</>}
            />
          </div>
        </div>

        <section aria-labelledby="how" className={card}>
          <h2 id="how" className="mb-2 text-title text-ink">
            {w.how}
          </h2>
          <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
            {steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {info.docs && (
            <p className="mt-3 text-sm">
              <a href={info.docs} target="_blank" rel="noreferrer" className="underline">
                {fillWords(slack ? w.guideHooks : w.guide, { name: info.name })}
              </a>
            </p>
          )}
        </section>

        <section aria-labelledby="settings" className={card}>
          <h2 id="settings" className="mb-1 text-title text-ink">
            {w.settings}
          </h2>
          <p className="mb-4 text-sm text-muted">{slack ? own.slackPrivacy : fillWords(own.privacy, { name: info.name })}</p>
          <ActionForm action={savePlatformIntegrationAction.bind(null, provider)} className="flex flex-col gap-5">
            <div className="flex flex-col gap-1 text-sm font-medium">
              <label htmlFor="webhook-url">{integration ? w.newAddress : w.address}</label>
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
                className="min-h-10 rounded-md border border-line bg-card px-3 font-mono text-sm font-normal"
              />
              <p id="webhook-url-hint" className="font-normal text-muted">
                {integration ? fillWords(w.keepHint, { hint: integration.hint }) : w.newHint}
              </p>
            </div>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">{w.events}</legend>
              {PLATFORM_EVENTS.map((event) => (
                <label key={event} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="events" value={event} defaultChecked={chosen.has(event)} className="mt-0.5 size-4" />
                  <span>
                    {own.events[event]?.label ?? event}
                    <span className="block text-xs text-muted">{own.events[event]?.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="enabled" defaultChecked={integration ? integration.enabled : true} className="size-4" />
              {w.enabled}
            </label>
            <div>
              <SubmitButton>{integration ? all.common.save : fillWords(w.connect, { name: info.name })}</SubmitButton>
            </div>
          </ActionForm>
        </section>

        {integration && (
          <section aria-labelledby="test" className={card}>
            <h2 id="test" className="mb-1 text-title text-ink">
              {w.test}
            </h2>
            <p className="mb-3 text-sm text-muted">{slack ? own.slackTest : fillWords(own.testHint, { name: info.name })}</p>
            <TestSendButton action={sendPlatformTestAction.bind(null, provider)} />
          </section>
        )}

        {integration && (
          <section aria-labelledby="log" className={card}>
            <h2 id="log" className="mb-1 text-title text-ink">
              {w.recent}
            </h2>
            <p className="mb-3 text-sm text-muted">{w.recentHint}</p>
            {deliveries.length === 0 ? (
              <p className="text-sm text-muted">{w.nothing}</p>
            ) : (
              <List label={w.eventsSent}>
                {deliveries.map((d) => (
                  <ListRow key={d.id}>
                    <RowLead
                      title={eventLabel(d.event)}
                      sub={
                        d.status !== "delivered" && d.lastError ? (
                          <>
                            {d.lastStatus ? `${d.lastStatus}: ` : ""}
                            {d.lastError}
                            {d.status === "pending" && d.attempts > 0 && fillWords(w.nextTry, { when: when(d.nextAttemptAt) })}
                          </>
                        ) : undefined
                      }
                    />
                    <RowDate>{when(d.createdAt)}</RowDate>
                    <Chip signal={SIGNAL[d.status]} dot>
                      {w.statuses[d.status]}
                    </Chip>
                  </ListRow>
                ))}
              </List>
            )}
          </section>
        )}

        {integration && (
          <DeleteDiscountButton
            action={removePlatformIntegrationAction.bind(null, provider)}
            code={info.name}
            question={fillWords(w.disconnectQuestion, { name: info.name })}
            label={fillWords(w.disconnect, { name: info.name })}
          />
        )}
      </div>
    </AdminTextScope>
  );
}
