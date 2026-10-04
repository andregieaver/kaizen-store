import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { isTermsMode, termsSettingProblem, type TermsMode } from "@/lib/checkout-terms";
import { isLegalRole, LEGAL_ROLES, LEGAL_ROLE_COPY, type LegalRole } from "@/lib/legal-roles";
import { missingFacts } from "@/lib/legal-facts";
import { isStarterRole, legalStarter, starterLanguageOf, type StarterLanguage, type StarterPage, type StarterRole } from "@/lib/legal-starters";
import { newPageContent, type PageContent } from "@/lib/page-content";
import { translationOf, withTranslation } from "@/lib/page-translation";

import { audit, type Membership } from "./auth";
import { auditChange } from "./audit";
import { legalFacts } from "./legal-facts";
import { ownerLanguages, pagesTag, savePage, setPageRole } from "./pages";
import { memberCan, NO_ACCESS } from "./permissions";
import { refreshTag } from "./refresh";
import { storeTag } from "./stores";

type Row = Record<string, unknown>;

/**
 * The legal pages screen's server side (wave 1, 1e, docs/wave-1-trust.md 2.1, 2.4): making a starter draft for terms, privacy,
 * returns, shipping, withdrawal information or an imprint from the store's own facts; choosing the page for each legal role; and
 * what checkout says about the terms. Owners only (the page is the owner's; each function checks again).
 *
 * A starter is **always a draft**, never published and never overwriting: making one again makes another. It is hand-written text in
 * nb, sv, da or en (no model wrote a word of it), carries the review notice and `[[placeholders]]` for every fact the store does
 * not hold, and the builder's checker blocks publishing over both until the owner has dealt with them.
 */

export type StarterOutcome = { ok: true; id: string; slug: string; language: StarterLanguage; /** The store's other languages the page was also written in. */ translations: string[]; /** The main language is none of the four: English, with the notice saying so. */ translatedNotice: boolean } | { ok: false; problems: string[] };

const owner = (member: Pick<Membership, "role" | "kind" | "permissions">): { ok: false; problems: string[] } | null => (memberCan(member, "owner") ? null : { ok: false, problems: [NO_ACCESS] });

/** The page as the starter's rows make it, for the translation maths and the save. */
const contentOf = (page: { title: string; slug: string; rows: PageContent["rows"] }): PageContent => ({ ...newPageContent(), title: page.title, slug: page.slug, rows: page.rows });

/** Makes a page's rows in one language of the four, with block ids from `id`; `translated` is true when the main language is none of the four (English, with the notice saying so). */
export type DraftBuilder = (language: StarterLanguage, id: () => string, translated: boolean) => { ok: true; page: StarterPage } | { ok: false; problems: string[] };

/**
 * Saves a hand-written page as a **draft** in the store's main language when it is one of nb, sv, da and en (English with the notice
 * extended where it is not), and writes its texts in the store's other languages among the four as translations of the same blocks
 * (every language is built with the same block ids). The address is the kind's own in the page's language; one already taken gets
 * `-2`, `-3`. Never publishes and never touches a page that exists: making one again makes another. Shared by the starters and the
 * accessibility statement.
 */
