/**
 * The Dream Factory (D409, `docs/dream-factory.md`): one owner's description to a store ready to open. Pure: the steps, what each needs before
 * it starts, who does it, the brief the run works from, the words each AI step is given, the run's state and its scorecard. The conductor is
 * `src/server/dream-factory.ts`; every step ends on a check made by code against the store's data, never on the model's word.
 */

import { z } from "zod";

import { DRILL_EMAIL_DOMAIN } from "./live-drills";
import { RULES_STAND } from "./prompt-safety";

export const DREAM_STEP_IDS = [
  "brief",
  "confirm",
  "research",
  "setup",
  "brand",
  "catalogue",
  "website",
  "legal",
  "payments",
  "plan",
  "rehearsal",
  "open",
  "goals",
] as const;
export type DreamStepId = (typeof DREAM_STEP_IDS)[number];

export type DreamWho = "ai" | "owner" | "code";
export type DreamLane = "start" | "A" | "B" | "C" | "finish";

export type DreamStep = { id: DreamStepId; title: string; lane: DreamLane; who: DreamWho; needs: readonly DreamStepId[] };

/** In the order the owner reads them; a step starts when every step it needs has passed. Steps in the same lane run side by side with the others. */
export const DREAM_STEPS: readonly DreamStep[] = [
  { id: "brief", title: "Brief", lane: "start", who: "ai", needs: [] },
  { id: "confirm", title: "Confirm the brief", lane: "start", who: "owner", needs: ["brief"] },
  { id: "research", title: "Research", lane: "A", who: "ai", needs: ["confirm"] },
  { id: "setup", title: "Setup", lane: "A", who: "ai", needs: ["confirm"] },
  { id: "brand", title: "Brand and look", lane: "A", who: "ai", needs: ["confirm"] },
  { id: "catalogue", title: "Products", lane: "B", who: "ai", needs: ["research", "setup"] },
  { id: "website", title: "Website", lane: "B", who: "code", needs: ["brand"] },
  { id: "legal", title: "Legal pages", lane: "B", who: "code", needs: ["setup"] },
  { id: "payments", title: "Payments", lane: "C", who: "owner", needs: ["setup"] },
  { id: "plan", title: "Plan", lane: "C", who: "owner", needs: ["confirm"] },
  { id: "rehearsal", title: "Rehearsal", lane: "finish", who: "code", needs: ["catalogue", "website", "legal"] },
  { id: "open", title: "Open the store", lane: "finish", who: "owner", needs: ["rehearsal", "payments", "plan"] },
  { id: "goals", title: "First goals", lane: "finish", who: "ai", needs: ["open"] },
];

export const stepOf = (id: DreamStepId): DreamStep => DREAM_STEPS.find((s) => s.id === id) as DreamStep;

/** How often a step is tried before it becomes a question for the owner (as the autopilot's steps, D309). */
export const DREAM_TRIES = 3;

