import { DiscountEditor, type DiscountDraft } from "@/components/admin/discount-editor";
import type { StoreDiscount } from "@/lib/discounts";
import { formatPriceInput } from "@/lib/product-input";
import { mainCurrency } from "@/lib/markets";
import type { Store } from "@/server/stores";
import { customerEmailsOf, listProductChoices } from "@/server/discounts";
import { listTerms } from "@/server/taxonomy";
import { listTiers } from "@/server/customer-tiers";
import { listSegments } from "@/server/segments";

import { saveDiscountAction } from "./actions";
import { featureOn } from "@/lib/store-features";

/** `datetime-local` text for a time, in Norwegian time. */
function osloLocal(iso: string | null): string {
  if (!iso) return "";
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  return parts.replace(" ", "T");
}

/** The editor for a new code or an existing one, with the store's markets and products. */
export async function DiscountForm({ store, discount }: { store: Store; discount: (StoreDiscount & { used: number }) | null }) {
  const [products, terms, tiers, emails, segments] = await Promise.all([
    listProductChoices(store.id, store.markets[0]?.locale ?? "nb-NO"),
    listTerms({ storeId: store.id, contentType: "product" }),
    listTiers(store.id),
    customerEmailsOf(store.id, discount?.customerIds ?? []),
    listSegments(store.id),
  ]);
  const currency = (code: string) => store.markets.find((m) => m.code === code)?.currency ?? mainCurrency(store);
  const texts = (values: Record<string, number>) =>
    Object.fromEntries(Object.entries(values).map(([code, minor]) => [code, formatPriceInput(minor, currency(code))]));
  const initial: DiscountDraft = discount
    ? {
        code: discount.code,
        kind: discount.kind,
        percent: discount.kind === "percent" ? String(discount.percent) : "10",
        amounts: texts(discount.amounts),
        minSubtotals: texts(discount.minSubtotals),
        productIds: discount.productIds,
        recurring: discount.recurring,
        startsAt: osloLocal(discount.startsAt),
        endsAt: osloLocal(discount.endsAt),
        usageLimit: discount.usageLimit === null ? "" : String(discount.usageLimit),
        oncePerCustomer: discount.oncePerCustomer,
        active: discount.active,
        termIds: discount.termIds,
        minQuantity: discount.minQuantity === null ? "" : String(discount.minQuantity),
        tierIds: discount.tierIds,
        customerEmails: emails.join("\n"),
        uniqueCodes: discount.uniqueCodes,
        combinesWith: discount.combinesWith,
        combinesWithCampaigns: discount.combinesWithCampaigns,
        segmentId: discount.segmentId,
      }
    : {
        code: "",
        kind: "percent",
        percent: "10",
        amounts: {},
        minSubtotals: {},
        productIds: null,
        recurring: false,
        startsAt: "",
        endsAt: "",
        usageLimit: "",
        oncePerCustomer: false,
        active: true,
        termIds: [],
        minQuantity: "",
        tierIds: [],
        customerEmails: "",
        uniqueCodes: false,
        combinesWith: [],
        combinesWithCampaigns: true,
        segmentId: null,
      };
  return (
    <DiscountEditor
      initial={initial}
      markets={store.markets.map((m) => ({ code: m.code, name: m.name, currency: m.currency }))}
      products={products}
      terms={terms.map((t) => ({ id: t.id, name: t.name, kind: t.kind, parentId: t.parentId }))}
      tiers={tiers.map((t) => ({ id: t.id, name: t.name, active: t.active }))}
      segments={segments.map((s) => ({ id: s.id, name: s.name }))}
      used={discount?.used ?? 0}
      save={saveDiscountAction.bind(null, store.slug, discount?.id ?? null)}
      back={`/admin/${store.slug}/discounts`}
      subscriptions={featureOn(store, "subscriptions")}
    />
  );
}
