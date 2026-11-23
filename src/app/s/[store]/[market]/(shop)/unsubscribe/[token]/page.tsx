import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { preferenceWords } from "@/lib/email-preference-words";
import { t } from "@/lib/i18n";
import { topicName } from "@/lib/marketing-topics";
import { preferencesByToken } from "@/server/email-preferences";
import { resolveAfterSaleShop } from "@/server/shop";

import { emailChoiceAction } from "./actions";

type Props = PageProps<"/s/[store]/[market]/unsubscribe/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

const SECONDARY = "min-h-11 self-start rounded-button border border-border px-5 font-medium";

/**
 * The page every marketing email's foot links to (D295, email plan M4.2 D882), and a cart reminder's unsubscribe page (D33). A subscriber
 * chooses the topics they get and how often, pauses for a month, or unsubscribes from everything; a cart reminder's token only
 * unsubscribes. Buttons, not the link itself, change anything, so mail scanners that open links change nothing. No client script.
 */
export default function UnsubscribePage({ params, searchParams }: Props) {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-surface" />}>
        <Unsubscribe params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Unsubscribe({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const m = t(shop.market.lang);
  const pw = preferenceWords(shop.market.lang);
  const query = await searchParams;
  const prefs = await preferencesByToken(shop.store.id, token);
  const action = emailChoiceAction.bind(null, shop.store.slug, shop.market.slug, token);
  const heading = <h1 className="text-3xl font-heading tracking-tight">{prefs ? m.news.heading : m.unsubscribeTitle}</h1>;
  if (query.unknown)
    return (
      <>
        {heading}
        <p role="alert">{m.unsubscribeUnknown}</p>
      </>
    );
  // A cart reminder's token, or a subscriber who already left: only the unsubscribe answer and button.
  if (!prefs || prefs.status !== "subscribed") {
    return (
      <>
        {heading}
        {query.done || prefs?.status === "unsubscribed" ? (
          <p role="status">{prefs ? m.news.unsubscribed : m.unsubscribed}</p>
        ) : (
          <form action={action} className="flex flex-col gap-4">
            <p>{prefs ? m.news.unsubscribeIntro : m.unsubscribeIntro}</p>
            <button type="submit" name="do" value="unsubscribe" className="min-h-11 self-start button-primary px-5 font-medium">
              {m.unsubscribeButton}
            </button>
          </form>
        )}
      </>
    );
  }
  const main = shop.store.localization.locales[0] ?? shop.market.locale;
  const until = prefs.restUntil ? new Date(prefs.restUntil).toLocaleDateString(shop.market.locale, { dateStyle: "long", timeZone: shop.store.timeZone }) : null;
  const OFTEN = [
    ["all", pw.oftenAll],
    ["weekly", pw.oftenWeekly],
    ["monthly", pw.oftenMonthly],
  ] as const;
  return (
    <>
      {heading}
      {query.saved && <p role="status">{pw.saved}</p>}
      <form action={action} className="flex flex-col gap-5" data-preferences>
        <p>{pw.prefsIntro}</p>
        {prefs.topics.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 font-medium">{pw.topicsLegend}</legend>
            {prefs.topics.map((topic) => {
              const { name, line } = topicName(topic.names, shop.market.locale, main);
              return (
                <label key={topic.id} className="flex items-start gap-3">
                  <input type="checkbox" name="topic" value={topic.id} defaultChecked={topic.in} className="mt-1 size-4" />
                  <span className="flex flex-col">
                    <span>{name}</span>
                    {line && <span className="text-sm text-muted">{line}</span>}
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-medium">{pw.often}</legend>
          {OFTEN.map(([value, label]) => (
            <label key={value} className="flex items-center gap-3">
              <input type="radio" name="frequency" value={value} defaultChecked={prefs.frequency === value} className="size-4" />
              {label}
            </label>
          ))}
        </fieldset>
        <button type="submit" name="do" value="save" className="min-h-11 self-start button-primary px-5 font-medium">
          {pw.save}
        </button>
      </form>
      <form action={action} className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-xl font-heading">{pw.pauseHeading}</h2>
        {until ? (
          <>
            <p role="status">{pw.resting(until)}</p>
            <button type="submit" name="do" value="resume" className={SECONDARY}>
              {pw.resume}
            </button>
          </>
        ) : (
          <>
            <p>{pw.pauseText}</p>
            <button type="submit" name="do" value="pause" className={SECONDARY}>
              {pw.pauseButton}
            </button>
          </>
        )}
      </form>
      <form action={action} className="flex flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-xl font-heading">{pw.leaveHeading}</h2>
        <p>{m.news.unsubscribeIntro}</p>
        <button type="submit" name="do" value="unsubscribe" className={SECONDARY}>
          {m.unsubscribeButton}
        </button>
      </form>
    </>
  );
}