export const STEP_STATUSES = ["waiting", "running", "asking", "done", "skipped", "failed"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** One step's state as the run keeps it: `detail` is what its check found, in plain words, for the owner and the scorecard. */
export type StepState = {
  status: StepStatus;
  tries: number;
  startedAt?: string;
  finishedAt?: string;
  detail?: string;
  /** What the step is working on, where it carries over minutes: the website's front page while the AI fixes it. */
  ref?: string;
};
export type DreamSteps = Record<DreamStepId, StepState>;

const stepStateSchema = z.object({
  status: z.enum(STEP_STATUSES),
  tries: z.number().int().min(0),
  startedAt: z.string().optional(),
  finishedAt: z.string().optional(),
  detail: z.string().optional(),
  ref: z.string().optional(),
});

/** Every step waiting: the state a run starts in. */
export function initialSteps(): DreamSteps {
  return Object.fromEntries(DREAM_STEP_IDS.map((id) => [id, { status: "waiting", tries: 0 }])) as DreamSteps;
}

/** The steps as kept, read defensively: a step missing or unreadable is waiting. */
export function readSteps(raw: unknown): DreamSteps {
  const steps = initialSteps();
  if (raw && typeof raw === "object") {
    for (const id of DREAM_STEP_IDS) {
      const parsed = stepStateSchema.safeParse((raw as Record<string, unknown>)[id]);
      if (parsed.success) steps[id] = parsed.data;
    }
  }
  return steps;
}

export const passed = (state: StepState): boolean => state.status === "done" || state.status === "skipped";

/** The steps that may start now: waiting, with every step they need passed. */
export function startable(steps: DreamSteps): DreamStepId[] {
  return DREAM_STEPS.filter((step) => steps[step.id].status === "waiting" && step.needs.every((need) => passed(steps[need]))).map((s) => s.id);
}

export type RunStatus = "running" | "asking" | "ready" | "open" | "failed";

/**
 * The run's status from its steps: failed when a step failed, open when the goals are set after opening, ready when only the owner's opening
 * is left (or done, in a test run, which never opens), asking when nothing can move without the owner, else running.
 */
export function runStatusOf(steps: DreamSteps): RunStatus {
  if (DREAM_STEP_IDS.some((id) => steps[id].status === "failed")) return "failed";
  if (passed(steps.goals)) return steps.open.status === "done" ? "open" : "ready";
  if (DREAM_STEP_IDS.some((id) => steps[id].status === "running") || startable(steps).some((id) => stepOf(id).who !== "owner")) return "running";
  return passed(steps.rehearsal) ? "ready" : "asking";
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------------------------------------------------------------

export const PROMPT_MIN = 20;
export const PROMPT_MAX = 2000;

export const BUSINESS_FIELDS = ["legalName", "organisationNumber", "postalAddress", "contactEmail", "country"] as const;
export type BusinessField = (typeof BUSINESS_FIELDS)[number];

const text = (max: number) => z.string().trim().max(max).catch("");

/** What the run works from: the model's reading of the owner's words, then checked here. */
export const briefSchema = z.object({
  storeName: text(80),
  sells: text(600),
  audience: text(300),
  countries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).max(5).catch([]),
  languages: z.array(z.string().trim().min(2).max(40)).max(4).catch([]),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).or(z.literal("")).catch(""),
  priceRange: text(120),
  tone: text(200),
  products: z.coerce.number().int().min(3).max(12).catch(6),
  pages: z
    .array(z.object({ title: z.string().trim().min(1).max(80), purpose: z.string().trim().min(1).max(400) }))
    .max(3)
    .catch([]),
  business: z
    .object({
      legalName: text(200),
      organisationNumber: text(40),
      postalAddress: text(300),
      contactEmail: text(200),
      country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).or(z.literal("")).catch(""),
    })
    .catch({ legalName: "", organisationNumber: "", postalAddress: "", contactEmail: "", country: "" }),
});
export type DreamBrief = z.output<typeof briefSchema>;

const squash = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}@.]+/gu, "");

/**
 * The business details the owner's own words hold: a detail the model gave that the description does not contain is dropped, so a run never
 * sets a company name, number, address or email the owner did not write (D311's rule for facts, here for the business itself). The country
 * is a code the model may infer from the address, so it stays when the address does.
 */
export function ownBusiness(brief: DreamBrief, prompt: string): DreamBrief["business"] {
  const words = squash(prompt);
  const said = (value: string) => value !== "" && words.includes(squash(value));
  const b = brief.business;
  return {
    legalName: said(b.legalName) ? b.legalName : "",
    organisationNumber: said(b.organisationNumber) ? b.organisationNumber : "",
    postalAddress: said(b.postalAddress) ? b.postalAddress : "",
    contactEmail: said(b.contactEmail) ? b.contactEmail : "",
    country: said(b.postalAddress) ? b.country : "",
  };
}

/** What the brief still needs from the owner, as questions; empty when the run can go on. */
export function briefQuestions(brief: DreamBrief): string[] {
  const questions: string[] = [];
  if (!brief.storeName) questions.push("What is the store called?");
  if (brief.sells.length < 10) questions.push("What will the store sell?");
  if (brief.countries.length === 0) questions.push("Which countries will you sell to?");
  if (!brief.business.legalName) questions.push("What is your business's legal name?");
  if (!brief.business.postalAddress) questions.push("What is your business's postal address?");
  if (!brief.business.contactEmail) questions.push("Which email address may customers write to?");
  if (!brief.business.country) questions.push("Which country is your business registered in?");
  return questions;
}

/** The owner's answers laid over the brief: only the business details and the countries, the facts the model must never fill in itself. */
export const briefAnswers = z.object({
  legalName: z.string().trim().max(200).optional(),
  organisationNumber: z.string().trim().max(40).optional(),
  postalAddress: z.string().trim().max(300).optional(),
  contactEmail: z.string().trim().max(200).optional(),
  country: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
  countries: z.array(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/)).max(5).optional(),
});

