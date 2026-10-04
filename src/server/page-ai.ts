import "server-only";

import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { findClaims } from "@/lib/claims";
import {
  EMPTY_COPY,
  PICTURES_MAX,
  buildPage,
  checkPlan,
  copyClaims,
  copyMessages,
  copyWithoutClaims,
  interviewMessages,
  pageBrief,
  pagePlan,
  picturePrompt,
  planMessages,
  readCopy,
  readInterviewReply,
  readPlan,
  withoutClaims,
  type InterviewReply,
  type PageBrief,
  type PagePlan,
  type PictureJob,
  type SectionCopy,
  type SiteFacts,
  type SiteLink,
  type StudioMessage,
  type StudioResult,
} from "@/lib/page-ai";
import { pageInput, reservedPageSlugs, type PageContent } from "@/lib/page-content";
import { marketPath } from "@/lib/paths";

import { AiError, aiFor, completeText, seeing, speakText, transcribeAudio, type AiConnection, type ChatMessage } from "./ai";
import { makePicture } from "./ai-pictures";
import { audit, type Account } from "./auth";
import { getGoogleSettings } from "./google-reviews";
import { listPublishedPages, ownerLanguages, savePage } from "./pages";
import { getStore } from "./stores";
import { siteTerms } from "./taxonomy";

type Row = Record<string, unknown>;

/**
 * The AI page studio's server side (D92): the site's facts for the model,
 * the interview, the plan, building the draft and filling its pictures.
 * Each step is its own request, so none runs long and the owner sees the
 * page come together; nothing is kept but the draft (the conversation
 * lives in the admin's tab). Every call goes to the owner's AI (`aiFor`),
 * and a model that fails says so rather than leaving half a page.
 */

/** Whose page: a store's (with its slug) or Kaizen's, and who is building it. */
export type StudioOwner = { storeId: string | null; storeSlug: string | null; account: Account };


/** At most this many of the site's products are described to the model. */
const PRODUCTS_TOLD = 40;
/** Sections written at once. */
const WRITING_AT_ONCE = 3;

// ---------------------------------------------------------------------------
// The site's facts
// ---------------------------------------------------------------------------

