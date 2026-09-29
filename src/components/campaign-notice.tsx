import { CampaignEnds } from "@/components/campaign-ends";
import { cardNotices, noticeText, type CampaignNotice } from "@/lib/campaign-notices";
import type { Messages } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";

/**
 * A store's campaigns on a product's page (D115): each with its name, what
 * it offers, that it is taken off in the cart, and until when. Plain HTML in
 * the page's cached shell.
 */
export function CampaignNotices({ notices, market, m }: { notices: CampaignNotice[]; market: Market; m: Messages }) {
  if (notices.length === 0) return null;
  const money = (minor: number) => formatMoney(minor, market.currency, market.locale);
  const date = (iso: string) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "long", timeZone: "Europe/Oslo" });
  return (
    <ul className="flex flex-col gap-2" aria-label={notices.map((notice) => notice.name).join(", ")}>
      {notices.map((notice) => (
        <CampaignEnds key={notice.id} endsAt={notice.endsAt}>
          <li className="rounded-lg bg-accent p-3 text-sm text-accent-foreground">
            <p className="font-medium">
              {notice.name}: {noticeText(notice, m, money)}
            </p>
            <p className="opacity-90">
              {m.campaigns.inCart}
              {notice.endsAt && ` ${m.campaigns.ends(date(notice.endsAt))}.`}
              {notice.signIn && ` ${m.campaigns.signIn}`}
            </p>
          </li>
        </CampaignEnds>
      ))}
    </ul>
  );
}

/** The campaign badges on a product card (D115): the offers on the price, two at most, over the picture's corner. */
export function CampaignBadge({ notices, m }: { notices: CampaignNotice[]; m: Messages }) {
  const shown = cardNotices(notices);
  if (shown.length === 0) return null;
  // A card carries offers on the price only, which need no amount.
  const money = () => "";
  return (
    <span className="pointer-events-none absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
      {shown.map((notice) => (
        <CampaignEnds key={notice.id} endsAt={notice.endsAt}>
          <span className="rounded-button bg-accent px-2 py-1 text-xs font-medium text-accent-foreground">{noticeText(notice, m, money)}</span>
        </CampaignEnds>
      ))}
    </span>
  );
}
