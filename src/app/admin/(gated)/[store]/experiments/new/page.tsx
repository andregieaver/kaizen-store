import type { Metadata } from "next";

import { ExperimentForm } from "@/components/admin/experiment-form";
import { requirePermission } from "@/server/permissions";
import { describePart, testablePart, type PartKind } from "@/lib/experiment-parts";
import { buttonsOf, formsOf, goalDestinations, listExperiments, plansWithTests, publishedContentOf, siteForms, testablePages, testRoom, type FormPlace } from "@/server/experiment-admin";

/** No page: every published page's forms are offered, and the form leaves out the chosen page's own. */
const NO_PAGE = "00000000-0000-4000-8000-000000000000";
import { experimentTraffic } from "@/server/experiment-traffic";
import { houseStoreId } from "@/server/house-customers";
import type { TargetHistory } from "@/components/admin/experiment-form";
import { ButtonLink, Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { partLabelText, variantNameText } from "@/lib/experiment-words";

import { createExperimentAction } from "../actions";
import { requireExtension } from "@/components/admin/extension-off";

export const metadata: Metadata = { title: "New A/B test" };

export default async function NewExperimentPage({ params, searchParams }: PageProps<"/admin/[store]/experiments/new">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const notInAccount = requireExtension(member, "ab_testing");
  if (notInAccount) return notInAccount;
  const { store, account } = member;
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "experiments");
  const base = `/admin/${store.slug}/experiments`;
  // A plan without A/B tests (D148 phase 21): what they give and the plans that have them, not the form.
  if ((await testRoom(store.id)).planAllows === 0) {
    const plans = await plansWithTests();
    const list = new Intl.ListFormat(ADMIN_LANG_FACTS[lang].locale, { style: "long", type: "disjunction" }).format(plans);
    return (
      <div className="flex flex-col gap-6">
        <PageHeader back={{ href: base, label: w.page.back }} title={w.newTest.title} />
        <div data-plan-without-tests>
          <Card title={w.newTest.noPlan.title} description={w.newTest.noPlan.body}>
            <div className="flex flex-col items-start gap-3">
              {plans.length > 0 && <p className="text-body text-ink-2">{fillWords(w.newTest.noPlan.plans, { plans: list })}</p>}
              <ButtonLink kind="main" href={`/admin/${store.slug}/billing`}>
                {w.newTest.noPlan.choose}
              </ButtonLink>
              <p className="text-body text-muted">{w.newTest.noPlan.kept}</p>
            </div>
          </Card>
        </div>
      </div>
    );
  }
  const query = await searchParams;
  const asked = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  let pages = await testablePages(store.id);
  // From the builder's "A/B test this" (D148): one page, and a part of it.
  const partTarget = asked("part") ? { id: asked("part"), kind: asked("kind") as PartKind } : null;
  if (asked("page")) pages = pages.filter((p) => p.id === asked("page"));
  // A working page (the cart, the checkout …) is tested by a part of it only: it is not on the list of whole pages, and a part chosen in the builder reaches it.
  if (!partTarget) pages = pages.filter((p) => !p.partOnly);
  // The buttons and the forms of each page, for a test that counts clicks or forms sent.
  const withButtons = await Promise.all(
    pages.map(async (p) => {
      const content = await publishedContentOf(store.id, p.id);
      return { ...p, buttons: buttonsOf(content), forms: formsOf(content) };
    }),
  );
  // The shop's own traffic and each target's last test (D660): how soon each goal answers, and what was tried before.
  // The pages a visitor can go on to and the forms elsewhere on the site (phase 20): the form leaves out the chosen page's own.
  const [traffic, tests, houseId, destinations, formsElsewhere] = await Promise.all([
    experimentTraffic(store, pages),
    listExperiments(store.id),
    houseStoreId(),
    goalDestinations(store.id),
    siteForms(store.id, pages.length === 1 ? pages[0].id : NO_PAGE),
  ]);
  const placeOf = (place: FormPlace) => (place.kind === "page" ? place.title : w.kinds[place.kind].name);
  const elsewhere = formsElsewhere.map((f) => ({ id: f.id, label: `${f.label} · ${placeOf(f.place)}` }));
  const goesTo = destinations.map((d) => ({ id: d.id, title: d.role === "front" || d.role === "products" ? w.roles[d.role] : d.title }));
  const history: Record<string, TargetHistory> = {};
  for (const t of [...tests].filter((x) => x.status !== "draft").sort((a, b) => (b.startedAt ?? b.createdAt).localeCompare(a.startedAt ?? a.createdAt))) {
    if (history[t.page.id] || t.status === "draft") continue;
    history[t.page.id] = { status: t.status, winner: t.appliedVariant ? variantNameText(t.variants.find((v) => v.key === t.appliedVariant)?.name ?? "", w) : null };
  }
  let part = null;
  if (partTarget && withButtons[0]) {
    const content = await publishedContentOf(store.id, withButtons[0].id);
    const described = content && testablePart(content, partTarget, withButtons[0].kind) ? describePart(content, partTarget) : null;
    part = described ? { ...described, label: partLabelText(described.label, w) } : null;
  }
  const seen = new Set<string>();
  const markets = store.markets.flatMap((m) => (seen.has(m.code) ? [] : (seen.add(m.code), [{ code: m.code.toLowerCase(), name: m.name }])));
  return (
    <AdminTextScope texts={adminTexts(lang, ["experiments"])}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: base, label: w.page.back }} title={w.newTest.title} />
      {asked("page") && pages.length === 0 ? (
        <p role="alert" className={`p-5 text-sm ${CARD_CLASS}`}>
          {w.newTest.cannotPage}
        </p>
      ) : partTarget && !part ? (
        <p role="alert" className={`p-5 text-sm ${CARD_CLASS}`}>
          {w.newTest.cannotPart}
        </p>
      ) : (
        <ExperimentForm pages={withButtons} markets={markets} create={createExperimentAction.bind(null, store.slug)} base={base} part={part} traffic={traffic} history={history} house={houseId === store.id} destinations={goesTo} siteForms={elsewhere} timeZone={store.timeZone} />
      )}
    </div>
    </AdminTextScope>
  );
}