/** One line of a product's description, without markup, for the model. */
const summary = (text: string) =>
  text
    .replace(/<[^>]*>/g, " ")
    .replace(/[#*_`>[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/**
 * What the model is told of the site: its name, language and buyers, what
 * it says about itself, its contact details, its product categories and
 * some products in their own words (never prices or stock), and every
 * address a page may link to; and what it can have (pictures, a product
 * grid, articles, Google reviews).
 */
export async function siteFacts(owner: StudioOwner, connection: AiConnection | null): Promise<SiteFacts | null> {
  const languages = await ownerLanguages(owner.storeId);
  const main = languages[0] ?? { locale: "en", name: "English" };
  const language = { locale: main.locale, name: new Intl.DisplayNames(["en"], { type: "language" }).of(main.locale) ?? main.locale };
  const articles = await listPublishedPages(owner.storeId, "article");
  const pages = await listPublishedPages(owner.storeId, "page");
  const pictures = Boolean(connection?.image);

  if (owner.storeId === null) {
    const links: SiteLink[] = [
      { label: "Kaizen's front page", href: "/" },
      { label: "Start a store (sign up)", href: "/sign-up" },
      ...pages.map((page) => ({ label: `Page: ${page.content.title}`, href: `/${page.slug}` })),
      ...(articles.length > 0 ? [{ label: "The blog", href: "/blog" }] : []),
      ...articles.slice(0, 10).map((article) => ({ label: `Article: ${article.content.title}`, href: `/blog/${article.slug}` })),
    ];
    return {
      kind: "kaizen",
      name: "Kaizen",
      language,
      about: "Kaizen is an AI-native platform for online stores selling across the EU.",
      audience: null,
      contact: { email: null, address: null },
      links,
      products: [],
      productCategories: [],
      tint: null,
      can: { pictures, productGrid: false, articleGrid: articles.length > 0, googleReviews: Boolean((await getGoogleSettings(null))?.place) },
    };
  }

  const store = owner.storeSlug ? await getStore(owner.storeSlug) : null;
  if (!store || store.id !== owner.storeId) return null;
  const market = store.markets.find((m) => m.locale === main.locale) ?? store.markets[0];
  if (!market) return null;
  const at = (path: string) => marketPath(store.slug, market.slug, path);
  const categories = (await siteTerms(store.id, "product")).filter((term) => term.kind === "category");
  const products = await db().execute<Row>(sql`
    select p.handle, t.title, t.description from commerce.products p
    join commerce.product_translations t on t.product_id = p.id and t.locale = ${main.locale}
    where p.store_id = ${store.id}::uuid and p.status = 'active'
    order by p.created_at desc
    limit ${PRODUCTS_TOLD}
  `);
  const told = products.map((row) => ({ title: String(row.title), href: at(`/p/${String(row.handle)}`), summary: summary(String(row.description ?? "")) }));
  const links: SiteLink[] = [
    { label: "The store's front page", href: at("") },
    { label: "All products", href: at("/products") },
    ...categories.map((category) => ({ label: `Category: ${category.name}`, href: at(`/category/${category.slug}`) })),
    ...pages.map((page) => ({ label: `Page: ${page.content.title}`, href: at(`/${page.slug}`) })),
    ...(articles.length > 0 ? [{ label: "The blog", href: at("/blog") }] : []),
    ...articles.slice(0, 10).map((article) => ({ label: `Article: ${article.content.title}`, href: at(`/blog/${article.slug}`) })),
    ...told.map((product) => ({ label: `Product: ${product.title}`, href: product.href })),
    ...(store.details.contactEmail ? [{ label: "Email the store", href: `mailto:${store.details.contactEmail}` }] : []),
  ];
  // Tinted sections take the theme's surface where the theme has one colour scheme; a fixed colour would not follow a visitor's dark mode.
  const theme = store.theme.settings;
  const tint = theme.mode === "light" ? theme.light.surface : theme.mode === "dark" ? theme.dark.surface : null;
  return {
    kind: "store",
    name: store.name,
    language,
    about: store.seo.description[main.locale] ?? Object.values(store.seo.description)[0] ?? "",
    audience: store.audience,
    contact: { email: store.details.contactEmail, address: store.details.postalAddress },
    links,
    products: told,
    productCategories: categories.map((category) => ({ id: category.id, name: category.name, slug: category.slug })),
    tint,
    can: { pictures, productGrid: true, articleGrid: articles.length > 0, googleReviews: Boolean((await getGoogleSettings(store.id))?.place) },
  };
}

/** What the studio can do on the site: talk (a text model), make pictures, and hear and speak. */
export async function studioAbilities(storeId: string | null): Promise<{ text: boolean; sees: boolean; pictures: boolean; hear: boolean; speak: boolean }> {
  const connection = await aiFor(storeId);
  return {
    text: Boolean(connection?.textModel),
    /** A model that looks at pictures is set up (D163): the page copier's AI needs it. */
    sees: Boolean(seeing(connection)),
    pictures: Boolean(connection?.image),
    hear: Boolean(connection?.transcriptionModel),
    speak: Boolean(connection?.speechModel && connection.speechVoice),
  };
}

async function textConnection(storeId: string | null): Promise<AiConnection | string> {
  const connection = await aiFor(storeId, { feature: "page_studio" });
  return connection?.textModel ? connection : "Set up an AI text model under AI settings to build pages with AI.";
}

const problemOf = (error: unknown) =>
  error instanceof AiError ? `The site's AI did not answer: ${error.message}` : "Something went wrong. Try again.";

/** What the owner has said, the only facts besides the site's the page may state. */
const ownerWords = (history: StudioMessage[]) =>
  history
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join("\n")
    .slice(-12_000);

// ---------------------------------------------------------------------------
// The interview
// ---------------------------------------------------------------------------

/** The AI's next turn in the interview: what it says, the brief so far, and whether it can plan the page. */
export async function interviewTurn(owner: StudioOwner, history: StudioMessage[], brief: PageBrief): Promise<StudioResult<{ reply: InterviewReply }>> {
  const connection = await textConnection(owner.storeId);
  if (typeof connection === "string") return { ok: false, problem: connection };
  const facts = await siteFacts(owner, connection);
  if (!facts) return { ok: false, problem: "The store could not be read." };
  try {
    const { text } = await completeText(connection, interviewMessages(facts, brief, history), {
      maxTokens: 2000,
      temperature: 0.6,
      reasoningEffort: "low",
      timeoutMs: 90_000,
    });
    return { ok: true, reply: readInterviewReply(text, brief) };
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { ok: false, problem: problemOf(error) };
  }
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/**
 * The page's plan from the brief (and, to change one, the plan and what
 * to change), as Kaizen will build it, with what was changed to get there.
 * An answer that cannot be read is asked for once more, with why.
 */
export async function planPage(
  owner: StudioOwner,
  history: StudioMessage[],
  brief: PageBrief,
  change?: { plan: PagePlan; request: string },
): Promise<StudioResult<{ plan: PagePlan; notes: string[] }>> {
  const connection = await textConnection(owner.storeId);
  if (typeof connection === "string") return { ok: false, problem: connection };
  const facts = await siteFacts(owner, connection);
  if (!facts) return { ok: false, problem: "The store could not be read." };
  const words = ownerWords(history);
  const messages: ChatMessage[] = planMessages(facts, brief, words, change);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const { text } = await completeText(connection, messages, { maxTokens: 8000, temperature: 0.5, timeoutMs: 150_000 });
      const read = readPlan(text);
      if (read.ok) {
        const checked = checkPlan(read.plan, facts, words);
        return { ok: true, plan: { ...checked.plan, title: withoutClaims(checked.plan.title) || checked.plan.title }, notes: checked.notes };
      }
      messages.push({ role: "assistant", content: text.slice(0, 8000) }, { role: "user", content: `That could not be read (${read.problem}). Answer again with the JSON only.` });
    }
    return { ok: false, problem: "The site's AI did not answer with a plan Kaizen could read. Try again, or choose another text model." };
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { ok: false, problem: problemOf(error) };
  }
}

// ---------------------------------------------------------------------------
// Building
// ---------------------------------------------------------------------------

/** A section's words, asked again once when they cannot be read or carry a claim; a claim still there goes with its sentence. */
async function writeSection(
  connection: AiConnection,
  facts: SiteFacts,
  brief: PageBrief,
  plan: PagePlan,
  index: number,
  words: string,
): Promise<{ copy: SectionCopy; note: string | null }> {
  const name = plan.sections[index].name;
  let copy: SectionCopy | null = null;
  let claims: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const retry = claims.length > 0 ? { claims } : undefined;
    try {
      const { text } = await completeText(connection, copyMessages(facts, brief, plan, index, words, retry), {
        maxTokens: 4000,
        temperature: 0.7,
        reasoningEffort: "low",
        timeoutMs: 120_000,
      });
      const read = readCopy(text);
      if (!read) continue;
      copy = read;
      const found = copyClaims(read);
      if (found.length === 0) return { copy: read, note: null };
      claims = found.map((claim) => `"${claim.phrase}" (${claim.where})`);
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      if (attempt === 1) return { copy: copy ? copyWithoutClaims(copy) : EMPTY_COPY, note: `"${name}" could not be written (${error.message}); write it in the builder.` };
    }
  }
  if (!copy) return { copy: EMPTY_COPY, note: `"${name}" could not be written; write it in the builder.` };
  return { copy: copyWithoutClaims(copy), note: `"${name}": sentences with claims the site may not make were left out (${claims.join(", ")}).` };
}

