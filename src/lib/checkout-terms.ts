/**
 * Terms at checkout (wave 1, 1e, `docs/wave-1-trust.md` 2.4, 2.4.1), the pure parts: the three modes, which pages the
 * sentence names, when paying is held until a tick, what is recorded and what staff are told of it, and the hash a
 * snapshot of a page is kept under. The sentence's words are `m.terms` in `src/lib/i18n.ts`; the server action that
 * records the acceptance is `src/server/checkout-terms.ts`.
 *
 * What a record proves, said plainly: that a shopper pressed pay while these two texts were shown (`link`) or ticked
 * (`checkbox`). The press is the act and the server action is the record; a client that skips the action can still pay,
 * so the tick is a guard and a record, not an enforcement, and nothing here claims more.
 */
import type { Messages } from "./i18n";
import { CHECKOUT_TERMS_ROLES, type LegalRole } from "./legal-roles";

export const TERMS_MODES = ["link", "checkbox", "off"] as const;
export type TermsMode = (typeof TERMS_MODES)[number];
export const DEFAULT_TERMS_MODE: TermsMode = "link";

export const isTermsMode = (value: unknown): value is TermsMode => (TERMS_MODES as readonly unknown[]).includes(value);

/** What each mode does, in the owner's words (the settings screen). */
export const TERMS_MODE_WORDS: Record<TermsMode, { name: string; hint: string }> = {
  link: { name: "Link", hint: "A sentence by the pay button names your terms and privacy statement, with links. What the shopper was shown is kept with the order." },
  checkbox: { name: "Tick box", hint: "The same sentence with a box the shopper must tick before paying. What was shown is kept with the order." },
  off: { name: "Off", hint: "Nothing is shown or kept at checkout. Use it only if you show your terms in another way." },
};

/** The roles the sentence names, in its order. */
export const TERMS_ROLES = CHECKOUT_TERMS_ROLES;
export type TermsRole = (typeof TERMS_ROLES)[number];

/** A page the sentence links to: the store's published page for the role, as the shopper's market shows it. */
export type TermsPage = { role: TermsRole; title: string; href: string };

/** Which pages the sentence names, in its order, from what the store has chosen; a page without a title or address is not one. */
export function termsPagesOf(chosen: Partial<Record<TermsRole, { title: string; href: string } | null | undefined>>): TermsPage[] {
  return TERMS_ROLES.flatMap((role) => {
    const page = chosen[role];
    return page && page.title.trim() !== "" && page.href !== "" ? [{ role, title: page.title.trim(), href: page.href }] : [];
  });
}

/** The form of the sentence: both pages, only the terms, only the privacy statement; null when there is nothing to say. */
export type SentenceKind = "both" | "terms" | "privacy";
export function sentenceKind(pages: readonly TermsPage[]): SentenceKind | null {
  const roles = new Set(pages.map((p) => p.role));
  if (roles.has("terms") && roles.has("privacy")) return "both";
  if (roles.has("terms")) return "terms";
  if (roles.has("privacy")) return "privacy";
  return null;
}

/**
 * What checkout draws for a mode and the pages the store has chosen: the sentence (with a tick in `checkbox` mode), or
 * nothing. Nothing is drawn, and nothing is recorded, when the owner switched it off or has chosen no page.
 */
export type TermsDisplay = { mode: "link" | "checkbox"; pages: TermsPage[]; kind: SentenceKind };
export function termsDisplay(mode: TermsMode, pages: readonly TermsPage[]): TermsDisplay | null {
  if (mode === "off") return null;
  const kind = sentenceKind(pages);
  return kind ? { mode, pages: [...pages], kind } : null;
}

/** Whether the pay button is held: in `checkbox` mode, until the box is ticked. */
export const payHeld = (display: TermsDisplay | null, ticked: boolean): boolean => display?.mode === "checkbox" && !ticked;

/** What the browser does when the shopper presses pay: record first (and in `checkbox` mode stop if it fails), or nothing to record. */
export type PayStep = { record: false } | { record: true; stopOnFailure: boolean };
export function payStep(display: TermsDisplay | null): PayStep {
  return display ? { record: true, stopOnFailure: display.mode === "checkbox" } : { record: false };
}

/** What stands for a link in the sentence's template: the message is called with these and the sentence is cut on them. */
export const TERMS_MARKERS: Record<TermsRole, string> = { terms: "{terms}", privacy: "{privacy}" };

