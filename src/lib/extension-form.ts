/**
 * The extension catalogue's forms at Platform → Plans → Extensions (D748 step E2), pure: what the editor posts, read into what
 * `src/server/extensions.ts` saves. A problem is a key of the page's words with the values to fill in, so the words stay with the page.
 */
import { ALLOWANCE_KEYS, isExtensionId, type AllowanceKey, type Allowances, type ExtensionId } from "./extensions";
import { PLAN_INTERVALS, type PlanInterval } from "./plans";
import { parsePrice } from "./product-input";

export type ExtensionPriceInput = { currency: string; interval: PlanInterval; amountMinor: number };
export type SizeInput = { id: string | null; label: string; allowances: Allowances; position: number; active: boolean; prices: ExtensionPriceInput[] };
export type ExtensionInput = { name: string; description: string; standalone: boolean; position: number; active: boolean; sizes: SizeInput[] };
export type BundleInput = { name: string; description: string; position: number; active: boolean; members: ExtensionId[]; prices: ExtensionPriceInput[] };
export type GrantInput = { planId: string; extensionId: ExtensionId; sizeId: string };

export type FormProblem =
  | { key: "giveAName" }
  | { key: "giveASizeAName"; values: { n: number } }
  | { key: "notAmount"; values: { text: string; currency: string } }
  | { key: "notCount"; values: { text: string } }
  | { key: "sizeNeedsAPrice"; values: { size: string } }
  | { key: "bundleNeedsTwo" }
  | { key: "bundleNeedsAPrice" }
  | { key: "unknownSize" };

export type Parsed<T> = { ok: true; input: T } | { ok: false; problems: FormProblem[] };

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const whole = (form: FormData, name: string, fallback = 0) => {
  const n = Number.parseInt(text(form, name), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** The prices posted under `{prefix}price:{currency}:{interval}`; an empty box is no price in that currency and interval. */
function prices(form: FormData, prefix: string, currencies: readonly string[], problems: FormProblem[]): ExtensionPriceInput[] {
  const out: ExtensionPriceInput[] = [];
  for (const currency of currencies) {
    for (const interval of PLAN_INTERVALS) {
      const value = text(form, `${prefix}price:${currency}:${interval}`);
      if (!value) continue;
      const amount = parsePrice(value, currency);
      if (amount === null) problems.push({ key: "notAmount", values: { text: value, currency } });
      else out.push({ currency, interval, amountMinor: amount });
    }
  }
  return out;
}

function allowances(form: FormData, prefix: string, keys: readonly AllowanceKey[], problems: FormProblem[]): Allowances {
  const out: Allowances = {};
  for (const key of keys) {
    const value = text(form, `${prefix}allowance:${key}`).replace(/[\s .,]/g, "");
    if (!value) continue;
    if (!/^\d{1,9}$/.test(value)) problems.push({ key: "notCount", values: { text: value } });
    else out[key] = Number(value);
  }
  return out;
}

/**
 * One extension's form: its words, `standalone` and `active` boxes, and each size under `size:{id}:` (the new size under `size:new:`, read only
 * when it has a label). A size on offer needs at least one price; a size not offered keeps none.
 */
export function parseExtensionForm(
  form: FormData,
  context: { sizeIds: readonly string[]; allowanceKeys: readonly AllowanceKey[]; currencies: readonly string[] },
): Parsed<ExtensionInput> {
  const problems: FormProblem[] = [];
  const name = text(form, "name");
  if (!name) problems.push({ key: "giveAName" });
  const keys = context.allowanceKeys.filter((k) => ALLOWANCE_KEYS.includes(k));
  const sizes: SizeInput[] = [];
  const read = (id: string | null, n: number) => {
    const prefix = `size:${id ?? "new"}:`;
    const label = text(form, `${prefix}label`);
    if (!id && !label) return;
    if (!label) problems.push({ key: "giveASizeAName", values: { n } });
    const active = id ? form.get(`${prefix}offered`) === "on" : true;
    const size: SizeInput = {
      id,
      label,
      allowances: allowances(form, prefix, keys, problems),
      position: whole(form, `${prefix}position`, n - 1),
      active,
      prices: prices(form, prefix, context.currencies, problems),
    };
    if (active && label && size.prices.length === 0) problems.push({ key: "sizeNeedsAPrice", values: { size: label } });
    sizes.push(size);
  };
  context.sizeIds.forEach((id, i) => read(id, i + 1));
  read(null, context.sizeIds.length + 1);
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    input: {
      name,
      description: text(form, "description"),
      standalone: form.get("standalone") === "on",
      position: whole(form, "position"),
      active: form.get("active") === "on",
      sizes,
    },
  };
}

/** A bundle's form: its words, `member:{extension}` boxes (two at least) and its prices (one at least while it is offered). */
export function parseBundleForm(form: FormData, context: { currencies: readonly string[] }): Parsed<BundleInput> {
  const problems: FormProblem[] = [];
  const name = text(form, "name");
  if (!name) problems.push({ key: "giveAName" });
  const members = [...form.keys()]
    .filter((key) => key.startsWith("member:") && form.get(key) === "on")
    .map((key) => key.slice("member:".length))
    .filter(isExtensionId);
  const unique = [...new Set(members)];
  if (unique.length < 2) problems.push({ key: "bundleNeedsTwo" });
  const active = form.get("active") === "on";
  const bundlePrices = prices(form, "", context.currencies, problems);
  if (active && bundlePrices.length === 0) problems.push({ key: "bundleNeedsAPrice" });
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, input: { name, description: text(form, "description"), position: whole(form, "position"), active, members: unique, prices: bundlePrices } };
}

/**
 * What the shown plans include: `grant:{planId}:{extension}` holds a size's id, or nothing for not included. A size that is not the
 * extension's own is refused.
 */
export function parseGrantsForm(
  form: FormData,
  context: { planIds: readonly string[]; sizesOf: Record<ExtensionId, readonly string[]> },
): Parsed<GrantInput[]> {
  const grants: GrantInput[] = [];
  for (const planId of context.planIds) {
    for (const extensionId of Object.keys(context.sizesOf).filter(isExtensionId)) {
      const sizeId = text(form, `grant:${planId}:${extensionId}`);
      if (!sizeId) continue;
      if (!context.sizesOf[extensionId].includes(sizeId)) return { ok: false, problems: [{ key: "unknownSize" }] };
      grants.push({ planId, extensionId, sizeId });
    }
  }
  return { ok: true, input: grants };
}
