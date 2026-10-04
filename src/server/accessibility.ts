import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  a11yProblems,
  accessibilityStatement,
  DEFAULT_A11Y_SETTINGS,
  isA11yStatus,
  type A11yFacts,
  type A11ySettings,
} from "@/lib/a11y-statement";
import { pageIssues, blockingIssues, themeSetsOf } from "@/lib/page-a11y";
import { parsePageContent } from "@/lib/page-content";
import { marketPath, storeBase, storeSiteUrl } from "@/lib/paths";
import { parseStoreTheme, themeWarnings } from "@/lib/theme";

import { audit, type Membership } from "./auth";
import { makeDraftPage, type StarterOutcome } from "./legal-starters";
import { memberCan, NO_ACCESS } from "./permissions";
import { refreshTag } from "./refresh";
import { storeTag, type Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The accessibility statement's server side (wave 1, 1e, docs/wave-1-trust.md 2.3, 4.3): what the owner says about the site's
 * assessment (`commerce.accessibility_settings`), what the site itself knows (read here, never given by the owner), and a draft
 * statement made from the two. The statement defaults to "has not been assessed" and says "meets the requirements" only with an
 * assessor and a date (the form, the generator and the database all hold to it). It is hand-written text, flagged for review.
 */

const owner = (member: Pick<Membership, "role" | "kind" | "permissions">): { ok: false; problems: string[] } | null => (memberCan(member, "owner") ? null : { ok: false, problems: [NO_ACCESS] });

const text = (value: unknown): string | null => {
  const v = typeof value === "string" ? value.trim() : "";
  return v === "" ? null : v;
};
const day = (value: unknown): string | null => {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return text(value);
};

/** What the owner's form sent, as settings (blank is null; anything that is not a known status is left to `a11yProblems()` to refuse). */
export function parseA11yInput(raw: Record<string, unknown>): A11ySettings {
  return {
    status: (typeof raw.status === "string" && isA11yStatus(raw.status) ? raw.status : raw.status === undefined ? "not_assessed" : (raw.status as string)) as A11ySettings["status"],
    assessedBy: text(raw.assessedBy),
    assessedOn: day(raw.assessedOn),
    reportUrl: text(raw.reportUrl),
    assessmentNote: text(raw.assessmentNote),
    microenterprise: raw.microenterprise === true || raw.microenterprise === "on" || raw.microenterprise === "true",
    knownIssues: typeof raw.knownIssues === "string" ? raw.knownIssues.trim() : "",
    contactEmail: text(raw.contactEmail),
    preparedOn: day(raw.preparedOn),
    reviewedOn: day(raw.reviewedOn),
  };
}

/** The store's accessibility settings, or the defaults ("not assessed") when it has saved none. */
export async function getA11ySettings(storeId: string): Promise<A11ySettings> {
  const [row] = await db().execute<Row>(sql`
    select status, assessed_by, assessed_on::text as assessed_on, report_url, assessment_note, microenterprise, known_issues,
      contact_email, prepared_on::text as prepared_on, reviewed_on::text as reviewed_on
    from commerce.accessibility_settings where store_id = ${storeId}::uuid
  `);
  if (!row) return { ...DEFAULT_A11Y_SETTINGS };
  return {
    status: isA11yStatus(row.status) ? row.status : "not_assessed",
    assessedBy: text(row.assessed_by),
    assessedOn: text(row.assessed_on),
    reportUrl: text(row.report_url),
    assessmentNote: text(row.assessment_note),
    microenterprise: Boolean(row.microenterprise),
    knownIssues: String(row.known_issues ?? ""),
    contactEmail: text(row.contact_email),
    preparedOn: text(row.prepared_on),
    reviewedOn: text(row.reviewed_on),
  };
}

export type A11yResult = { ok: true } | { ok: false; problems: string[] };

/** Saves what the owner says. Refused (with sentences) when a claim has no assessment behind it; the database holds the same rule. Audit-logged without the notes' words. */
export async function saveA11ySettings(member: Membership, raw: Record<string, unknown>): Promise<A11yResult> {
  const refusal = owner(member);
  if (refusal) return refusal;
  const settings = parseA11yInput(raw);
  const problems = a11yProblems(settings);
  if (problems.length > 0) return { ok: false, problems };
  const before = await getA11ySettings(member.store.id);
  await db().execute(sql`
    insert into commerce.accessibility_settings (store_id, status, assessed_by, assessed_on, report_url, assessment_note, microenterprise, known_issues,
      contact_email, prepared_on, reviewed_on, updated_by)
    values (${member.store.id}::uuid, ${settings.status}, ${settings.assessedBy}, ${settings.assessedOn}::date, ${settings.reportUrl}, ${settings.assessmentNote},
      ${settings.microenterprise}, ${settings.knownIssues}, ${settings.contactEmail}, ${settings.preparedOn}::date, ${settings.reviewedOn}::date, ${member.account.id}::uuid)
    on conflict (store_id) do update set status = excluded.status, assessed_by = excluded.assessed_by, assessed_on = excluded.assessed_on,
      report_url = excluded.report_url, assessment_note = excluded.assessment_note, microenterprise = excluded.microenterprise,
      known_issues = excluded.known_issues, contact_email = excluded.contact_email, prepared_on = excluded.prepared_on,
      reviewed_on = excluded.reviewed_on, updated_at = now(), updated_by = excluded.updated_by
  `);
  await audit(member.account.id, member.store.id, "store.accessibility_updated", { from: before.status, to: settings.status }, { area: "settings", target: { type: "store", id: member.store.id } });
  refreshTag(storeTag(member.store.slug));
  return { ok: true };
}

/**
 * What the site itself knows, for the statement: its addresses and languages, the countries it sells to, how many colour pairs in the
 * theme are below 4.5 to 1, the share of pictures with no alt text (D89), and how many published pages have a blocking issue from the
 * page checker. Read now, from the database; a count that cannot be known is null, never zero.
 */
export async function a11yFacts(store: Store): Promise<A11yFacts> {
  const [theme] = await db().execute<Row>(sql`select theme from commerce.stores where id = ${store.id}::uuid`);
  const settings = parseStoreTheme(theme?.theme).settings;
  const [alt] = await db().execute<Row>(sql`
    select count(*)::int as total, count(*) filter (where btrim(alt) = '')::int as missing
    from commerce.media where store_id = ${store.id}::uuid and kind = 'image'
  `);
  const pages = await db().execute<Row>(sql`
    select p.published from commerce.pages p where p.store_id = ${store.id}::uuid and p.type = 'page' and p.published_at is not null
  `);
  const sets = themeSetsOf(settings);
  let blocked = 0;
  for (const page of pages) {
    const content = parsePageContent(page.published);
    if (content && blockingIssues(pageIssues(content, { theme: { sets } })).length > 0) blocked += 1;
  }
  const names = new Intl.DisplayNames(["en"], { type: "language" });
  const origin = storeSiteUrl(store.slug);
  const addresses = [...new Set(store.markets.map((m) => `${origin}${marketPath(store.slug, m.slug)}`))];
  return {
    storeName: store.name,
    siteAddresses: addresses.length > 0 ? addresses : [`${origin}${storeBase(store.slug)}`],
    languages: [...new Set(store.localization.locales.map((l) => names.of(l.split("-")[0]) ?? l))],
    countries: store.markets.map((m) => m.code),
    themeWarnings: themeWarnings(settings).length,
    mediaWithoutAlt: alt ? { missing: Number(alt.missing), total: Number(alt.total) } : null,
    pagesWithBlockingIssues: blocked,
  };
}

/** Makes a draft of the accessibility statement from the saved settings and the site's own facts; never published, never over an existing page. */
export async function createStatementDraft(member: Membership): Promise<StarterOutcome> {
  const refusal = owner(member);
  if (refusal) return refusal;
  const settings = await getA11ySettings(member.store.id);
  const facts = await a11yFacts(member.store);
  const settingsWithContact: A11ySettings = { ...settings, contactEmail: settings.contactEmail ?? member.store.details.contactEmail };
  const made = await makeDraftPage(member, (language, id, translated) => accessibilityStatement(language, settingsWithContact, facts, id, { translatedNotice: translated }));
  if (!made.ok) return made;
  await audit(member.account.id, member.store.id, "store.legal_starter_made", { role: "accessibility", page: made.id, language: made.language }, { target: { type: "page", id: made.id }, area: "website" });
  return made;
}