export function answeredBrief(brief: DreamBrief, raw: unknown): DreamBrief {
  const a = briefAnswers.parse(raw);
  const keep = (given: string | undefined, had: string) => (given !== undefined && given !== "" ? given : had);
  return {
    ...brief,
    countries: a.countries && a.countries.length > 0 ? a.countries : brief.countries,
    business: {
      legalName: keep(a.legalName, brief.business.legalName),
      organisationNumber: keep(a.organisationNumber, brief.business.organisationNumber),
      postalAddress: keep(a.postalAddress, brief.business.postalAddress),
      contactEmail: keep(a.contactEmail, brief.business.contactEmail),
      country: keep(a.country, brief.business.country),
    },
  };
}

/** The brief's system prompt: the owner's words steer what is built, never the rules; facts not written stay empty. */
export function briefPrompt(storeName: string): string {
  return [
    "You read a shop owner's description of the online store they want and turn it into a brief, as one JSON object and nothing else.",
    RULES_STAND,
    `The store is called "${storeName}" unless the description names it otherwise.`,
    "Fields: storeName; sells (what is sold, 1 to 3 sentences); audience; countries (ISO 3166 two-letter codes the owner will sell to; only countries in Europe);",
    "languages (names of the languages the store is written in, the country's own first); currency (ISO 4217, the main country's); priceRange (as the owner put it, else empty);",
    "tone (how the store speaks); products (how many products to start with, 3 to 12, default 6); pages (up to 3 pages beside the front page, each with title and purpose, e.g. About us, Contact);",
    "business: legalName, organisationNumber, postalAddress, contactEmail, country (two-letter code).",
    "The business details are only what the description writes, copied exactly: never invent a name, number, address or email. Leave a field empty when it is not written.",
  ].join("\n");
}

