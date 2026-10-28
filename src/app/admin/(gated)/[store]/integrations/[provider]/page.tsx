import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { IntegrationMark } from "@/components/admin/integration-mark";
import { TestSendButton } from "@/components/admin/test-send-button";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { EVENTS, INTEGRATIONS, isProvider, SERVICE_EVENTS } from "@/lib/integrations";
import { featureOn } from "@/lib/store-features";
import { memberCan, requirePermission } from "@/server/permissions";
import { DEFAULT_EVENTS, getIntegration, listDeliveries, type DeliveryRow } from "@/server/integrations";
import { slackAppOn } from "@/server/slack";
import { Chip, List, ListRow, PageHeader, RowDate, RowLead } from "@/components/admin/ui";

import { connectSlackAction, removeIntegrationAction, saveIntegrationAction, sendTestAction } from "../actions";

export const metadata: Metadata = { title: "Integration" };

const card = "rounded-lg border border-line bg-card p-5";
const SIGNAL: Record<DeliveryRow["status"], "positive" | "warning" | "danger"> = { delivered: "positive", pending: "warning", failed: "danger" };

/** What came back from "Add to Slack" (D101): whether it went well, by the address's answer. */
const SLACK_RETURN: Record<string, boolean> = { connected: true, cancelled: false, failed: false };

/** One integration (D41, Slack D101): how to connect it, what it gets, a test, and what was sent lately. */
export default async function IntegrationPage({ params, searchParams }: PageProps<"/admin/[store]/integrations/[provider]">) {
  const { store: slug, provider } = await params;
  const answer = provider === "slack" ? String((await searchParams).slack ?? "") : "";
  const current = await requirePermission(slug, "settings:read");
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const all = adminText(lang, "notifications");
  const w = all.integrations.provider;
  const returned = answer in SLACK_RETURN ? { ok: SLACK_RETURN[answer], text: w.slackReturn[answer as keyof typeof w.slackReturn] } : undefined;
  const subscriptionsOn = featureOn(store, "subscriptions");
  const info = INTEGRATIONS.find((i) => i.id === provider);
  if (!info || info.comingSoon || !isProvider(provider)) notFound();
  const [integration, deliveries] = await Promise.all([getIntegration(store.id, provider), listDeliveries(store.id, provider)]);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const owner = memberCan(current, "owner");
  const chosen = new Set(integration?.events ?? DEFAULT_EVENTS);
  const slack = provider === "slack";
  const addToSlack = slack && owner && slackAppOn();
  const eventLabel = (id: string) =>
    id === "test" ? w.testEvent : id === "assistant.message" ? w.assistantEvent : (all.integrations.events[id]?.label ?? EVENTS.find((e) => e.id === id)?.label ?? id);
  const steps = all.integrations.infos[info.id]?.steps ?? info.steps ?? [];

  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/integrations`} className="text-sm underline">
          {w.back}
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <IntegrationMark id={info.id} />
          <PageHeader
            title={<>{info.name}</>}
            description={<>{integration ? fillWords(integration.enabled ? w.sendingTo : w.offAddress, { hint: integration.hint }) : w.notSetUp}</>}
          />
        </div>
      </div>

      {returned && (
        <p
          role={returned.ok ? "status" : "alert"}
          className={`rounded-md px-4 py-3 text-sm ${returned.ok ? "bg-positive-soft text-positive-text " : "bg-warning-soft text-warning-text "}`}
        >
          {returned.text}
        </p>
      )}

      {addToSlack && (
        <section aria-labelledby="add-to-slack" className={card}>
          <h2 id="add-to-slack" className="mb-1 text-title text-ink">
            {integration ? w.changeChannel : w.addToSlack}
          </h2>
          <p className="mb-3 text-sm text-muted">{w.slackAsks}</p>
          <form action={connectSlackAction.bind(null, store.slug)}>
            <button type="submit" className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink">
              {integration ? w.otherChannel : w.addToSlack}
            </button>
          </form>
        </section>
      )}

      <section aria-labelledby="how" className={card}>
        <h2 id="how" className="mb-2 text-title text-ink">{addToSlack ? w.orYourself : w.how}</h2>
        <ol className="flex list-decimal flex-col gap-1 pl-5 text-sm">
          {steps.map((step) => <li key={step}>{step}</li>)}
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
        <h2 id="settings" className="mb-1 text-title text-ink">{w.settings}</h2>
        <p className="mb-4 text-sm text-muted">
          {slack ? w.slackPrivacy : fillWords(w.privacy, { name: info.name })}
        </p>
        {owner ? (
          <ActionForm action={saveIntegrationAction.bind(null, store.slug, provider)} className="flex flex-col gap-5">
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
              {/* Subscriptions' events are offered while that feature is on (D178); one already chosen is kept as it is while it is off. */}
              {SERVICE_EVENTS.filter((event) => !event.id.startsWith("subscription.") || subscriptionsOn).map((event) => (
                <label key={event.id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="events" value={event.id} defaultChecked={chosen.has(event.id)} className="mt-0.5 size-4" />
                  <span>
                    {all.integrations.events[event.id]?.label ?? event.label}
                    <span className="block text-xs text-muted">{all.integrations.events[event.id]?.hint ?? event.hint}</span>
                  </span>
                </label>
              ))}
              {!subscriptionsOn &&
                SERVICE_EVENTS.filter((event) => event.id.startsWith("subscription.") && chosen.has(event.id)).map((event) => (
                  <input key={event.id} type="hidden" name="events" value={event.id} />
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
        ) : (
          <p className="text-sm">{fillWords(w.ownerOnly, { name: info.name })}</p>
        )}
      </section>

      {integration && owner && (
        <section aria-labelledby="test" className={card}>
          <h2 id="test" className="mb-1 text-title text-ink">{w.test}</h2>
          <p className="mb-3 text-sm text-muted">
            {slack ? w.slackTest : fillWords(w.testHint, { name: info.name })}
          </p>
          <TestSendButton action={sendTestAction.bind(null, store.slug, provider)} />
        </section>
      )}

      {integration && (
        <section aria-labelledby="log" className={card}>
          <h2 id="log" className="mb-1 text-title text-ink">{w.recent}</h2>
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

      {integration && owner && (
        <DeleteDiscountButton
          action={removeIntegrationAction.bind(null, store.slug, provider)}
          code={info.name}
          question={slack ? w.disconnectSlack : fillWords(w.disconnectQuestion, { name: info.name })}
          label={fillWords(w.disconnect, { name: info.name })}
        />
      )}
    </div>
    </AdminTextScope>
  );
}
