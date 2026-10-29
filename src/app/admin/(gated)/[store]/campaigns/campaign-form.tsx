import { CampaignEditor, type CampaignDraft } from "@/components/admin/campaign-editor";
import type { Campaign } from "@/lib/campaigns";
import { formatPriceInput } from "@/lib/product-input";
import { mainCurrency } from "@/lib/markets";
import { listGiftChoices } from "@/server/campaigns";
import { listTiers } from "@/server/customer-tiers";
import { listSegments } from "@/server/segments";
import { listProductChoices } from "@/server/discounts";
import { listTerms } from "@/server/taxonomy";
import type { Store } from "@/server/stores";

import { saveCampaignAction } from "./actions";

/** A new tiered campaign's steps, to change: 10 % from 2 items, 15 % from 4. */
const NEW_TIERS: CampaignDraft["tiers"] = [
  { quantity: "2", amounts: {}, percent: "10", off: {} },
  { quantity: "4", amounts: {}, percent: "15", off: {} },
];

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
  const [products, terms, gifts, tiers, segments] = await Promise.all([
    listProductChoices(store.id, locale),
    listTerms({ storeId: store.id, contentType: "product" }),
    listGiftChoices(store.id, locale),
    listTiers(store.id),
    listSegments(store.id),
  ]);
  const currency = (code: string) => store.markets.find((m) => m.code === code)?.currency ?? mainCurrency(store);
  const typed = (values: Record<string, number>) => Object.fromEntries(Object.entries(values).map(([code, minor]) => [code, formatPriceInput(minor, currency(code))]));
  const initial: CampaignDraft = campaign
    ? {
        name: campaign.name,
        kind: campaign.kind,
        percent: campaign.kind === "percent" ? String(campaign.percent) : "10",
        buyQuantity: campaign.kind === "multi_buy" ? String(campaign.buyQuantity) : "3",
        payQuantity: campaign.kind === "multi_buy" ? String(campaign.payQuantity) : "2",
        giftVariantId: campaign.giftVariantId ?? "",
        giftQuantity: String(campaign.giftQuantity),
        thresholds: typed(campaign.thresholds),
        amounts: typed(campaign.amounts),
        tierBasis: campaign.tierBasis ?? "quantity",
        tierGive: campaign.kind === "tiered" && campaign.tiers.some((tier) => tier.off && Object.keys(tier.off).length > 0) ? "amount" : "percent",
        tiers:
          campaign.kind === "tiered"
            ? campaign.tiers.map((tier) => ({
                quantity: tier.quantity === null ? "" : String(tier.quantity),
                amounts: typed(tier.amounts),
                percent: tier.percent > 0 ? String(tier.percent) : "",
                off: typed(tier.off ?? {}),
              }))
            : NEW_TIERS,
        buyBasis: campaign.kind === "bxgy" && campaign.buyMinQuantity === null ? "spend" : "items",
        buyMinQuantity: String(campaign.buyMinQuantity ?? 2),
        buyMinAmounts: typed(campaign.buyMinAmounts),
        getScope: campaign.getProductIds.length + campaign.getTermIds.length > 0 ? "some" : "same",
        getProductIds: campaign.getProductIds,
        getTermIds: campaign.getTermIds,
        getQuantity: String(campaign.kind === "bxgy" ? campaign.getQuantity : 1),
        getKind: campaign.getKind ?? "free",
        getPercent: String(campaign.getPercent ?? 50),
        getAmounts: typed(campaign.getAmounts),
        usesPerOrder: campaign.usesPerOrder === null ? "" : String(campaign.usesPerOrder),
        scope: campaign.productIds.length + campaign.termIds.length > 0 ? "some" : "all",
        productIds: campaign.productIds,
        termIds: campaign.termIds,
        tierIds: campaign.tierIds,
        segmentId: campaign.segmentId,
        usageLimit: campaign.usageLimit === null ? "" : String(campaign.usageLimit),
        perCustomerLimit: campaign.perCustomerLimit === null ? "" : String(campaign.perCustomerLimit),
        markets: campaign.markets,
        stacks: campaign.stacks,
        combinesWithCodes: campaign.combinesWithCodes,
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
        amounts: {},
        tierBasis: "quantity",
        tierGive: "percent",
        tiers: NEW_TIERS,
        buyBasis: "items",
        buyMinQuantity: "2",
        buyMinAmounts: {},
        getScope: "same",
        getProductIds: [],
        getTermIds: [],
        getQuantity: "1",
        getKind: "free",
        getPercent: "50",
        getAmounts: {},
        usesPerOrder: "",
        scope: "all",
        productIds: [],
        termIds: [],
        tierIds: [],
        segmentId: null,
        usageLimit: "",
        perCustomerLimit: "",
        markets: [],
        stacks: false,
        combinesWithCodes: true,
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
      tiers={tiers.map((t) => ({ id: t.id, name: t.name, percent: t.percent, active: t.active }))}
      segments={segments.map((s) => ({ id: s.id, name: s.name }))}
      orders={orders}
      save={saveCampaignAction.bind(null, store.slug, campaign?.id ?? null)}
      back={`/admin/${store.slug}/campaigns`}
    />
  );
}