export async function makeDraftPage(member: Membership, build: DraftBuilder): Promise<StarterOutcome & { title?: string }> {
  const { store, account } = member;
  const languages = await ownerLanguages(store.id);
  const main = languages[0];
  if (!main) return { ok: false, problems: ["The store has no language yet."] };
  const mainLanguage = starterLanguageOf(main.locale);
  const language: StarterLanguage = mainLanguage ?? "en";

  // Block ids come from one list, replayed for each other language, so every language of the page is written against the same blocks.
  const ids: string[] = [];
  const first = () => {
    const id = crypto.randomUUID();
    ids.push(id);
    return id;
  };
  const replay = () => {
    let i = 0;
    return () => ids[i++];
  };
  const starter = build(language, first, mainLanguage === null);
  if (!starter.ok) return starter;
  let content: PageContent = contentOf(starter.page);
  const written: string[] = [];
  // Other languages are written only where the main one is one of the four: the page then reads in each of the store's languages we have words for.
  if (mainLanguage !== null) {
    for (const other of languages.slice(1)) {
      const otherLanguage = starterLanguageOf(other.locale);
      if (!otherLanguage || otherLanguage === language) continue;
      const translated = build(otherLanguage, replay(), false);
      if (!translated.ok) continue;
      content = withTranslation(content, other.locale, translationOf(content, contentOf(translated.page)));
      written.push(other.locale);
    }
  }

  let made: Awaited<ReturnType<typeof savePage>> | null = null;
  let slug = starter.page.slug;
  for (let n = 1; n <= 8; n++) {
    slug = n === 1 ? starter.page.slug : `${starter.page.slug}-${n}`;
    made = await savePage(account, store.id, null, { ...content, slug }, { publish: false, type: "page" });
    if (made.ok || !made.problems.some((p) => /address|slug/i.test(p))) break;
  }
  if (!made || !made.ok) return { ok: false, problems: made ? made.problems : ["The page could not be made."] };
  refreshTag(pagesTag(store.id));
  return { ok: true, id: made.id, slug, language, translations: written, translatedNotice: mainLanguage === null, title: starter.page.title };
}

/** Makes a draft starter page of one kind from the store's own facts. Audit-logged as `store.legal_starter_made`. */
export async function createLegalStarter(member: Membership, kind: StarterRole): Promise<StarterOutcome> {
  const refusal = owner(member);
  if (refusal) return refusal;
  if (!isStarterRole(kind)) return { ok: false, problems: ["That kind of page has no starter."] };
  const facts = await legalFacts(member.store);
  const made = await makeDraftPage(member, (language, id, translated) => ({ ok: true, page: legalStarter(kind, language, facts, id, { translatedNotice: translated }) }));
  if (!made.ok) return made;
  await audit(member.account.id, member.store.id, "store.legal_starter_made", { role: kind, page: made.id, language: made.language, ...(made.translations.length > 0 && { translations: made.translations }) }, { target: { type: "page", id: made.id }, area: "website" });
  return made;
}

export type LegalRoleResult = { ok: true } | { ok: false; problems: string[] };

/** Chooses the store's published page for a legal role, or none with null. Through `setPageRole()`, which holds the same rules as for every role. */
export async function setLegalRole(member: Membership, role: LegalRole, pageId: string | null): Promise<LegalRoleResult> {
  const refusal = owner(member);
  if (refusal) return refusal;
  if (!isLegalRole(role)) return { ok: false, problems: ["That is not a legal page."] };
  const result = await setPageRole(member.account, member.store.id, role, pageId);
  if (result.ok) {
    refreshTag(pagesTag(member.store.id));
    refreshTag(storeTag(member.store.slug));
  }
  return result;
}

/** What checkout says about the terms: link, tick box or nothing. A tick box needs a published terms page to tick for. */
export async function setTermsMode(member: Membership, mode: unknown): Promise<LegalRoleResult> {
  const refusal = owner(member);
  if (refusal) return refusal;
  if (!isTermsMode(mode)) return { ok: false, problems: ["Choose link, tick box or off."] };
  // Read now, not from the cached store: the check is about what is chosen at this moment.
  const roles = await db().execute<Row>(sql`select role from commerce.page_roles where store_id = ${member.store.id}::uuid and role = any(array['terms', 'privacy'])`);
  const chosen = Object.fromEntries(roles.map((r) => [String(r.role), true]));
  const problem = termsSettingProblem(mode, chosen);
  if (problem) return { ok: false, problems: [problem] };
  const [before] = await db().execute<Row>(sql`select terms_at_checkout from commerce.stores where id = ${member.store.id}::uuid`);
  const was = String(before?.terms_at_checkout ?? "link");
  if (was === mode) return { ok: true };
  await db().execute(sql`update commerce.stores set terms_at_checkout = ${mode} where id = ${member.store.id}::uuid`);
  await auditChange(member, "store.terms_mode_changed", { type: "store", id: member.store.id, label: member.store.name }, { termsAtCheckout: was }, { termsAtCheckout: mode }, "store");
  refreshTag(storeTag(member.store.slug));
  return { ok: true };
}