async function inTurns<T, R>(items: T[], size: number, work: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index], index);
      }
    }),
  );
  return results;
}

/**
 * Builds the page from its plan: each section's words written (a few at
 * once), checked by the claims filter, turned into the builder's rows and
 * saved as a new draft, never published. Its pictures are left for
 * `fillPicture()`, each job returned for the studio to ask for in turn.
 */
export async function buildDraft(
  owner: StudioOwner,
  history: StudioMessage[],
  brief: PageBrief,
  planned: PagePlan,
): Promise<StudioResult<{ pageId: string; pictures: PictureJob[]; notes: string[] }>> {
  const connection = await textConnection(owner.storeId);
  if (typeof connection === "string") return { ok: false, problem: connection };
  const facts = await siteFacts(owner, connection);
  if (!facts) return { ok: false, problem: "The store could not be read." };
  const words = ownerWords(history);
  // The plan comes back from the browser: checked again as when it was made.
  const { plan, notes } = checkPlan(planned, facts, words);
  const written = await inTurns(plan.sections, WRITING_AT_ONCE, (_, index) => writeSection(connection, facts, brief, plan, index, words));
  const taken = await db().execute<Row>(sql`select slug from commerce.pages where store_id is not distinct from ${owner.storeId}::uuid and type = 'page'`);
  const built = buildPage(plan, written.map((w) => w.copy), facts, {
    newId: randomUUID,
    takenSlugs: taken.map((row) => String(row.slug)),
    reservedSlugs: reservedPageSlugs(owner.storeId, "page"),
  });
  // Alt texts are the page's words too: a claim goes (colours are what a picture looks like, not claims).
  const pictures = built.pictures.map((job) => ({
    ...job,
    prompt: picturePrompt({ prompt: job.prompt, alt: job.alt }, brief),
    alt: findClaims(job.alt, { colours: false }).length > 0 ? "" : job.alt,
  }));
  const saved = await savePage(owner.account, owner.storeId, null, built.content, { publish: false, type: "page" });
  if (!saved.ok) return { ok: false, problem: `The page could not be saved: ${saved.problems.join(" ")}` };
  await audit(owner.account.id, owner.storeId, `${owner.storeId ? "store" : "platform"}.page_ai_built`, {
    page: saved.id,
    sections: plan.sections.map((section) => section.pattern),
    pictures: pictures.length,
  });
  return { ok: true, pageId: saved.id, pictures, notes: [...notes, ...written.flatMap((w) => (w.note ? [w.note] : []))] };
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

/** A picture job as the studio sends it back. */
export const pictureJobInput = z.object({
  key: z.string().max(100),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("block"), blockId: z.string().min(1).max(100) }),
    z.object({ kind: z.literal("row"), rowId: z.string().min(1).max(100) }),
  ]),
  thumbnail: z.boolean(),
  prompt: z.string().trim().min(10).max(4000),
  alt: z.string().trim().max(300),
  shape: z.enum(["landscape", "portrait", "square"]),
});

