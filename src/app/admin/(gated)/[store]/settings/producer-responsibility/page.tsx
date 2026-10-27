import type { Metadata } from "next";
import Link from "next/link";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { ProducerRegistrationForm, RemoveRegistration } from "@/components/admin/producer-registration-form";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import type { SettingsMessages } from "@/lib/admin-messages/settings.en";
import { adminText, adminTexts } from "@/lib/admin-text";
import { endingSoon, firstBlockedDay, isSchemeId, registrationState, SCHEME_IDS, type MissingGroup, type SchemeId } from "@/lib/producer-registrations";
import { memberCan, requirePermission } from "@/server/permissions";
import { listRegistrations, missingRegistrations, storeToday } from "@/server/producer-registrations";
import { listCountries } from "@/server/stores";

import { removeRegistrationAction, saveRegistrationAction } from "./actions";

export const metadata: Metadata = { title: "Producer responsibility" };

/** How many of a group's products are named before "and n more". */
const NAMED = 5;

/**
 * Producer responsibility (wave 7 unit H, D342, `docs/wave-7-storefront.md` section 4, H): what is not sold for want of a registration first, in
 * plain words with the way to fix it, then the store's registrations and exemptions, then the form to add or change one. A product under a scheme
 * is not sold in a country where nothing valid covers it on the store's day (`commerce.registration_blocks()`); the cart and checkout refuse it
 * alike. The wording on what the law asks is ours and needs legal review.
 */
export default async function ProducerResponsibilityPage({ params, searchParams }: PageProps<"/admin/[store]/settings/producer-responsibility">) {
  const current = await requirePermission((await params).store, "settings:read");
  // Part of the online shop (D178 step 5): with it off nothing is sold, so nothing is blocked.
  const shopOff = requireFeature(current, "shop");
  if (shopOff) return shopOff;
  const { store } = current;
  const editor = memberCan(current, "settings:write");
  const lang = adminLangOf(current.account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const all = adminText(lang, "settings");
  const w = all.producer;
  const schemeNames = adminText(lang, "product").legal.schemeNames as Record<SchemeId, string>;
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);

  const [registrations, missing, today, countries] = await Promise.all([
    listRegistrations(store.id),
    missingRegistrations(store.id, store.localization.locales[0] ?? "en"),
    storeToday(store.id),
    listCountries(),
  ]);
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  const dayWords = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const soon = new Set(endingSoon(registrations, today).map((r) => r.id));
  const base = `/admin/${store.slug}`;
  const here = `${base}/settings/producer-responsibility`;

  const blocked = missing.filter((g) => g.blocked);
  const unrecorded = missing.filter((g) => !g.blocked);

  const gaps = { w, schemeNames, countryName, base, here, editor };

  const editing = registrations.find((r) => r.id === one(query.edit)) ?? null;
  const startScheme = one(query.scheme);
  const start = !editing && isSchemeId(startScheme) && store.keptMarkets.some((m) => m.code === one(query.market)) ? { scheme: startScheme, market: one(query.market)! } : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.description} />
      {!editor && <p className="text-sm">{all.common.readOnly}</p>}

      <Card title={w.missingTitle} description={blocked.length > 0 ? w.missingIntro : undefined}>
        {blocked.length === 0 ? (
          <p className="text-sm text-muted" data-testid="producer-nothing-blocked">
            {w.noneMissing}
          </p>
        ) : (
          <GapList groups={blocked} label={w.missingTitle} count={w.products} {...gaps} />
        )}
      </Card>

      {unrecorded.length > 0 && (
        <Card title={w.unrecordedTitle} description={w.unrecordedIntro}>
          <GapList groups={unrecorded} label={w.unrecordedTitle} count={w.unrecordedProducts} {...gaps} />
        </Card>
      )}

      <AdminTextScope texts={adminTexts(lang, ["settings"])}>
        <Card title={w.listTitle}>
          {registrations.length === 0 ? (
            <p className="text-sm text-muted">{w.listEmpty}</p>
          ) : (
            <List label={w.listTitle}>
              {registrations.map((r) => {
                const state = registrationState(r, today);
                const next = firstBlockedDay(r);
                return (
                  <ListRow key={r.id}>
                    <RowLead
                      title={fillWords(w.groupTitle, { scheme: schemeNames[r.scheme], country: countryName(r.market) })}
                      sub={
                        <>
                          {r.kind === "registered"
                            ? fillWords(w.numberLine, { number: r.number ?? "", authority: r.authority ?? "" })
                            : fillWords(w.exemptLine, { reason: r.exemption ?? "" })}
                          {r.showNumber && ` · ${w.shown}`}
                          {soon.has(r.id) && r.validTo && next && (
                            <span className="block text-warning-text">{fillWords(w.endsSoon, { date: dayWords(r.validTo), next: dayWords(next) })}</span>
                          )}
                        </>
                      }
                    />
                    <RowFact>{r.validTo ? fillWords(w.fromTo, { from: dayWords(r.validFrom), to: dayWords(r.validTo) }) : fillWords(w.fromOpen, { from: dayWords(r.validFrom) })}</RowFact>
                    <Chip signal={state === "valid" ? "positive" : state === "ended" ? "danger" : "neutral"}>{w.states[state]}</Chip>
                    {editor && (
                      <RowActions>
                        <ButtonLink size="dense" href={`${here}?edit=${r.id}#registration-form`}>
                          {w.edit}
                        </ButtonLink>
                        <RemoveRegistration action={removeRegistrationAction.bind(null, store.slug)} id={r.id} />
                      </RowActions>
                    )}
                  </ListRow>
                );
              })}
            </List>
          )}
        </Card>

        {editor && (
          <div id="registration-form">
            <Card title={editing ? w.formTitleEdit : w.formTitle} description={w.formIntro}>
              <ProducerRegistrationForm
                key={editing?.id ?? (start ? `${start.scheme}:${start.market}` : "new")}
                action={saveRegistrationAction.bind(null, store.slug)}
                schemes={SCHEME_IDS.map((id) => ({ id, label: schemeNames[id] }))}
                markets={store.keptMarkets.map((m) => ({ code: m.code, name: countryName(m.code) }))}
                today={today}
                editing={editing}
                start={start}
                cancelHref={editing || start ? here : undefined}
              />
            </Card>
          </div>
        )}
      </AdminTextScope>

      <p className="text-sm text-muted">{w.review}</p>
    </div>
  );
}

