import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALLOWED_FIELDS,
  AUDIT_AREAS,
  AUDIT_AREA_KEYS,
  AUDIT_KINDS,
  AUDIT_RETENTION_MONTHS,
  MAX_VALUE_LENGTH,
  SECRET_KEY,
  areaOfAction,
  areaOfEntry,
  areaRulesAsSql,
  changesProblem,
  diffOf,
  explicitAreaOf,
  isAuditArea,
  sameValue,
  summaryOf,
} from "./audit";
import { AREAS } from "./permission-keys";

describe("the area of an action", () => {
  it("is the one the principal prefixes give", () => {
    const table: Record<string, string> = {
      "order.delivered": "orders",
      "return.refunded": "orders",
      "booking.cancelled": "orders",
      "deliveries.enabled": "orders",
      "shipping.bring_booked": "orders",
      "shipping.updated": "settings",
      "shipping.carrier_saved": "settings",
      "product.updated": "products",
      "product.price_changed": "products",
      "product_layout.assigned": "products",
      "customer.tier": "customers",
      "tier.created": "customers",
      "company.created": "customers",
      "company.main_account": "customers",
      "company.office_saved": "settings",
      "company.place_added": "settings",
      "discount.created": "marketing",
      "campaign.updated": "marketing",
      "experiment.started": "marketing",
      "search_test.stopped": "marketing",
      "store.bonus_settings": "marketing",
      "store.affiliate_settings": "marketing",
      "analytics.settings": "analytics",
      "store.page_published": "website",
      "store.article_saved": "website",
      "store.header_deleted": "website",
      "store.theme_updated": "website",
      "store.menu_created": "website",
      "store.front_page_changed": "website",
      "store.legal_role_changed": "website",
      "page.published_with_issues": "website",
      "page.category_created": "website",
      "site_header.chosen": "website",
      "term.fields_updated": "website",
      "booking_resource.created": "bookings",
      "host.invited": "bookings",
      "hosts.dac7_downloaded": "bookings",
      "billing.plan_changed": "billing",
      "staff.invited": "staff",
      "staff.role_assigned": "staff",
      "role.created": "staff",
      "store.two_step_required": "staff",
      "platform.sale_fee_updated": "platform",
      "platform.page_published": "platform",
      "language.added": "platform",
      "ai.platform_saved": "platform",
      "google.platform_key_saved": "platform",
      "plan_reminders.enabled": "platform",
      "account.password_set": "account",
      "account.two_step_enrolled": "account",
      "payments.provider_updated": "settings",
      "returns.settings_saved": "settings",
      "store.details_updated": "settings",
      "store.terms_mode_changed": "settings",
      "ai.saved": "settings",
      "google.key_saved": "settings",
      "work.invoice.issued": "settings",
      "store.assistant.set_stock": "settings",
    };
    const wrong = Object.entries(table).filter(([action, area]) => areaOfAction(action) !== area).map(([action]) => `${action}: ${areaOfAction(action)}`);
    expect(wrong).toEqual([]);
  });

  it("is the longest prefix, and an exact action beats every prefix", () => {
    expect(areaOfAction("store.page_published")).toBe("website"); // store.page_ over store.
    expect(areaOfAction("store.copied")).toBe("settings");
    expect(areaOfAction("shipping.helthjem_booked")).toBe("orders"); // exact over shipping.
    expect(areaOfAction("platform.assistant.set_referral_program")).toBe("platform");
    expect(areaOfAction("ai.platform_removed")).toBe("platform"); // ai.platform_ over ai.
    expect(areaOfAction("ai.removed")).toBe("settings");
  });

  it("is settings for an action nothing names, but says nothing is named", () => {
    expect(areaOfAction("something.new")).toBe("settings");
    expect(explicitAreaOf("something.new")).toBeUndefined();
    expect(areaOfAction("")).toBe("settings");
    expect(explicitAreaOf("order.delivered")).toBe("orders");
  });

  it("uses only areas that exist, and every store area is a permission area", () => {
    const used = new Set([...Object.values(AUDIT_AREAS.exact), ...Object.values(AUDIT_AREAS.prefixes)]);
    for (const area of used) expect(AUDIT_AREA_KEYS as readonly string[]).toContain(area);
    for (const area of AREAS) expect(AUDIT_AREA_KEYS as readonly string[]).toContain(area);
    expect(AUDIT_AREA_KEYS).toEqual(expect.arrayContaining(["platform", "account"]));
    expect(isAuditArea("orders")).toBe(true);
    expect(isAuditArea("nope")).toBe(false);
  });

  it("shows an old row by its action and a new one by its own area", () => {
    expect(areaOfEntry({ area: null, action: "discount.created" })).toBe("marketing");
    expect(areaOfEntry({ area: "staff", action: "account.two_step_enrolled" })).toBe("staff");
    expect(areaOfEntry({ area: "junk", action: "order.delivered" })).toBe("orders");
    expect(areaOfEntry({ action: "order.delivered" })).toBe("orders");
  });

  it("is one rule list for the database: exact first, then the longest prefix", () => {
    const rules = areaRulesAsSql();
    const firstPrefix = rules.findIndex((r) => r.when.startsWith("starts_with"));
    expect(rules.slice(0, firstPrefix).every((r) => r.when.startsWith("p_action = "))).toBe(true);
    expect(rules.slice(firstPrefix).every((r) => r.when.startsWith("starts_with"))).toBe(true);
    const lengths = rules.slice(firstPrefix).map((r) => r.when.length);
    // Longer prefixes come first: a prefix is never tried before one that starts with it.
    const prefixes = rules.slice(firstPrefix).map((r) => /'(.*)'/.exec(r.when)![1]);
    for (let i = 0; i < prefixes.length; i++) for (let j = 0; j < i; j++) expect(prefixes[i].startsWith(prefixes[j]) && prefixes[i] !== prefixes[j]).toBe(false);
    expect(lengths.length).toBe(prefixes.length);
  });

  it("keeps entries 24 months", () => {
    expect(AUDIT_RETENTION_MONTHS).toBe(24);
  });
});