/** Where the picture goes in the page, if that place is still there and still empty. */
function placePicture(content: PageContent, job: z.infer<typeof pictureJobInput>, picture: { url: string; width: number; height: number }): PageContent | null {
  let placed = false;
  const rows = content.rows.map((row) => {
    if (job.target.kind === "row") {
      if (row.id !== job.target.rowId || row.background) return row;
      placed = true;
      return { ...row, background: { type: "image" as const, image: picture, overlay: { color: "#000000", opacity: 45 } } };
    }
    const blockId = job.target.blockId;
    return {
      ...row,
      columns: row.columns.map((column) => ({
        ...column,
        blocks: column.blocks.map((block) => {
          if (block.id !== blockId || block.type !== "image" || block.image !== null) return block;
          placed = true;
          return { ...block, image: { ...picture, alt: job.alt } };
        }),
      })),
    };
  });
  if (!placed) return null;
  return { ...content, rows, thumbnail: job.thumbnail && !content.thumbnail ? { ...picture, alt: job.alt } : content.thumbnail };
}

/**
 * Makes one of the page's pictures with the site's picture model, keeps it
 * in the media library and puts it in its place in the draft, under a lock
 * so pictures made at once never undo each other. A place the owner has
 * filled or taken out meanwhile is left alone.
 */
