import "server-only";

import { db } from "@/db/client";
import {
  groupApplies,
  isEmptyValue,
  type FieldDef,
  readField,
  staffGroupProblem,
  type FieldData,
  type FieldGroup,
  type FieldLookups,
} from "@/lib/custom-fields";
import { addressableFieldsOf } from "@/lib/field-csv-cells";
import { plainFieldText } from "@/lib/field-csv";
import { fieldValueText } from "@/lib/field-tools";
import { t } from "@/lib/i18n";

import { audit, type Membership } from "./auth";
import {
  activeFieldGroups,
  fieldsForEditor,
  getFieldData,
  getFieldDataMany,
  listFieldGroups,
  saveFieldData,
  staffRuleFacts,
  storeRuleFacts,
} from "./custom-fields";
import type { SaveResult } from "./settings";

/**
 * The fields of things other than products and pages (D120): the store itself
 * (one set of values for the whole site, which may be public), and customers
 * and orders (for staff only, never public: `staffGroupProblem()` keeps their
 * groups so, and nothing on the storefront reads their values). The editors'
 * views and saves live here; the site reads the store's public fields through
 * `shownFieldsFor(storeId, "store", storeId, …)`.
 */

export type StaffEntity = "customer" | "order";

export type EntityFieldsEditor = { groups: FieldGroup[]; data: FieldData; lookups: FieldLookups };

/** A group that may be filled in for a thing of a kind: on it, and (for staff-only things) kept so. */
const usable = (group: FieldGroup, entity: "store" | StaffEntity): boolean =>
  entity === "store" || staffGroupProblem(group) === null;

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** The store's own fields for its editor: the active groups on the store, and what was entered. */
export async function storeFieldsForEditor(storeId: string): Promise<EntityFieldsEditor> {
  const editor = await fieldsForEditor(storeId, "store", storeId);
  return { groups: editor.groups, data: editor.data, lookups: editor.lookups };
}

/**
 * Saves what an editor entered in the store's own fields. Public ones show
 * wherever the store's pages, product layouts, headers and footers place them.
 * The caller refreshes `fieldsTag()` and the store's tag.
 */