/** The model's answer as a brief, or null when no JSON object could be read. */
export function readBrief(answer: string, prompt: string): DreamBrief | null {
  const json = /\{[\s\S]*\}/.exec(answer)?.[0];
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const brief = briefSchema.safeParse(parsed);
  if (!brief.success) return null;
  return { ...brief.data, business: ownBusiness(brief.data, prompt) };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The AI's steps
// ---------------------------------------------------------------------------------------------------------------------------------

export type AiStepId = "research" | "setup" | "brand" | "catalogue" | "goals";

/**
 * The website step's own AI turn: the draft's front page held back by a blocking problem of the builder (contrast, a picture without alt
 * text, an empty link) is fixed by the AI with the page tools, whose publishing refuses while a blocking problem is left (D308), so the check
 * stays the builder's.
 */
export const FRONT_FIX_TOOLS = ["get_page", "edit_page", "publish_page"] as const;

export function frontFixMessage(page: { id: string; title: string }, issues: string): string {
  return [
    `The store's front page "${page.title}" (page ${page.id}) is still a draft: the builder found ${issues || "a problem to fix before it is published"}.`,
    "Read it with get_page, fix exactly those problems with edit_page (keep its words and layout otherwise), then publish it with publish_page.",
  ].join(" ");
}

/** The tools each AI step may use (the AI manager's own, D308); nothing else is offered in its turn. */
export const STEP_TOOLS: Record<AiStepId, readonly string[]> = {
  research: ["search_web", "read_web_page", "save_research_note", "list_research_notes"],
  setup: [
    "setup_progress",
    "set_store_details",
    "set_countries",
    "set_languages",
    "set_currencies",
    "set_flat_shipping",
    "shipping_overview",
    "tax_readiness",
    "get_tax_profile",
  ],
  brand: ["get_brand", "set_brand", "design_look", "make_brand_marks", "list_themes", "add_theme", "try_theme"],
  catalogue: [
    "list_products",
    "get_product",
    "create_product",
    "update_product",
    "write_product_texts",
    "set_prices",
    "set_product_status",
    "archive_product",
    "list_categories",
    "list_research_notes",
    "get_brand",
  ],
  goals: ["list_goals", "set_goal"],
};

const country = (codes: readonly string[]) => codes.join(", ");

/** What an AI step's turn is asked to do, from the brief: the whole job, so the turn needs nothing else. */
export function stepMessage(id: AiStepId, brief: DreamBrief): string {
  const store = `"${brief.storeName}", which sells ${brief.sells}${brief.audience ? ` to ${brief.audience}` : ""}`;
  switch (id) {
    case "research":
      return [
        `Research the market for ${store}, selling in ${country(brief.countries)}.`,
        "Find comparable shops, their price levels and what customers there expect, and the rules that apply to selling these products in those countries.",
        "Save at least 3 research notes, each with the address of the source you read. Do not change the store.",
      ].join(" ");
    case "setup": {
      const b = brief.business;
      return [
        `Set up ${store} so it can open.`,
        `Business details, exactly as the owner gave them: legal name "${b.legalName}"${b.organisationNumber ? `, organisation number "${b.organisationNumber}"` : ""}, postal address "${b.postalAddress}", contact email "${b.contactEmail}", country ${b.country}.`,
        `Countries to sell to, exactly these and no other (set_countries): ${country(brief.countries)}. Languages: ${brief.languages.join(", ") || "the countries' own"}. Currency: ${brief.currency || "the main country's"}.`,
        "Then a flat shipping price for each country, sensible for these products, and check the tax readiness. End with setup_progress.",
      ].join(" ");
    }
    case "brand":
      return [
        `Set down the brand of ${store}: a short tagline, the voice${brief.tone ? ` (${brief.tone})` : ""}, the audience and its values, with set_brand.`,
        "Make a look for it (design_look) and its logo marks (make_brand_marks).",
        "Then choose one free theme that suits it from list_themes and add it to the store's library; do not make it live.",
      ].join(" ");
    case "catalogue":
      return [
        `Create ${brief.products} products for ${store}, based on the research notes.`,
        `Each with a title, a description in the store's voice, a price in every country the store sells to${brief.priceRange ? ` (price range: ${brief.priceRange})` : ""} and a picture the store's picture model makes (the picture's \`make\` description).`,
        "Make each product active once it has its texts, prices and picture. Archive the store's demo products, if it has any.",
        "Never claim a certification, origin or award the owner did not state.",
      ].join(" ");
    case "goals":
      return `Set two goals for ${store}: its first sale within 30 days, and its first 100 visitors within 30 days. Use set_goal for each; make no plan.`;
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Test runs and the scorecard
// ---------------------------------------------------------------------------------------------------------------------------------

/** A run whose owner is at the drills' test address: it stays private, its owner steps are pressed by the drill, and it never opens. */
export const isTestOwner = (email: string): boolean => email.trim().toLowerCase().endsWith(DRILL_EMAIL_DOMAIN);

/** The developers' fixed prompt (D409): the same words every drill, so runs compare. The business is a test one, said to be. */
export const DRILL_PROMPT = [
  "A small Norwegian online shop selling hand-thrown ceramic mugs, bowls and plates in calm Nordic colours, for people who like slow mornings.",
  "We sell to Norway and Sweden, prices around 250 to 600 kr.",
  "This is a test company for Kaizena Flow's Dream Factory drill: legal name Dream Factory Test AS, organisation number 999999999,",
  "postal address Testveien 1, 0150 Oslo, contact email dreamfactory@resend.dev.",
].join(" ");

export type DreamScore = {
  /** Minutes from the start to ready to open, the owner's waiting left out; null until ready. */
  minutesToReady: number | null;
  ownerPresses: number;
  /** Of the steps done by the AI or code, how many passed on their first try, in per cent; null before any. */
  firstTryPercent: number | null;
  done: number;
  failed: number;
};

/** The scorecard of a run (docs/dream-factory.md, What a run is measured on). */
export function scoreOf(run: { createdAt: Date; readyAt: Date | null; ownerPresses: number; steps: DreamSteps; ownerWaitMs?: number }): DreamScore {
  const worked = DREAM_STEPS.filter((s) => s.who !== "owner" && run.steps[s.id].status === "done");
  const first = worked.filter((s) => run.steps[s.id].tries <= 1).length;
  const ms = run.readyAt ? run.readyAt.getTime() - run.createdAt.getTime() - (run.ownerWaitMs ?? 0) : null;
  return {
    minutesToReady: ms === null ? null : Math.max(0, Math.round(ms / 60_000)),
    ownerPresses: run.ownerPresses,
    firstTryPercent: worked.length === 0 ? null : Math.round((first / worked.length) * 100),
    done: DREAM_STEP_IDS.filter((id) => passed(run.steps[id])).length,
    failed: DREAM_STEP_IDS.filter((id) => run.steps[id].status === "failed").length,
  };
}

/** The time owner steps waited on the owner, from their start to their end, to leave out of the run's own time. */
export function ownerWaitMs(steps: DreamSteps, now: Date): number {
  return DREAM_STEPS.filter((s) => s.who === "owner").reduce((sum, s) => {
    const state = steps[s.id];
    if (!state.startedAt) return sum;
    const end = state.finishedAt ? new Date(state.finishedAt) : now;
    return sum + Math.max(0, end.getTime() - new Date(state.startedAt).getTime());
  }, 0);
}
