import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { FieldList, RuleList, type CheckoutRuleActions, type RuleChoices } from "@/components/admin/checkout-rules";
import { requireFeature } from "@/components/admin/feature-off";
import { PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { FIELDS_MAX, RULES_MAX } from "@/lib/checkout-rules";
import { languageName } from "@/lib/localization";
import { SWITCHABLE_METHODS } from "@/lib/payment-methods";
import { countryName } from "@/lib/vat-text";
import { db } from "@/db/client";
import { listCheckoutFields, listCheckoutRules, ruleChoices } from "@/server/checkout-rules";
import { memberCan, requirePermission } from "@/server/permissions";

import { deleteFieldAction, deleteRuleAction, moveRuleAction, saveFieldAction, saveRuleAction, switchFieldAction, switchRuleAction } from "./actions";

export const metadata: Metadata = { title: "Checkout rules" };

/** Settings → Checkout rules (D357): rules that hide or rename delivery options, leave payment methods out or stop an order; questions at checkout. */
export default async function CheckoutRulesPage({ params }: PageProps<"/admin/[store]/settings/checkout">) {
  const member = await requirePermission((await params).store, "settings:read");
  const off = requireFeature(member, "shop");
  if (off) return off;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "shipping").checkoutRules;
  const facts = ADMIN_LANG_FACTS[lang];
  const canWrite = memberCan(member, "settings:write");
  const [rules, fields, found] = await Promise.all([listCheckoutRules(store.id), listCheckoutFields(db(), store.id), ruleChoices(store.id, store.localization.locales[0] ?? "en")]);
  const when = (iso: string) => new Date(iso).toLocaleString(facts.locale, { dateStyle: "medium", timeStyle: "short", timeZone: store.timeZone || "Europe/Oslo" });
  const choices: RuleChoices = {
    ...found,
    options: [{ id: "flat", label: w.flat }, ...found.options],
    countries: store.markets.map((m) => ({ id: m.code, label: countryName(m.code, facts.locale) })),
    methods: SWITCHABLE_METHODS.map((m) => ({ id: m.type, label: m.label })),
    currencies: [...new Set(store.localization.currencies.map((c) => c.currency))],
    locales: store.localization.locales.slice(1).map((l) => ({ id: l, label: languageName(l) })),
  };
  const slug = store.slug;
  const actions: CheckoutRuleActions = {
    saveRule: saveRuleAction.bind(null, slug),
    switchRule: switchRuleAction.bind(null, slug),
    moveRule: moveRuleAction.bind(null, slug),
    removeRule: deleteRuleAction.bind(null, slug),
    saveField: saveFieldAction.bind(null, slug),
    switchField: switchFieldAction.bind(null, slug),
    removeField: deleteFieldAction.bind(null, slug),
  };

  return (
    <AdminTextScope texts={adminTexts(lang, ["shipping"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={w.title} description={<>{w.description}</>} />
        <RuleList
          rules={rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, conditions: r.conditions, effect: r.effect, skips: r.skips.map((s) => ({ reason: s.reason, count: s.count, since: when(s.lastAt) })) }))}
          choices={choices}
          canWrite={canWrite}
          actions={actions}
        />
        <FieldList
          fields={fields.map((f) => ({ id: f.id, kind: f.kind, required: f.required, label: f.label, help: f.help, enabled: f.enabled }))}
          locales={choices.locales}
          canWrite={canWrite}
          actions={actions}
        />
        <p className="text-sm text-muted">{fillWords(w.limits, { rules: String(RULES_MAX), fields: String(FIELDS_MAX) })}</p>
      </div>
    </AdminTextScope>
  );
}