export async function saveStoreFields({ account, store }: Membership, raw: unknown): Promise<SaveResult> {
  const problems = await db().transaction(async (tx) => {
    const facts = await storeRuleFacts(tx, store.id, store.id);
    if (!facts) return ["The store no longer exists."];
    return saveFieldData(tx, store.id, "store", store.id, raw, {
      facts,
      locales: store.localization.locales,
      main: store.localization.locales[0],
      requireAll: false,
    });
  });
  if (problems.length > 0) return { ok: false, problems };
  await audit(account.id, store.id, "store.fields_updated", {});
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Customers and orders (staff only)
// ---------------------------------------------------------------------------

/** A customer's or an order's fields for staff: every active group for that kind of thing. Null when it is not the store's own. */
export async function staffFieldsForEditor(
  storeId: string,
  entity: StaffEntity,
  id: string,
): Promise<EntityFieldsEditor | null> {
  const facts = await staffRuleFacts(db(), storeId, entity, id);
  if (!facts) return null;
  const editor = await fieldsForEditor(storeId, entity, id);
  return {
    groups: editor.groups.filter((group) => groupApplies(group, facts) && usable(group, entity)),
    data: editor.data,
    lookups: editor.lookups,
  };
}

/**
 * Saves what staff entered in a customer's or an order's fields. Nothing is
 * shown on the site, so there is no cache to refresh; the audit log names the
 * thing, never what was entered (it can be personal).
 */
export async function saveStaffFields(
  { account, store }: Membership,
  entity: StaffEntity,
  id: string,
  raw: unknown,
): Promise<SaveResult> {
  const problems = await db().transaction(async (tx) => {
    const facts = await staffRuleFacts(tx, store.id, entity, id);
    if (!facts) return [`The ${entity} no longer exists.`];
    return saveFieldData(tx, store.id, entity, id, raw, {
      facts,
      locales: store.localization.locales,
      main: store.localization.locales[0],
      requireAll: false,
    });
  });
  if (problems.length > 0) return { ok: false, problems };
  await audit(account.id, store.id, `${entity}.fields_updated`, { [entity]: id });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Personal data
// ---------------------------------------------------------------------------

export type ExportedField = { group: string; label: string; value: string };

/**
 * What staff entered in a customer's fields, as label and words, for handing
 * the customer their data (GDPR art. 15) or checking what is kept. Every group
 * counts, switched off ones too: a value is kept until it is deleted. Erasing
 * a customer needs nothing more than deleting them: the database removes their
 * values with the row (`customers_forget_field_values`).
 */
export async function customerFieldExport(
  store: { id: string; localization: { locales: string[] } },
  customerId: string,
): Promise<ExportedField[]> {
  const main = store.localization.locales[0] ?? "en";
  const [groups, data] = await Promise.all([
    listFieldGroups(store.id),
    getFieldData(store.id, "customer", customerId),
  ]);
  const words = t(main.split("-")[0]).customFields;
  const out: ExportedField[] = [];
  for (const group of groups.filter((g) => g.entities.includes("customer"))) {
    for (const def of group.fields) {
      const value = readField(def, data, main, main);
      if (value === undefined || isEmptyValue(value)) continue;
      out.push({ group: group.name, label: def.label, value: fieldValueText(def, value, main, words, 2000) });
    }
  }
  return out;
}

/**
 * `customerFieldExport()` for many customers at once, with ONE query for their values: what the customer file (D165) and the data-subject export
 * agree on. A customer with nothing entered is absent from the map.
 */
export async function customerFieldExportMany(
  store: { id: string; localization: { locales: string[] } },
  customerIds: readonly string[],
): Promise<Map<string, ExportedField[]>> {
  const main = store.localization.locales[0] ?? "en";
  const [groups, all] = await Promise.all([listFieldGroups(store.id), getFieldDataMany(store.id, "customer", customerIds)]);
  const words = t(main.split("-")[0]).customFields;
  const out = new Map<string, ExportedField[]>();
  for (const [id, data] of all) {
    const list: ExportedField[] = [];
    for (const group of groups.filter((g) => g.entities.includes("customer"))) {
      for (const def of group.fields) {
        const value = readField(def, data, main, main);
        if (value === undefined || isEmptyValue(value)) continue;
        list.push({ group: group.name, label: def.label, value: fieldValueText(def, value, main, words, 2000) });
      }
    }
    if (list.length > 0) out.set(id, list);
  }
  return out;
}

/** The plain customer fields a customer file has a column for: those of every group that is on customers, with a name no other has. */
export async function customerCsvFields(storeId: string): Promise<FieldDef[]> {
  const groups = await listFieldGroups(storeId);
  return addressableFieldsOf(groups.filter((g) => g.entities.includes("customer")).flatMap((g) => g.fields));
}

/** What staff entered about many customers as the text of each plain field's cell, by customer id then the field's name, in one query. */
export async function customerFieldTexts(
  store: { id: string; localization: { locales: string[] } },
  defs: readonly FieldDef[],
  customerIds: readonly string[],
): Promise<Map<string, Record<string, string>>> {
  const main = store.localization.locales[0] ?? "en";
  const all = await getFieldDataMany(store.id, "customer", customerIds);
  const out = new Map<string, Record<string, string>>();
  for (const [id, data] of all) {
    const texts: Record<string, string> = {};
    for (const def of defs) {
      const value = readField(def, data, main, main);
      const text = value === undefined || isEmptyValue(value) ? "" : plainFieldText(def, value);
      if (text !== "") texts[def.name] = text;
    }
    out.set(id, texts);
  }
  return out;
}

/** Whether the store has any active group for a kind of thing, so a page can leave the card out (cached). */
export async function hasFieldGroupsFor(storeId: string, entity: "store" | StaffEntity): Promise<boolean> {
  const groups = await activeFieldGroups(storeId, entity);
  return groups.some((group) => usable(group, entity));
}
