import { CampaignEditor, type CampaignDraft } from "@/components/admin/campaign-editor";
import type { Campaign } from "@/lib/campaigns";
import { formatPriceInput } from "@/lib/product-input";
import { mainCurrency } from "@/lib/markets";
import { listGiftChoices } from "@/server/campaigns";
import { listProductChoices } from "@/server/discounts";
import { listTerms } from "@/server/taxonomy";
import type { Store } from "@/server/stores";

import { saveCampaignAction } from "./actions";

/** `datetime-local` text for a time, in Norwegian time. */
function osloLocal(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date(iso))
    .replace(" ", "T");
}

/** The editor for a new campaign or an existing one, with the store's markets, products, categories and tags. */
export async function CampaignForm({ store, campaign, orders = 0 }: { store: Store; campaign: Campaign | null; orders?: number }) {
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const [products, terms, gifts] = await Promise.all([
    listProductChoices(store.id, locale),
    listTerms({ storeId: store.id, contentType: "product" }),
    listGiftChoices(store.id, locale),
  ]);
  const currency = (code: string) => store.markets.find((m) => m.code === code)?.currency ?? mainCurrency(store);
  const initial: CampaignDraft = campaign
    ? {
        name: campaign.name,
        kind: campaign.kind,
        percent: campaign.kind === "percent" ? String(campaign.percent) : "10",
        buyQuantity: campaign.kind === "multi_buy" ? String(campaign.buyQuantity) : "3",
        payQuantity: campaign.kind === "multi_buy" ? String(campaign.payQuantity) : "2",
        giftVariantId: campaign.giftVariantId ?? "",
        giftQuantity: String(campaign.giftQuantity),
        thresholds: Object.fromEntries(Object.entries(campaign.thresholds).map(([code, minor]) => [code, formatPriceInput(minor, currency(code))])),
        scope: campaign.productIds.length + campaign.termIds.length > 0 ? "some" : "all",
        productIds: campaign.productIds,
        termIds: campaign.termIds,
        startsAt: osloLocal(campaign.startsAt),
        endsAt: osloLocal(campaign.endsAt),
        active: campaign.active,
      }
    : {
        name: "",
        kind: "percent",
        percent: "20",
        buyQuantity: "3",
        payQuantity: "2",
        giftVariantId: "",
        giftQuantity: "1",
        thresholds: {},
        scope: "all",
        productIds: [],
        termIds: [],
        startsAt: "",
        endsAt: "",
        active: true,
      };
  return (
    <CampaignEditor
      initial={initial}
      markets={store.markets.map((m) => ({ code: m.code, name: m.name, currency: m.currency }))}
      products={products}
      terms={terms.map((t) => ({ id: t.id, name: t.name, kind: t.kind, parentId: t.parentId }))}
      gifts={gifts}
      orders={orders}
      save={saveCampaignAction.bind(null, store.slug, campaign?.id ?? null)}
      back={`/admin/${store.slug}/campaigns`}
    />
  );
}
