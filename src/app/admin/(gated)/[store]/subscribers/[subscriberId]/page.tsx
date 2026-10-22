import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Button, Card, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import type { MarketingMessages } from "@/lib/admin-messages/marketing.en";
import { adminText } from "@/lib/admin-text";
import { SUBSCRIBE_SOURCES, type SubscribeSource, type UnsubscribeSource } from "@/lib/marketing-consent";
import { subscriberDetail } from "@/server/marketing-subscribers";
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
  const subscriber = await subscriberDetail(store.id, subscriberId);
  if (!subscriber) notFound();
  const lang = adminLangOf(member.account.adminLocale);
  const ws = adminText(lang, "marketing").subscribers;
  const when = (iso: string) => new Date(iso).toLocaleString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/subscribers`, label: ws.title }}
        title={subscriber.email}
        status={<Chip signal={subscriber.status === "subscribed" ? "positive" : subscriber.status === "pending" ? "warning" : "neutral"} dot>{ws.statuses[subscriber.status]}</Chip>}
        meta={[subscriber.name, subscriber.customer ? ws.hasAccount : null, subscriber.locale]}
        actions={
          subscriber.status !== "unsubscribed" && memberCan(member, "marketing:write") ? (
            <form action={unsubscribeAction.bind(null, store.slug, subscriber.id)}>
              <Button type="submit" kind="danger">
                {ws.unsubscribe}
              </Button>
            </form>
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
