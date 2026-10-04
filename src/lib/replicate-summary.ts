import type { ReplicaNote, ReplicaPass, ReplicaSummary } from "./replicate";
import { gridLines, type GridReport } from "./replicate-grid";

/**
 * What the replicator says when it is done (D150): what went well and what did not, in plain sentences, from the numbers
 * and notes the job kept. Written in code from facts, never by a model, so it cannot flatter the result.
 */

export type SummaryFacts = {
  outcome: ReplicaSummary["outcome"];
  /** Why a failed job failed. */
  problem: string | null;
  notes: ReplicaNote[];
  words: number;
  counts: ReplicaSummary["counts"];
  assets: { picturesOk: number; picturesFailed: number; videosOk: number; videosFailed: number; fontsInstalled: string[]; fontsStandIn: { from: string; to: string }[]; fontsFailed: string[]; shots: number };
  passes: ReplicaPass[];
  iterationsAsked: number;
  stoppedEarly: boolean;
  /** Whether a model looked at the pictures, and why not if it could not. */
  vision: { used: boolean; why: string | null };
  page: { id: string; title: string } | null;
  analysis: { summary: string; hard: string[] } | null;
  /** What the converter did with repeated cards (D155): grids built, groups kept as columns and why, grids reverted. */
  grids?: GridReport;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const were = (n: number) => (n === 1 ? "was" : "were");

/** How close a match is, in a word. */
export function matchWord(match: number): string {
  if (match >= 98) return "almost identical";
  if (match >= 93) return "very close";
  if (match >= 85) return "close";
  if (match >= 70) return "recognisably the same page, with differences";
  return "far from the original";
}

export function buildSummary(f: SummaryFacts): ReplicaSummary {
  const well: string[] = [];
  const problems: string[] = [];
  const first = f.passes[0] ?? null;
  const last = f.passes[f.passes.length - 1] ?? null;

  if (f.outcome === "failed") problems.push(f.problem ?? "The copy could not be made.");
  if (f.outcome === "aborted") problems.push("The copy was stopped before it was finished, so it is as far as it got.");

  if (f.analysis) well.push(`The design was examined: ${f.analysis.summary}`);
  if (f.words > 0) well.push(`${plural(f.words, "word")} of text ${were(f.words)} copied exactly as written.`);
  if (f.assets.picturesOk > 0) well.push(`${plural(f.assets.picturesOk, "picture")} ${were(f.assets.picturesOk)} downloaded and kept in the media library${f.assets.shots > 0 ? ` (${plural(f.assets.shots, "icon or graphic")} photographed from the page)` : ""}.`);
  if (f.assets.videosOk > 0) well.push(`${plural(f.assets.videosOk, "video")} ${were(f.assets.videosOk)} copied.`);
  if (f.assets.fontsInstalled.length > 0) well.push(`${plural(f.assets.fontsInstalled.length, "font")} found in Google Fonts and installed: ${f.assets.fontsInstalled.join(", ")}.`);
  if (f.counts.rows > 0) well.push(`The page was built from ${plural(f.counts.rows, "row")} and ${plural(f.counts.blocks, "block")} (${plural(f.counts.headings, "heading")}, ${plural(f.counts.texts, "text block")}, ${plural(f.counts.pictures, "picture")}, ${plural(f.counts.buttons, "button")}, ${plural(f.counts.videos, "video")}), with every size, space and colour measured from the original.`);

  if (f.grids) {
    const lines = gridLines(f.grids);
    well.push(...lines.well);
    problems.push(...lines.problems);
  }

  if (last) {
    const phone = last.mobile ? ` and ${last.mobile.match}% on phones` : "";
    well.push(`The last copy matches the original ${last.desktop.match}% on computers${phone}, which is ${matchWord(last.desktop.match)}.`);
    if (first && f.passes.length > 1) {
      const gain = Math.round((last.desktop.match - first.desktop.match) * 10) / 10;
      if (gain > 0.4) well.push(`${plural(f.passes.length - 1, "improving pass", "improving passes")} raised the match on computers from ${first.desktop.match}% to ${last.desktop.match}%.`);
      else problems.push(`${plural(f.passes.length - 1, "improving pass", "improving passes")} did not raise the match on computers (${first.desktop.match}% to ${last.desktop.match}%).`);
    }
    if (last.desktop.match < 85) problems.push(`The copy still differs from the original in many places (${last.desktop.match}% match on computers). Open it in the builder to finish it by hand.`);
    if (last.desktop.heights.original !== last.desktop.heights.copy) problems.push(`The copy is ${last.desktop.heights.copy}px tall on computers and the original ${last.desktop.heights.original}px.`);
    for (const w of last.desktop.weakest.slice(0, 2)) problems.push(`The weakest stretch on computers is ${w.y}–${w.y + w.height}px down the page (${w.match}% match).`);
  }
  if (f.stoppedEarly) well.push("The copy was as close as pixels allow, so the remaining passes were not needed.");

  if (!f.vision.used) problems.push(f.vision.why ?? "The site's AI did not look at the pictures, so the copy was corrected by measuring only. Choose a model that sees pictures under AI settings to let it judge colours and shapes too.");
  if (f.assets.picturesFailed > 0 && !f.notes.some((n) => /could not be downloaded/.test(n.text))) problems.push(`${plural(f.assets.picturesFailed, "picture")} could not be downloaded.`);
  if (f.assets.videosFailed > 0) problems.push(`${plural(f.assets.videosFailed, "video")} could not be copied.`);
  for (const stand of f.assets.fontsStandIn) problems.push(`${stand.from} is not in Google Fonts; its nearest look-alike, ${stand.to}, is used instead, so letters differ slightly.`);
  if (f.assets.fontsFailed.length > 0) problems.push(`Not in Google Fonts, so the original's own font stack is used (the browser's font where it has none): ${f.assets.fontsFailed.join(", ")}.`);
  for (const hard of f.analysis?.hard ?? []) problems.push(`The AI flagged this as hard to copy: ${hard}`);
  for (const note of f.notes) if (note.level !== "ok") problems.push(note.text);
  for (const note of f.notes) if (note.level === "ok") well.push(note.text);

  const dedupe = (list: string[]) => [...new Set(list)];
  return {
    outcome: f.outcome,
    wentWell: dedupe(well),
    problems: dedupe(problems),
    finalMatch: { desktop: last?.desktop.match ?? null, mobile: last?.mobile?.match ?? null },
    passes: f.passes.map((p) => ({ iteration: p.iteration, desktop: p.desktop.match, mobile: p.mobile?.match ?? null })),
    counts: f.counts,
    design: f.analysis?.summary ?? null,
    page: f.page,
  };
}
