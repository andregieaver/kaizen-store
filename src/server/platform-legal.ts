import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { readDb } from "@/db/client";
import { audit, type Account } from "@/server/auth";
import { savePage } from "@/server/pages";
import { houseStoreId } from "@/server/house-customers";
import { owned } from "@/server/owned";
import { col, typedRow } from "@/server/typed-rows";
import { accountOfficer, platformAccountId } from "@/server/privacy-officers";
import type { BusinessDetails } from "@/lib/navigation";
import { parseBusinessDetails } from "@/lib/navigation-schema";
import { pageExcerpt, parsePageContent, type PageContent } from "@/lib/page-content";
import {
  legalPageContent,
  missingFacts,
  PLATFORM_LEGAL_KINDS,
  PLATFORM_LEGAL_SLUGS,
  type PlatformLegalFacts,
  type PlatformLegalKind,
} from "@/lib/platform-legal";

type Row = Record<string, unknown>;

export type LegalPageState = { kind: PlatformLegalKind; slug: string; id: string | null; published: boolean; written: boolean };
export type LegalPagesOverview = { pages: LegalPageState[]; missing: (keyof BusinessDetails)[] };

export type LegalWriteOutcome = {
  kind: PlatformLegalKind;
  /** null: the platform's own copy; else the house store's id (while kaizenaflow.com is served from it). */
  owner: string | null;
  outcome: "made" | "written" | "kept" | "failed";
  id: string | null;
  problems?: string[];
};

/** The facts the pages are written from: Kaizena Flow's business details and its sale fee. */
async function platformFacts(today: Date): Promise<PlatformLegalFacts> {
  const [row] = await readDb().execute<Row>(sql`select business, sale_fee_bps from commerce.platform_settings`);
  // Kaizena Flow's own data protection officer (D763): the platform account's.
  const platform = await platformAccountId();
  const officer = platform ? await accountOfficer(platform) : null;
  return { business: parseBusinessDetails(row?.business), saleFeeBps: Number(row?.sale_fee_bps ?? 0), today, officer: officer ? { name: officer.name, email: officer.email } : null };
}

/** Kaizena Flow's own page at an address (`owner` null), or the house store's (`owner` its id), with what it shows (null: none there). */
async function pageAt(slug: string, owner: string | null = null): Promise<{ id: string; published: PageContent | null } | null> {
  const row = await typedRow(
    z.object({ id: col.uuid, published: z.unknown().nullable() }),
    sql`select id, published from commerce.pages where ${owned(owner)} and type = 'page' and slug = ${slug}`,
  );
  return row ? { id: row.id, published: row.published ? parsePageContent(row.published) : null } : null;
}

/** The house store, when kaizenaflow.com is served from it (D484): its own copies of the legal pages are the ones visitors read. */
async function houseSiteStore(): Promise<string | null> {
  const on = await typedRow(z.object({ on: col.bool }), sql`select site_from_store as on from commerce.platform_settings`);
  return on?.on ? houseStoreId() : null;
}

/** A page counts as written when it is published with words of its own: the empty privacy page made with the site is not. */
const hasWords = (content: PageContent | null): boolean => content !== null && pageExcerpt(content).trim().length > 0;

/** Where each of the three pages stands, and which business details the texts would show as placeholders. */
export async function platformLegalOverview(): Promise<LegalPagesOverview> {
  const facts = await platformFacts(new Date());
  const owner = await houseSiteStore();
  const pages = await Promise.all(
    PLATFORM_LEGAL_KINDS.map(async (kind): Promise<LegalPageState> => {
      const slug = PLATFORM_LEGAL_SLUGS[kind];
      const page = await pageAt(slug, owner);
      return { kind, slug, id: page?.id ?? null, published: Boolean(page?.published), written: hasWords(page?.published ?? null) };
    }),
  );
  return { pages, missing: missingFacts(facts.business) };
}

/**
 * Writes and publishes Kaizena Flow's terms, privacy notice and data processing agreement in English and Norwegian (D312 P5). A page
 * that is missing is made; one that is published with words of its own is kept unless `overwrite` names it; the rest are written over.
 * Each goes through `savePage()` and is published at once (no review, the owner's decision). Audit-logged as `platform.legal_pages_written`.
 */
export async function writePlatformLegalPages(admin: Account, { overwrite = [] }: { overwrite?: readonly PlatformLegalKind[] } = {}): Promise<LegalWriteOutcome[]> {
  const facts = await platformFacts(new Date());
  const outcomes: LegalWriteOutcome[] = [];
  // While kaizenaflow.com is served from the house store (D484), its copies are the ones visitors read, and the platform's own are frozen
  // (`savePage()` refuses them): the house store's are written then, the platform's otherwise.
  const owner = await houseSiteStore();
  for (const kind of PLATFORM_LEGAL_KINDS) {
    const existing = await pageAt(PLATFORM_LEGAL_SLUGS[kind], owner);
    if (existing && hasWords(existing.published) && !overwrite.includes(kind)) {
      outcomes.push({ kind, owner, outcome: "kept", id: existing.id });
      continue;
    }
    const saved = await savePage(admin, owner, existing?.id ?? null, legalPageContent(kind, facts), { publish: true, type: "page" });
    outcomes.push(
      saved.ok
        ? { kind, owner, outcome: existing ? "written" : "made", id: saved.id }
        : { kind, owner, outcome: "failed", id: existing?.id ?? null, problems: saved.problems },
    );
  }
  await audit(admin.id, null, "platform.legal_pages_written", {
    pages: outcomes.map((o) => ({ kind: o.kind, house: o.owner !== null, outcome: o.outcome, page: o.id })),
    missing: missingFacts(facts.business),
  });
  return outcomes;
}
