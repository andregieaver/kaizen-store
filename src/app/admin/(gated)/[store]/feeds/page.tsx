import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AdminTextScope } from "@/components/admin/admin-text";
import { FeedAddress } from "@/components/admin/feed-address";
import { requireFeature } from "@/components/admin/feature-off";
import { Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { FEED_CHANNELS, feedFileName } from "@/lib/feeds";
import { siteUrl } from "@/lib/site";
import { feedSettingsOf } from "@/server/feed-settings";
import { storeFeed } from "@/server/feeds";
import { memberCan, requirePermission } from "@/server/permissions";

import { feedsOffAction, feedsOnAction, feedsRenewAction } from "./actions";

export const metadata: Metadata = { title: "Product feeds" };

/**
 * The store's product feeds (wave 5 unit H, D302, `docs/wave-5-marketing.md` 13): Homer sees a switch and, when on, an address per country and
 * channel to paste into the channel's own account; Lisa sees what is left out of each country's feed and why, and can make a new address.
 */
export default async function FeedsPage({ params }: PageProps<"/admin/[store]/feeds">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "marketing").feeds;
  const canWrite = memberCan(member, "marketing:write");
  const settings = await feedSettingsOf(store.id);
  const on = Boolean(settings?.on && settings.token);
  const feeds = on ? await Promise.all(store.markets.map(async (market) => ({ market, feed: await storeFeed(store, market) }))) : [];
  const address = (market: string, channel: (typeof FEED_CHANNELS)[number]) =>
    `${siteUrl()}/api/feeds/${settings?.token ?? ""}/${feedFileName(market, channel)}`;

  return (
    <AdminTextScope texts={adminTexts(lang, ["marketing"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={w.description} />
        {!on ? (
          <Card title={w.off}>
            {canWrite ? (
              <ActionForm action={feedsOnAction.bind(null, store.slug)} successMessage={w.on}>
                <SubmitButton>{w.turnOn}</SubmitButton>
              </ActionForm>
            ) : (
              <p className="text-sm text-muted">{w.readOnly}</p>
            )}
          </Card>
        ) : (
          <>
            {feeds.map(({ market, feed }) => (
              <Card
                key={market.slug}
                title={market.name}
                description={fillWords(w.counts, {
                  items: String(feed.items.length),
                  products: String(new Set(feed.items.map((i) => i.groupId)).size),
                  market: market.name,
                })}
              >
                <div className="flex flex-col gap-3">
                  <p className="text-eyebrow">{w.addresses}</p>
                  {FEED_CHANNELS.map((channel) => (
                    <FeedAddress key={channel} label={w.channels[channel]} address={address(market.slug, channel)} />
                  ))}
                  <p className="text-sm text-muted">{w.refresh}</p>
                  <details className="text-sm">
                    <summary className="cursor-pointer text-ink-2">
                      {w.leftOutTitle} ({feed.leftOut.length})
                    </summary>
                    {feed.leftOut.length === 0 ? (
                      <p className="mt-2 text-muted">{fillWords(w.leftOutNone, { market: market.name })}</p>
                    ) : (
                      <div className="mt-2">
                        <p className="text-muted">{fillWords(w.leftOutIntro, { market: market.name })}</p>
                        <ul className="mt-1 list-disc pl-5">
                          {feed.leftOut.map((p) => (
                            <li key={p.productId}>
                              {p.title}: {p.problems.map((problem) => w.problems[problem]).join(", ")}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </details>
                </div>
              </Card>
            ))}
            {canWrite ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-ink-2">{w.renew}</summary>
                <div className="mt-2 flex flex-col gap-2">
                  <p className="text-muted">{w.renewNote}</p>
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={feedsRenewAction.bind(null, store.slug)} successMessage={w.renewed}>
                      <SubmitButton>{w.renew}</SubmitButton>
                    </ActionForm>
                    <ActionForm action={feedsOffAction.bind(null, store.slug)} successMessage={w.turnedOff}>
                      <SubmitButton>{w.turnOff}</SubmitButton>
                    </ActionForm>
                  </div>
                </div>
              </details>
            ) : null}
          </>
        )}
      </div>
    </AdminTextScope>
  );
}