/** Every `audit(` and `auditChange(` call in the app: a new action must name an area (a decision, not a default). */
describe("every action the app writes names its area", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) files.push(full);
    }
  };
  walk(join(process.cwd(), "src"));

  /** The arguments of each call of `name(`, split at the top level. */
  function calls(text: string, name: string): string[][] {
    const found: string[][] = [];
    const re = new RegExp(`\\b${name}\\(`, "g");
    for (let m = re.exec(text); m; m = re.exec(text)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      let quote: string | null = null;
      const args: string[] = [];
      let current = "";
      for (; i < text.length && depth > 0; i++) {
        const c = text[i];
        if (quote) {
          current += c;
          if (c === "\\") current += text[++i];
          else if (c === quote) quote = null;
        } else if (c === '"' || c === "'" || c === "`") {
          quote = c;
          current += c;
        } else if ("([{".includes(c)) {
          depth++;
          current += c;
        } else if (")]}".includes(c)) {
          depth--;
          if (depth > 0) current += c;
        } else if (c === "," && depth === 1) {
          args.push(current.trim());
          current = "";
        } else current += c;
      }
      args.push(current.trim());
      if (i > start) found.push(args);
    }
    return found;
  }

  const literals = new Map<string, string>();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (file.endsWith("src/server/auth.ts") || file.endsWith("src/lib/audit.ts")) continue;
    for (const args of calls(text, "audit")) if (args.length >= 3 && /^"[^"]+"$/.test(args[2])) literals.set(args[2].slice(1, -1), file);
    for (const args of calls(text, "auditChange")) if (args.length >= 2 && /^"[^"]+"$/.test(args[1])) literals.set(args[1].slice(1, -1), file);
    // Actions chosen by a condition: `active ? "campaign.switched_on" : "campaign.switched_off"`.
    for (const args of calls(text, "audit")) {
      if (args.length < 3 || /^"[^"]+"$/.test(args[2])) continue;
      for (const m of args[2].matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g)) literals.set(m[1], file);
    }
  }

  it("finds the calls it is meant to scan", () => {
    expect(literals.size).toBeGreaterThan(150);
    expect(literals.has("staff.invited")).toBe(true);
    expect(literals.has("campaign.switched_on")).toBe(true);
  });

  it("names an area in AUDIT_AREAS for every literal action, so a new action forces a decision", () => {
    const unnamed = [...literals].filter(([action]) => explicitAreaOf(action) === undefined).map(([action, file]) => `${action} (${file.replace(process.cwd(), "")})`);
    expect(unnamed).toEqual([]);
  });

  it("names an area for the actions that are built from parts (pages, articles, headers, taxonomy, saved parts, fonts, fields)", () => {
    const built = [
      ...["page", "article", "header", "footer", "product_layout", "variant"].flatMap((type) => ["store", "platform"].flatMap((owner) => ["saved", "published", "unpublished", "deleted", "duplicated"].map((verb) => `${owner}.${type}_${verb}`))),
      ...["page", "article", "product"].flatMap((content) => ["category", "tag"].flatMap((kind) => ["created", "updated", "deleted"].map((verb) => `${content}.${kind}_${verb}`))),
      ...["store", "platform"].flatMap((owner) => ["part_saved", "part_updated", "part_deleted", "fonts_updated", "tracking_updated", "page_ai_built"].map((verb) => `${owner}.${verb}`)),
      ...["product", "page", "article", "term", "store", "customer", "order"].map((entity) => `${entity}.fields_updated`),
      "site_header.chosen",
      "site_footer.chosen",
      "billing.plan_cancel_now",
      "billing.plan_cancel_at_period_end",
      "store.assistant.update_product",
      "platform.template_hidden",
      "platform.template_unhidden",
      "page.published_with_issues",
      "product.created",
      "product.updated",
      "product.archived",
      "product.price_changed",
      "discount.created",
      "role.created",
      "role.updated",
      "role.deleted",
      "staff.role_assigned",
      "staff.collaborator_invited",
      "staff.collaborator_expired",
      "staff.collaborator_extended",
      "store.two_step_required",
      "store.two_step_optional",
      "store.terms_mode_changed",
      "store.legal_starter_made",
      "store.legal_role_changed",
      "account.two_step_enrolled",
      "account.two_step_removed",
      "account.two_step_passed",
      "account.two_step_failed",
      "account.two_step_attempt",
      "account.two_step_attempt_cleared",
      "account.two_step_reset",
      "account.two_step_switch_off",
      "account.recovery_codes_generated",
      "account.recovery_code_used",
      "activity.exported",
    ];
    const unnamed = built.filter((action) => explicitAreaOf(action) === undefined);
    expect(unnamed).toEqual([]);
  });
});

