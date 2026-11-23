import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { engagementLevel } from "@/lib/engagement";

import { AdminLink, Button, Card, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { QuietActionForm } from "@/components/admin/quiet-action-form";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import type { MarketingMessages } from "@/lib/admin-messages/marketing.en";
import { SUBSCRIBE_SOURCES, type SubscribeSource, type UnsubscribeSource } from "@/lib/marketing-consent";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { subscriberDetail } from "@/server/marketing-subscribers";
import { readerChoices } from "@/server/marketing-topics";
import { topicName } from "@/lib/marketing-topics";
import { memberCan, requirePermission } from "@/server/permissions";

import { unsubscribeAction } from "../actions";

export const metadata: Metadata = { title: "Subscriber" };

const sourceWords = (source: string, w: MarketingMessages["subscribers"]): string =>
  (SUBSCRIBE_SOURCES as readonly string[]).includes(source) ? w.sources[source as SubscribeSource] : (w.leftBy[source as UnsubscribeSource] ?? source);

/** One subscriber (D295): what they agreed to, when and how, the whole history, and *Unsubscribe* for a person who asked by other means. */
export default async function SubscriberPage({ params }: PageProps<"/admin/[store]/subscribers/[subscriberId]">) {
  const { store: slug, subscriberId } = await params;
  const member = await requirePermission(slug, "marketing:read");
  const { store } = member;
  const [subscriber, choices] = await Promise.all([subscriberDetail(store.id, subscriberId), readerChoices(store.id, subscriberId)]);
  if (!subscriber) notFound();
  const main = store.localization.locales[0] ?? "en-GB";
  const lang = adminLangOf(member.account.adminLocale);
  const ws = MARKETING_WORDS[lang].subscribers;
  const wt = MARKETING_WORDS[lang].topics;
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/subscribers`, label: ws.title }}
        title={subscriber.email}
        status={<Chip signal={subscriber.status === "subscribed" ? "positive" : subscriber.status === "pending" ? "warning" : "neutral"} dot>{ws.statuses[subscriber.status]}</Chip>}
        meta={[
          subscriber.name,
          subscriber.customer ? ws.hasAccount : null,
          subscriber.locale,
          // Their engagement in words (M2.8), from their latest press on a link.
          subscriber.status === "subscribed" ? ws.engagement[engagementLevel(subscriber.joinedAt, subscriber.lastClickAt, new Date(), subscriber.pausedAt)] : null,
        ]}
        actions={
          subscriber.status !== "unsubscribed" && memberCan(member, "marketing:write") ? (
            <QuietActionForm action={unsubscribeAction.bind(null, store.slug, subscriber.id)}>
              <Button type="submit" kind="danger">
                {ws.unsubscribe}
              </Button>
            </QuietActionForm>
          ) : undefined
        }
      />

      <Card title={ws.agreedTo} compact>
        <blockquote className="border-l-2 border-line pl-4 text-body text-ink">{subscriber.consentText}</blockquote>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-body sm:grid-cols-2">
          <div>
            <dt className="text-caption text-muted">{ws.from}</dt>
            <dd className="text-ink">{ws.sources[subscriber.source]}</dd>
          </div>
          {subscriber.form && (
            // Which form and page they signed up by (D850); the form opens in its editor while it exists.
            <>
              <div>
                <dt className="text-caption text-muted">{ws.joinedWith}</dt>
                <dd className="text-ink" data-subscriber-form>
                  {subscriber.form.name ? (
                    <AdminLink href={subscriber.formPlatform ? `/admin/platform/forms/${subscriber.form.id}` : `/admin/${store.slug}/forms/${subscriber.form.id}`} className="underline">
                      {subscriber.form.name}
                    </AdminLink>
                  ) : /^[0-9a-f-]{36}$/.test(subscriber.form.id) ? (
                    ws.formGone
                  ) : (
                    ws.pageForm
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-caption text-muted">{ws.joinedOn}</dt>
                <dd className="break-all text-ink" data-subscriber-page>
                  {subscriber.path ?? <span className="text-muted">{ws.pageNotKept}</span>}
                </dd>
              </div>
            </>
          )}
          <div>
            <dt className="text-caption text-muted">{ws.when}</dt>
            <dd className="text-ink">{when(subscriber.consentedAt)}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted">{ws.confirmed}</dt>
            <dd className="text-ink">
              {subscriber.confirmedAt
                ? when(subscriber.confirmedAt)
                : subscriber.customer && subscriber.source !== "form"
                  ? ws.notNeeded
                  : subscriber.status === "pending"
                    ? ws.notYet
                    : ws.switchedOff}
            </dd>
          </div>
          {subscriber.unsubscribedAt && (
            <div>
              <dt className="text-caption text-muted">{ws.left}</dt>
              <dd className="text-ink">
                {when(subscriber.unsubscribedAt)}
                {subscriber.unsubscribeSource && ` · ${ws.leftBy[subscriber.unsubscribeSource]}`}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      {/* Their own choices (M4.2, D882): topics now, how often, a month's pause, and every topic choice as it was made. */}
      {choices && subscriber.status === "subscribed" && (
        <Card title={wt.readerTitle} compact>
          <dl className="grid grid-cols-1 gap-3 text-body sm:grid-cols-2" data-reader-choices>
            {choices.topics.length > 0 && (
              <div>
                <dt className="text-caption text-muted">{wt.readerTopics}</dt>
                <dd className="text-ink">
                  {choices.topics.filter((t) => t.in).map((t) => topicName(t.names, main, main).name).join(", ") || wt.readerNone}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-caption text-muted">{wt.readerOften}</dt>
              <dd className="text-ink">
                {wt.often[choices.frequency]}
                {choices.restUntil && ` · ${wt.restingUntil.replace("{date}", when(choices.restUntil))}`}
              </dd>
            </div>
          </dl>
        </Card>
      )}
      {choices && choices.record.length > 0 && (
        <Card title={wt.recordTitle} compact>
          <List label={wt.recordTitle}>
            {choices.record.map((c, index) => (
              <ListRow key={index}>
                <RowLead
                  title={(c.optedIn ? wt.chose.in : wt.chose.out).replace("{topic}", topicName(c.names, main, main).name)}
                  sub={[wt.sources[c.source], c.words].filter(Boolean).join(" · ")}
                />
                <RowFact>{when(c.at)}</RowFact>
              </ListRow>
            ))}
          </List>
        </Card>
      )}

      <Card title={ws.history} compact>
        <List label={ws.history}>
          {subscriber.history.map((event, index) => (
            <ListRow key={index}>
              <RowLead title={ws.events[event.kind]} sub={[sourceWords(event.source, ws), event.consentText].filter(Boolean).join(" · ")} />
              <RowFact>{when(event.at)}</RowFact>
            </ListRow>
          ))}
        </List>
      </Card>
    </div>
  );
}
