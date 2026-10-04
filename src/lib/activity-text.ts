/**
 * How the activity log reads (wave 1, 1f, `docs/wave-1-trust.md` 2.9): the words for areas, actions and the fields an entry changed, kept
 * apart from the page so a test holds them. The sentence of an entry is `summaryOf()` in `audit.ts`; this is what stands around it.
 */
import type { AuditArea, FieldChange } from "./audit";

export const AUDIT_AREA_LABELS: Record<AuditArea, string> = {
  orders: "Orders",
  products: "Products",
  customers: "Customers",
  marketing: "Marketing",
  analytics: "Analytics",
  website: "Website",
  bookings: "Bookings",
  settings: "Settings",
  billing: "Billing",
  staff: "Team",
  platform: "Platform",
  account: "Account security",
};

/** A filter's option for an action: `product.price_changed` reads "Product: price changed". */
export function actionLabel(action: string): string {
  const [head, ...rest] = action.split(".");
  const tail = rest.join(".").replace(/[._]/g, " ");
  const first = head.replace(/_/g, " ");
  const title = first.charAt(0).toUpperCase() + first.slice(1);
  return tail ? `${title}: ${tail}` : title;
}

/** A changed field's name for a person: `requireTwoStep` reads "Require two step", `vat_category` "Vat category". */
export function fieldLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A value as the log shows it: nothing as "(none)", a list as words, a yes or no, and anything else as written. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "(none)";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.length === 0 ? "(none)" : value.map(valueText).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** One changed field as a line: `{ from, to }` as "Title: Lamp → Lamp 2", and a field whose value is never recorded as "changed". */
export function changeLine(key: string, change: FieldChange): { label: string; from: string | null; to: string | null } {
  if ("changed" in change) return { label: fieldLabel(key), from: null, to: null };
  return { label: fieldLabel(key), from: valueText(change.from), to: valueText(change.to) };
}

/** The address of the log with these filters, for the next page, the filters' own form and the CSV: only what is set is written. */
export function activityQuery(filters: { person?: string | null; area?: string | null; action?: string | null; from?: string | null; to?: string | null; before?: number | null }): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== null && value !== undefined && value !== "") params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : "";
}