describe("what may be written about a change", () => {
  it("lists a changed field's values when the kind allows it", () => {
    const { changes, refused } = diffOf("product", { title: "Lampe", status: "draft", handle: "lampe" }, { title: "Lampe 2", status: "active", handle: "lampe" });
    expect(changes).toEqual({ status: { from: "draft", to: "active" }, title: { from: "Lampe", to: "Lampe 2" } });
    expect(refused).toEqual([]);
  });

  it("leaves out what did not change, and null and missing are the same", () => {
    expect(diffOf("page", { title: "A", rowCount: 2 }, { title: "A", rowCount: 2 }).changes).toEqual({});
    expect(diffOf("page", { title: "A" }, { title: "A", address: null }).changes).toEqual({});
    expect(diffOf("page", {}, { title: "New" }).changes).toEqual({ title: { from: null, to: "New" } });
    expect(diffOf("page", null, { title: "New" }).changes).toEqual({ title: { from: null, to: "New" } });
    expect(diffOf("page", { title: "Old" }, undefined).changes).toEqual({ title: { from: "Old", to: null } });
  });

  it("says only that a field changed when it is not on the kind's list", () => {
    const { changes } = diffOf("page", { title: "A", body: "long text" }, { title: "B", body: "other long text" });
    expect(changes).toEqual({ body: { changed: true }, title: { from: "A", to: "B" } });
  });

  it("never writes a secret-like field, whatever the list says, and says which it refused", () => {
    const before = { code: "OLD", apiKey: "sk_live_1", webhookSecret: "x", password: "p", authToken: "t", ibanNumber: "NO93", cookieJar: "c", authorization: "Bearer a" };
    const after = { code: "NEW", apiKey: "sk_live_2", webhookSecret: "y", password: "q", authToken: "u", ibanNumber: "NO94", cookieJar: "d", authorization: "Bearer b" };
    const { changes, refused } = diffOf("discount", before, after);
    expect(changes).toEqual({ code: { from: "OLD", to: "NEW" } });
    expect(refused.sort()).toEqual(["apiKey", "authToken", "authorization", "cookieJar", "ibanNumber", "password", "webhookSecret"]);
    expect(JSON.stringify(changes)).not.toMatch(/sk_live|Bearer|NO93/);
    // Even a list that named one would not write it.
    for (const kind of AUDIT_KINDS) for (const field of ALLOWED_FIELDS[kind]) expect([kind, field, SECRET_KEY.test(field)]).toEqual([kind, field, false]);
  });

  it("cuts a long value and ends it with an ellipsis", () => {
    const long = "x".repeat(1000);
    const { changes } = diffOf("page", { title: "short" }, { title: long });
    const to = (changes.title as { from: unknown; to: string }).to;
    expect(to).toHaveLength(MAX_VALUE_LENGTH);
    expect(to.endsWith("…")).toBe(true);
    // An object over the limit is written as a cut piece of its JSON; one under it is kept.
    const rates = { NO: { priceMinor: 5900 } };
    expect(diffOf("shipping", { rates: {} }, { rates }).changes.rates).toEqual({ from: {}, to: rates });
    const big = Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`market${i}`, { priceMinor: i }]));
    const cut = (diffOf("shipping", { rates: {} }, { rates: big }).changes.rates as { to: string }).to;
    expect(typeof cut).toBe("string");
    expect(cut.length).toBeLessThanOrEqual(MAX_VALUE_LENGTH);
  });

  it("compares arrays and objects by what they hold", () => {
    expect(sameValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(sameValue([1, 2], [2, 1])).toBe(false);
    expect(sameValue(null, undefined)).toBe(true);
    expect(sameValue("1", 1)).toBe(false);
    expect(diffOf("role", { permissions: ["orders:read"] }, { permissions: ["orders:read"] }).changes).toEqual({});
    expect(diffOf("role", { permissions: ["orders:read"] }, { permissions: ["orders:read", "orders:write"] }).changes).toEqual({ permissions: { from: ["orders:read"], to: ["orders:read", "orders:write"] } });
  });

  it("holds every kind to a list of plain field names", () => {
    for (const kind of AUDIT_KINDS) {
      expect(ALLOWED_FIELDS[kind].length).toBeGreaterThan(0);
      for (const field of ALLOWED_FIELDS[kind]) expect(field).toMatch(/^[a-zA-Z]+$/);
    }
    // The prices the entry for a price change names are in minor units with their currency.
    expect(ALLOWED_FIELDS.price).toEqual(expect.arrayContaining(["priceMinor", "currency"]));
  });

  it("checks a last time before a row is written", () => {
    expect(changesProblem(undefined)).toBeNull();
    expect(changesProblem({ title: { from: "A", to: "B" }, body: { changed: true } })).toBeNull();
    expect(changesProblem({ apiKey: { from: "a", to: "b" } })).toMatch(/secret/);
    expect(changesProblem({ title: { from: "A", to: "x".repeat(301) } })).toMatch(/longer/);
    expect(changesProblem({ title: "B" })).toMatch(/not a change/);
    expect(changesProblem([1])).toMatch(/object/);
  });
});