export type LegalPageEntry = {
  role: LegalRole;
  name: string;
  hint: string;
  /** Whether a starter can be made for it (the accessibility statement has its own screen). */
  starter: boolean;
  /** The page chosen for it, and whether it was published. */
  page: { id: string; title: string; slug: string } | null;
  /** The newest draft starter made for it that is not chosen (not published, or published and not chosen). */
  draft: { id: string; title: string; slug: string; published: boolean } | null;
};

export type LegalOverview = {
  roles: LegalPageEntry[];
  /** The store's published pages a role can be given: not the front page, All products, or another role's. */
  choosable: { id: string; title: string; slug: string; /** The role it already holds, if any: a page has one place, so it can be given another only after it is let go. */ role: string | null }[];
  termsAtCheckout: TermsMode;
  /** Facts the store has not given, in the owner's words, for the screen to list before a starter is made. */
  missing: string[];
};

/** The legal pages screen: what is chosen for each role, the draft starters made, what is missing, and what checkout says. */
export async function legalOverview(member: Membership): Promise<LegalOverview> {
  const { store } = member;
  const [chosen, made, pages, [mode], facts] = await Promise.all([
    db().execute<Row>(sql`
      select r.role, p.id, coalesce(nullif(p.published ->> 'title', ''), p.draft ->> 'title', p.slug) as title, p.slug
      from commerce.page_roles r join commerce.pages p on p.id = r.page_id and p.store_id = r.store_id
      where r.store_id = ${store.id}::uuid and r.role = any(${sql.raw(`array[${LEGAL_ROLES.map((r) => `'${r}'`).join(", ")}]`)}::text[])
    `),
    db().execute<Row>(sql`
      select distinct on (l.details ->> 'role') l.details ->> 'role' as role, p.id, coalesce(nullif(p.draft ->> 'title', ''), p.slug) as title, p.slug, p.published_at is not null as published
      from commerce.audit_log l join commerce.pages p on p.id::text = l.details ->> 'page' and p.store_id = l.store_id
      where l.store_id = ${store.id}::uuid and l.action = 'store.legal_starter_made'
      order by l.details ->> 'role', l.id desc
    `),
    db().execute<Row>(sql`
      select p.id, coalesce(nullif(p.published ->> 'title', ''), p.slug) as title, p.slug,
        (select r.role from commerce.page_roles r where r.store_id = p.store_id and r.page_id = p.id) as role,
        p.id = s.front_page_id or p.id = s.products_page_id as taken
      from commerce.pages p join commerce.stores s on s.id = p.store_id
      where p.store_id = ${store.id}::uuid and p.type = 'page' and p.published_at is not null
      order by lower(coalesce(nullif(p.published ->> 'title', ''), p.slug))
    `),
    db().execute<Row>(sql`select terms_at_checkout from commerce.stores where id = ${store.id}::uuid`),
    legalFacts(store),
  ]);
  const chosenBy = new Map(chosen.map((r) => [String(r.role), r]));
  const madeBy = new Map(made.map((r) => [String(r.role), r]));
  return {
    roles: LEGAL_ROLES.map((role) => {
      const page = chosenBy.get(role);
      const draft = madeBy.get(role);
      return {
        role,
        name: LEGAL_ROLE_COPY[role].name,
        hint: LEGAL_ROLE_COPY[role].hint,
        starter: isStarterRole(role),
        page: page ? { id: String(page.id), title: String(page.title), slug: String(page.slug) } : null,
        draft: draft && (!page || String(page.id) !== String(draft.id)) ? { id: String(draft.id), title: String(draft.title), slug: String(draft.slug), published: Boolean(draft.published) } : null,
      };
    }),
    // A page already holding another role cannot be given a second (one place each); front and All products pages are taken.
    choosable: pages.filter((p) => !p.taken).map((p) => ({ id: String(p.id), title: String(p.title), slug: String(p.slug), role: p.role ? String(p.role) : null })),
    termsAtCheckout: isTermsMode(mode?.terms_at_checkout) ? mode.terms_at_checkout : "link",
    missing: missingFacts(facts),
  };
}

