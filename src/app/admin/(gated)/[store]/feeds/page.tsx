import type { Metadata } from "next";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { PhoneRow } from "@/components/admin/phone-row";
import { AdminTextScope } from "@/components/admin/admin-text";
import { FeedAddress } from "@/components/admin/feed-address";
import { requireFeature } from "@/components/admin/feature-off";
import { Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { FEED_CHANNELS, feedFileName, isAgentChannel } from "@/lib/feeds";
import { agentEndpoint, agentProfileUrl } from "@/lib/shopping-agents";
import { siteUrl } from "@/lib/site";
import { areaTexts } from "@/lib/admin-area";
import { MARKETING_WORDS } from "@/lib/admin-words/marketing";
import { feedSettingsOf } from "@/server/feed-settings";
import { storeFeed } from "@/server/feeds";
import { memberCan, requirePermission } from "@/server/permissions";
import { agentProblem } from "@/server/shopping-agents";

import { chatgptFeedAction, feedsOffAction, feedsOnAction, feedsRenewAction, shoppingAgentsAction } from "./actions";

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
  const w = MARKETING_WORDS[lang].feeds;
  const canWrite = memberCan(member, "marketing:write");
  const settings = await feedSettingsOf(store.id);
  const on = Boolean(settings?.on && settings.token);
  const feeds = on ? await Promise.all(store.markets.map(async (market) => ({ market, feed: await storeFeed(store, market) }))) : [];
  // An AI shopping channel's address only while its own switch is on (D353).
  const channels = FEED_CHANNELS.filter((channel) => !isAgentChannel(channel) || settings?.channels.includes(channel));
  const wa = w.agents;
  const agentBlock = agentProblem(store);
  const address = (market: string, channel: (typeof FEED_CHANNELS)[number]) =>
    `${siteUrl()}/api/feeds/${settings?.token ?? ""}/${feedFileName(market, channel)}`;

  // A row's one press on a phone (round 55, D806): the same action as the card's button.
  const row = (action: Parameters<typeof ActionForm>[0]["action"], done: string, label: string) => (
    <ActionForm action={action} successMessage={done}>
      <SubmitButton variant="secondary">{label}</SubmitButton>
    </ActionForm>
  );

  return (
    <AdminTextScope texts={areaTexts(lang, { marketing: MARKETING_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={<><span className="sm:hidden">{w.phone.lead}</span><span className="max-sm:hidden">{w.description}</span></>} />
        {/* Round 55 (D806): on a phone each switch is a row saying whether it is on, with its one press beside it; the card opens under it. */}
        <div className="flex flex-col gap-6 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-panel">
        <PhoneRow
          title={wa.title}
          sub={`${store.shoppingAgents ? w.phone.on : w.phone.off} · ${w.phone.agents}`}
          change={w.phone.open}
          done={w.phone.done}
          flat
          action={canWrite && !store.shoppingAgents ? row(shoppingAgentsAction.bind(null, store.slug, true), wa.turnedOn, w.phone.letIn) : undefined}
        >
          <Card title={wa.title} description={wa.description}>
            <div className="flex flex-col gap-3" data-shopping-agents={store.shoppingAgents ? "on" : "off"}>
              <p className="text-sm text-ink-2">{store.shoppingAgents ? wa.on : wa.off}</p>
              {store.shoppingAgents && agentBlock && agentBlock !== "off" && <p className="text-sm text-warning-text">{wa.blocked[agentBlock]}</p>}
              {store.shoppingAgents && agentBlock === null && (
                <>
                  <FeedAddress label={wa.profile} address={agentProfileUrl(store.slug)} />
                  <FeedAddress label={wa.endpoint} address={agentEndpoint(store.slug)} />
                </>
              )}
              {canWrite && (
                <ActionForm action={shoppingAgentsAction.bind(null, store.slug, !store.shoppingAgents)} successMessage={store.shoppingAgents ? wa.turnedOff : wa.turnedOn}>
                  <SubmitButton>{store.shoppingAgents ? wa.turnOff : wa.turnOn}</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Card>
        </PhoneRow>
        <PhoneRow
          title={wa.chatgpt}
          sub={`${settings?.channels.includes("openai") ? w.phone.on : w.phone.off} · ${w.phone.chatgpt}`}
          change={w.phone.open}
          done={w.phone.done}
          flat
          last
          action={canWrite && !settings?.channels.includes("openai") ? row(chatgptFeedAction.bind(null, store.slug, true), wa.chatgptTurnedOn, w.phone.turnOn) : undefined}
        >
          <Card title={wa.chatgpt} description={wa.chatgptNote}>
            {canWrite ? (
              <ActionForm
                action={chatgptFeedAction.bind(null, store.slug, !settings?.channels.includes("openai"))}
                successMessage={settings?.channels.includes("openai") ? wa.chatgptTurnedOff : wa.chatgptTurnedOn}
              >
                <SubmitButton>{settings?.channels.includes("openai") ? wa.chatgptOff : wa.chatgptOn}</SubmitButton>
              </ActionForm>
            ) : (
              <p className="text-sm text-muted">{settings?.channels.includes("openai") ? wa.chatgptTurnedOn : wa.chatgptTurnedOff}</p>
            )}
          </Card>
        </PhoneRow>
        {!on ? (
          <div className="max-sm:order-first max-sm:border-b max-sm:border-line">
          <PhoneRow
            title={w.title}
            sub={`${w.phone.off} · ${w.phone.feeds}`}
            change={w.phone.open}
            done={w.phone.done}
            flat
            last
            action={canWrite ? row(feedsOnAction.bind(null, store.slug), w.on, w.phone.turnOn) : undefined}
          >
              <Card title={w.off}>
                {canWrite ? (
                  <ActionForm action={feedsOnAction.bind(null, store.slug)} successMessage={w.on}>
                    <SubmitButton>{w.turnOn}</SubmitButton>
                  </ActionForm>
                ) : (
                  <p className="text-sm text-muted">{w.readOnly}</p>
                )}
              </Card>
          </PhoneRow>
          </div>
        ) : null}
        </div>
        {on ? (
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
                  {channels.map((channel) => (
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
        ) : null}
      </div>
    </AdminTextScope>
  );
}
