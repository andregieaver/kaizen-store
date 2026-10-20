import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Button, Card, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { SOURCE_WORDS, STATUS_WORDS, UNSUBSCRIBE_WORDS, type SubscribeSource, type UnsubscribeSource } from "@/lib/marketing-consent";
import { subscriberDetail } from "@/server/marketing-subscribers";
import { memberCan, requirePermission } from "@/server/permissions";

import { unsubscribeAction } from "../actions";

export const metadata: Metadata = { title: "Subscriber" };

const KIND_WORDS = { requested: "Asked to join, link sent", subscribed: "Subscribed", unsubscribed: "Left" } as const;

const sourceWords = (source: string): string =>
  source in SOURCE_WORDS ? SOURCE_WORDS[source as SubscribeSource] : (UNSUBSCRIBE_WORDS[source as UnsubscribeSource] ?? source);

/** One subscriber (D295): what they agreed to, when and how, the whole history, and *Unsubscribe* for a person who asked by other means. */
export default async function SubscriberPage({ params }: PageProps<"/admin/[store]/subscribers/[subscriberId]">) {
  const { store: slug, subscriberId } = await params;
  const member = await requirePermission(slug, "marketing:read");
  const { store } = member;
  const subscriber = await subscriberDetail(store.id, subscriberId);
  if (!subscriber) notFound();
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/subscribers`, label: "Subscribers" }}
        title={subscriber.email}
        status={<Chip signal={subscriber.status === "subscribed" ? "positive" : subscriber.status === "pending" ? "warning" : "neutral"} dot>{STATUS_WORDS[subscriber.status]}</Chip>}
        meta={[subscriber.name, subscriber.customer ? "Has an account" : null, subscriber.locale]}
        actions={
          subscriber.status !== "unsubscribed" && memberCan(member, "marketing:write") ? (
            <form action={unsubscribeAction.bind(null, store.slug, subscriber.id)}>
              <Button type="submit" kind="danger">
                Unsubscribe
              </Button>
            </form>
          ) : undefined
        }
      />

      <Card title="What they agreed to" compact>
        <blockquote className="border-l-2 border-line pl-4 text-body text-ink">{subscriber.consentText}</blockquote>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-body sm:grid-cols-2">
          <div>
            <dt className="text-caption text-muted">From</dt>
            <dd className="text-ink">{SOURCE_WORDS[subscriber.source]}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted">When</dt>
            <dd className="text-ink">{when(subscriber.consentedAt)}</dd>
          </div>
          <div>
            <dt className="text-caption text-muted">Confirmed by email</dt>
            <dd className="text-ink">
              {subscriber.confirmedAt
                ? when(subscriber.confirmedAt)
                : subscriber.customer && subscriber.source !== "form"
                  ? "Not needed: signed in with a verified email"
                  : subscriber.status === "pending"
                    ? "Not yet"
                    : "No: the form's confirmation was switched off"}
            </dd>
          </div>
          {subscriber.unsubscribedAt && (
            <div>
              <dt className="text-caption text-muted">Left</dt>
              <dd className="text-ink">
                {when(subscriber.unsubscribedAt)}
                {subscriber.unsubscribeSource && ` · ${UNSUBSCRIBE_WORDS[subscriber.unsubscribeSource]}`}
              </dd>
            </div>
          )}
        </dl>
      </Card>

      <Card title="History" compact>
        <List label="History">
          {subscriber.history.map((event, index) => (
            <ListRow key={index}>
              <RowLead title={KIND_WORDS[event.kind]} sub={[sourceWords(event.source), event.consentText].filter(Boolean).join(" · ")} />
              <RowFact>{when(event.at)}</RowFact>
            </ListRow>
          ))}
        </List>
      </Card>
    </div>
  );
}