type SettingsWords = SettingsMessages["producer"];

/** Products grouped by scheme and country, each group's products named and, for editors, a way to add the registration it lacks. */
function GapList({
  groups,
  label,
  count,
  w,
  schemeNames,
  countryName,
  base,
  here,
  editor,
}: {
  groups: MissingGroup[];
  label: string;
  count: { one: string; many: string };
  w: SettingsWords;
  schemeNames: Record<SchemeId, string>;
  countryName: (code: string) => string;
  base: string;
  here: string;
  editor: boolean;
}) {
  return (
    <List label={label}>
      {groups.map((group) => (
        <ListRow key={`${group.scheme}:${group.market}`}>
          <RowLead
            title={fillWords(w.groupTitle, { scheme: schemeNames[group.scheme], country: countryName(group.market) })}
            sub={
              <>
                {countWords(group.products.length, count)}:{" "}
                {group.products.slice(0, NAMED).map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ", "}
                    <Link href={`${base}/products/${p.id}`} className="underline">
                      {p.title}
                    </Link>
                  </span>
                ))}
                {group.products.length > NAMED && ` ${countWords(group.products.length - NAMED, w.more)}`}
              </>
            }
          />
          {editor && (
            <RowActions>
              <ButtonLink size="dense" href={`${here}?scheme=${group.scheme}&market=${group.market}#registration-form`}>
                {w.addFor}
              </ButtonLink>
            </RowActions>
          )}
        </ListRow>
      ))}
    </List>
  );
}