export async function fillPicture(owner: StudioOwner, pageId: string, raw: unknown): Promise<StudioResult<{ url: string }>> {
  const parsed = pictureJobInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "The picture could not be read." };
  const job = parsed.data;
  const connection = await aiFor(owner.storeId, { feature: "page_studio" });
  if (!connection?.image) return { ok: false, problem: "Set up a picture model under AI settings to make pictures." };
  const [page] = await db().execute<Row>(sql`
    select id from commerce.pages where id = ${pageId}::uuid and store_id is not distinct from ${owner.storeId}::uuid and type = 'page'
  `);
  if (!page) return { ok: false, problem: "The page is gone." };

  let made: Awaited<ReturnType<typeof makePicture>>;
  try {
    made = await makePicture(connection, { storeId: owner.storeId, accountId: owner.account.id }, { prompt: job.prompt, alt: job.alt, shape: job.shape });
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { ok: false, problem: `The picture could not be made: ${error.message}` };
  }
  if (!made.ok) return { ok: false, problem: made.problem };
  const picture = { url: made.picture.url, width: made.picture.width, height: made.picture.height };

  const placed = await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      select draft from commerce.pages where id = ${pageId}::uuid and store_id is not distinct from ${owner.storeId}::uuid for update
    `);
    const content = row ? pageInput.safeParse(row.draft) : null;
    if (!content?.success) return false;
    const next = placePicture(content.data, job, picture);
    if (!next || !pageInput.safeParse(next).success) return false;
    await tx.execute(sql`
      update commerce.pages set draft = ${JSON.stringify(next)}::jsonb, updated_at = now(), updated_by = ${owner.account.id}::uuid
      where id = ${pageId}::uuid
    `);
    return true;
  });
  // The picture stays in the library either way, for the owner to use.
  if (!placed) return { ok: false, problem: "The picture was made and kept in the media library, but its place on the page has changed." };
  return { ok: true, url: picture.url };
}

/** At most this many pictures are asked for a page (the plan keeps to it). */
export const PICTURE_JOBS_MAX = PICTURES_MAX;

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

/** What the owner said, written down by the site's speech-to-text model. */
export async function hearOwner(storeId: string | null, audio: Blob): Promise<StudioResult<{ text: string }>> {
  const connection = await aiFor(storeId, { feature: "ai_manager" });
  if (!connection?.transcriptionModel) return { ok: false, problem: "Set up a speech-to-text model under AI settings to talk to the AI." };
  const type = audio.type || "audio/webm";
  const extension = type.includes("mp4") ? "mp4" : type.includes("ogg") ? "ogg" : type.includes("wav") ? "wav" : "webm";
  try {
    const text = (await transcribeAudio(connection, audio, `message.${extension}`, null)).slice(0, 4000);
    return text ? { ok: true, text } : { ok: false, problem: "Nothing was heard. Try again, a little closer to the microphone." };
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { ok: false, problem: problemOf(error) };
  }
}

/** The AI's words read out by the site's text-to-speech model, as MP3 in base64. */
export async function speakToOwner(storeId: string | null, text: string): Promise<StudioResult<{ audio: string }>> {
  const connection = await aiFor(storeId, { feature: "ai_manager" });
  if (!connection?.speechModel || !connection.speechVoice) return { ok: false, problem: "No voice is set up." };
  try {
    return { ok: true, audio: Buffer.from(await speakText(connection, text.slice(0, 1500))).toString("base64") };
  } catch (error) {
    if (!(error instanceof AiError)) throw error;
    return { ok: false, problem: problemOf(error) };
  }
}

/** The brief and plan as the studio sends them, read. */
export const studioBrief = pageBrief;
export const studioPlan = pagePlan;
