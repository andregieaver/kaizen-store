import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { CheckoutAsksCard } from "@/components/admin/checkout-asks-card";
import { FieldList, RuleList, type CheckoutRuleActions, type FieldInputView, type RuleChoices, type RuleInputView } from "@/components/admin/checkout-rules";
import { adminDate } from "@/lib/admin-date";
import { accountsMode } from "@/lib/customer-accounts";
import { requireFeature } from "@/components/admin/feature-off";
import { PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { countWords, fillWords } from "@/lib/admin-fill";
import { formatMoney } from "@/lib/money";
import { adminText, adminTexts } from "@/lib/admin-text";
import { FIELDS_MAX, RULES_MAX, type Words } from "@/lib/checkout-rules";
import { languageName } from "@/lib/localization";
import { SWITCHABLE_METHODS } from "@/lib/payment-methods";
import { countryName } from "@/lib/vat-text";
import { db } from "@/db/client";
import { listCheckoutFields, listCheckoutRules, ruleChoices } from "@/server/checkout-rules";
import { memberCan, requirePermission } from "@/server/permissions";

import { saveAccountsModeAction, saveContactFieldsAction, deleteFieldAction, deleteRuleAction, moveFieldAction, moveRuleAction, saveFieldAction, saveRuleAction, switchFieldAction, switchRuleAction } from "./actions";

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
  const when = (iso: string) => adminDate(store, iso, "dayTime", lang);
  const choices: RuleChoices = {
    ...found,
    options: [{ id: "flat", label: w.flat }, ...found.options],
    countries: store.markets.map((m) => ({ id: m.code, label: countryName(m.code, facts.locale) })),
    methods: SWITCHABLE_METHODS.map((m) => ({ id: m.type, label: m.label })),
    currencies: [...new Set(store.localization.currencies.map((c) => c.currency))],
    locales: store.localization.locales.slice(1).map((l) => ({ id: l, label: languageName(l) })),
  };
  const slug = store.slug;
  const mode = accountsMode(store);
  // Round 7 (D624): rules and questions a shop really writes, offered while it has none; each opens its editor filled in, saved off.
  const x = w.examples;
  const words = (text: string): Words => ({ text, byLocale: {} });
  const currency = store.markets[0]?.currency ?? "EUR";
  const firstOption = found.options[0];
  const ruleExamples: { label: string; start: RuleInputView }[] = [
    ...(SWITCHABLE_METHODS.some((m) => m.type === "klarna")
      ? [
          {
            label: fillWords(x.klarna, { amount: formatMoney(20000, currency, facts.locale, { decimals: "hide_whole" }) }),
            start: { name: fillWords(x.klarna, { amount: formatMoney(20000, currency, facts.locale, { decimals: "hide_whole" }) }), conditions: [{ kind: "total" as const, op: "below" as const, amountMinor: 20000, currency }], effect: { kind: "hide_payment_method" as const, methods: ["klarna"] } },
          },
        ]
      : []),
    ...(firstOption
      ? [
          {
            label: fillWords(x.hideHeavy, { option: firstOption.label }),
            start: { name: fillWords(x.hideHeavy, { option: firstOption.label }), conditions: [{ kind: "weight" as const, op: "at_least" as const, grams: 20000 }], effect: { kind: "hide_shipping" as const, options: [firstOption.id] } },
          },
        ]
      : []),
    { label: x.heavy, start: { name: x.heavy, conditions: [{ kind: "weight", op: "at_least", grams: 30000 }], effect: { kind: "refuse", message: words(x.heavyMessage) } } },
    {
      label: fillWords(x.rename, { option: (firstOption ?? choices.options[0]).label }),
      start: { name: fillWords(x.rename, { option: (firstOption ?? choices.options[0]).label }), conditions: [], effect: { kind: "rename_shipping", option: (firstOption ?? choices.options[0]).id, label: words(x.renameTo) } },
    },
  ];
  const fieldExamples: { label: string; start: FieldInputView }[] = [
    { label: x.date, start: { kind: "date", required: false, label: words(x.dateLabel), help: null, width: "full", bounds: { min: 1 } } },
    { label: x.note, start: { kind: "textarea", required: false, label: words(x.noteLabel), help: null, width: "full" } },
    { label: x.gift, start: { kind: "textarea", required: false, label: words(x.giftLabel), help: null, width: "full" } },
    { label: x.heard, start: { kind: "text", required: false, label: words(x.heardLabel), help: null, width: "full" } },
  ];
  const actions: CheckoutRuleActions = {
    saveRule: saveRuleAction.bind(null, slug),
    switchRule: switchRuleAction.bind(null, slug),
    moveRule: moveRuleAction.bind(null, slug),
    removeRule: deleteRuleAction.bind(null, slug),
    saveField: saveFieldAction.bind(null, slug),
    switchField: switchFieldAction.bind(null, slug),
    moveField: moveFieldAction.bind(null, slug),
    removeField: deleteFieldAction.bind(null, slug),
  };

  return (
    <AdminTextScope texts={adminTexts(lang, ["shipping"])}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={w.title}
          meta={[
            <span key="sentence">
              <span className="text-ink">
                {w.sentence.lead}
                {store.checkoutContact.phone === "required" && w.sentence.phone}
              </span>
              {w.sentence.accounts[mode]}
              {rules.some((r) => r.enabled) ? countWords(rules.filter((r) => r.enabled).length, w.sentence.rules) : w.sentence.all}
            </span>,
          ]}
        />
        <CheckoutAsksCard
          mode={mode}
          contact={store.checkoutContact}
          canWrite={canWrite}
          saveMode={saveAccountsModeAction.bind(null, slug)}
          saveContact={saveContactFieldsAction.bind(null, slug)}
          questions={fields.filter((f) => f.enabled).map((f) => ({ id: f.id, label: f.label.text, required: f.required }))}
        />
        <RuleList
          examples={ruleExamples}
          rules={rules.map((r) => ({ id: r.id, name: r.name, enabled: r.enabled, conditions: r.conditions, effect: r.effect, skips: r.skips.map((s) => ({ reason: s.reason, count: s.count, since: when(s.lastAt) })) }))}
          choices={choices}
          canWrite={canWrite}
          actions={actions}
        />
        <FieldList
          fields={fields.map((f) => ({
            id: f.id,
            kind: f.kind,
            required: f.required,
            label: f.label,
            help: f.help,
            enabled: f.enabled,
            width: f.width,
            options: f.options,
            sensitive: f.sensitive,
            bounds: f.bounds,
            conditions: f.conditions,
          }))}
          choices={choices}
          locales={choices.locales}
          mainLocale={store.localization.locales[0] ?? "en"}
          canWrite={canWrite}
          actions={actions}
          examples={fieldExamples}
        />
        <p className="text-sm text-muted">{fillWords(w.limits, { rules: String(RULES_MAX), fields: String(FIELDS_MAX) })}</p>
      </div>
    </AdminTextScope>
  );
}