/** The sentence for a mode and the pages it names, in the shopper's language, with the links as markers (`TERMS_MARKERS`). */
export function termsTemplate(words: Messages["terms"], display: Pick<TermsDisplay, "mode" | "kind">): string {
  const { terms, privacy } = TERMS_MARKERS;
  const box = display.mode === "checkbox";
  switch (display.kind) {
    case "both":
      return (box ? words.checkboxBoth : words.both)(terms, privacy);
    case "terms":
      return (box ? words.checkboxTerms : words.termsOnly)(terms);
    case "privacy":
      return (box ? words.checkboxPrivacy : words.privacyOnly)(privacy);
  }
}

/** A piece of the sentence: words, or the place of the link to a page. */
export type SentencePart = { text: string } | { role: TermsRole };

/** Cuts a template on its markers, in the order they stand; a marker the language left out is simply not drawn. */
export function sentenceParts(template: string): SentencePart[] {
  const parts: SentencePart[] = [];
  const marker = new RegExp(`(${Object.values(TERMS_MARKERS).map((m) => m.replace(/[{}]/g, "\\$&")).join("|")})`);
  for (const piece of template.split(marker)) {
    if (piece === "") continue;
    const role = (Object.keys(TERMS_MARKERS) as TermsRole[]).find((r) => TERMS_MARKERS[r] === piece);
    parts.push(role ? { role } : { text: piece });
  }
  return parts;
}

/** The refusal of saving a mode the store cannot have: a tick box needs a published terms page to tick for. */
export function termsSettingProblem(mode: TermsMode, chosen: Partial<Record<LegalRole, unknown>>): string | null {
  if (mode === "checkbox" && !chosen.terms) return "Choose a published terms page before asking shoppers to tick a box for it.";
  return null;
}

/** What the settings screen says when the mode cannot be honoured now (a page was unpublished after the mode was set). */
export function termsSettingNotice(mode: TermsMode, pages: readonly TermsPage[]): string | null {
  if (mode === "off") return null;
  if (pages.length === 0) return "No terms page is chosen, so checkout shows no sentence and keeps no record.";
  if (mode === "checkbox" && !pages.some((p) => p.role === "terms")) return "The tick box is for your terms page, and none is chosen: checkout shows no tick box.";
  return null;
}

// ---------------------------------------------------------------------------
// What is recorded
// ---------------------------------------------------------------------------

/** One snapshot an order was placed under. */
export type RecordedSnapshot = { role: TermsRole; snapshotId: string; hash: string; title: string };
/** The record on an order (`commerce.order_terms`). */
export type OrderTermsRecord = { orderId: string; mode: "link" | "checkbox"; acceptedAt: Date; locale: string; snapshots: RecordedSnapshot[] };

/** What staff are told on the order page: the date and what was shown, or that the link was shown and nothing kept, or nothing. */
export type StaffTermsLine =
  | { kind: "accepted"; mode: "link" | "checkbox"; at: Date; titles: string[]; text: string }
  | { kind: "not_recorded"; text: string }
  | { kind: "none" };

export function staffTermsLine(
  record: OrderTermsRecord | null,
  context: { mode: TermsMode; copied?: boolean; storeHasRecords: boolean; format: (date: Date) => string },
): StaffTermsLine {
  if (record) {
    const verb = record.mode === "checkbox" ? "ticked" : "shown";
    return {
      kind: "accepted",
      mode: record.mode,
      at: record.acceptedAt,
      titles: record.snapshots.map((s) => s.title),
      text: `Terms accepted ${context.format(record.acceptedAt)} as ${verb}`,
    };
  }
  // A copied order is history and never had a checkout; a store with no record at all has not had the feature on yet.
  if (context.copied || context.mode === "off" || !context.storeHasRecords) return { kind: "none" };
  return { kind: "not_recorded", text: "Terms link shown, not recorded" };
}

// ---------------------------------------------------------------------------
// The snapshot's hash
// ---------------------------------------------------------------------------

/** JSON with every object's keys in order and no whitespace, so the same page always gives the same text. `undefined` is left out. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return "null";
}

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 of a string's UTF-8 bytes as lower-case hex: synchronous and free of Node's modules, so a browser and a server agree; tested against `node:crypto`. */
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const length = data.length;
  const padded = new Uint8Array((((length + 9 + 63) >> 6) << 6));
  padded.set(data);
  padded[length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((length * 8) / 0x100000000));
  view.setUint32(padded.length - 4, (length * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** The hash a snapshot is kept under: SHA-256 of the canonical JSON of the localised page's title and rows, nothing else (not its address, date or the shopper's market). */
export const snapshotHash = (page: { title: string; rows: unknown }): string => sha256Hex(canonicalJson({ title: page.title, rows: page.rows }));