describe("the sentence of an entry", () => {
  it("is made by code from the action and its target", () => {
    expect(summaryOf("product.price_changed", { type: "product", id: "p1", label: "Demo: Lampe" })).toBe("Changed the price of Demo: Lampe");
    expect(summaryOf("staff.invited", { type: "account", id: "a1", label: "anna@example.com" })).toBe("Invited anna@example.com");
    expect(summaryOf("staff.collaborator_invited", { type: "account", id: "a1", label: "agency@example.com" })).toBe("Invited agency@example.com as a collaborator");
    expect(summaryOf("store.page_published", { type: "page", id: "x", label: "Om oss" })).toBe("Published the page Om oss");
    expect(summaryOf("role.deleted", { type: "role", id: "r", label: "Content" })).toBe("Deleted the role Content");
    expect(summaryOf("shipping.updated")).toBe("Changed the shipping settings");
  });

  it("falls back to the target's type and id, and then to the action's own words", () => {
    expect(summaryOf("product.updated", { type: "product", id: "p9" })).toBe("Changed the product product p9");
    expect(summaryOf("product.updated")).toBe("Changed the product it");
    expect(summaryOf("campaign.switched_on")).toBe("Campaign switched on");
    expect(summaryOf("campaign.switched_on", { type: "campaign", id: "c", label: "Autumn" })).toBe("Campaign switched on: Autumn");
    expect(summaryOf("work.invoice.issued", null, { number: { changed: true } })).toBe("Work invoice issued (number)");
  });
});
