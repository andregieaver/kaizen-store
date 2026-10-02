import { describe, expect, it } from "vitest";

import type { PartInfo } from "./replicate-build";
import type { CaptureNode, PageCapture } from "./replicate-capture";
import type { Raster } from "./replicate-diff";
import { BUILDER_BLOCKS, CONVERTER_BLOCKS, buildReport, censusOf, finalDiffOf, reportMarkdown, type ReportFacts } from "./replicate-report";

const node = (p: string, tag: string, box: [number, number, number, number], more: Partial<CaptureNode> = {}): CaptureNode => ({ p, tag, box, s: { display: "block" }, children: [], ...more });

function capture(width: number, height: number, children: CaptureNode[]): PageCapture {
  return {
    viewport: { w: width, h: 900 },
    url: "https://example.com/",
    title: "Example",
    lang: "en",
    description: "",
    docWidth: width,
    docHeight: height,
    background: "rgb(255, 255, 255)",
    root: node("", "body", [0, 0, width, height], { children }),
    fonts: [{ family: "Acme Sans", weight: "400", style: "normal", chars: 400 }],
    left: { fixed: ["div.cookie"], hidden: 0, capped: false },
    extras: { pseudo: [{ sel: "li.check", y: 700, note: "::before ✓" }], animated: [], sticky: [], scrollers: [{ sel: "div.slides", y: 900 }], roles: [], total: { pseudo: 1, animated: 0, sticky: 0, scrollers: 1, roles: 0 } },
  };
}

const flat = (width: number, height: number, colour: number): Raster => ({ width, height, data: new Uint8Array(width * height * 4).fill(colour) });

const desktop = capture(1440, 1400, [
  node("0", "section", [0, 0, 1440, 600], { sel: "section#hero.wide", children: [node("0/0", "input", [100, 300, 300, 40], { media: { kind: "control", type: "email", label: "Your email" }, sel: "input.email" })] }),
  node("1", "section", [0, 600, 1440, 800], { sel: "section.slider.testimonials", s: { display: "block", backgroundImage: "linear-gradient(red, blue)" } }),
  node("2", "details", [0, 1400, 1440, 20]),
  node("3", "iframe", [0, 1420, 600, 300], { media: { kind: "embed", url: "https://maps.example.org/embed?q=1", title: "Map" } }),
]);

const parts: PartInfo[] = [
  { id: "rp1", path: "0", kind: "row", row: "rp1", label: "row (stack)", target: [0, 0, 1440, 600], targetM: null },
  { id: "rp2", path: "0/0", kind: "block", row: "rp1", label: "heading h1: Hello", target: [100, 100, 600, 60], targetM: null },
  { id: "rp3", path: "1", kind: "row", row: "rp3", label: "row (stack)", target: [0, 600, 1440, 800], targetM: null },
];

const facts = (over: Partial<ReportFacts> = {}): ReportFacts => ({
  now: "2026-10-02T10:00:00.000Z",
  url: "https://example.com/",
  outcome: "done",
  problem: null,
  iterationsAsked: 3,
  stoppedEarly: false,
  vision: { used: false, why: "No AI text model." },
  desktop,
  mobile: null,
  parts,
  counts: { rows: 2, blocks: 1, headings: 1, texts: 0, pictures: 0, buttons: 0, videos: 0 },
  words: 12,
  notes: [],
  dropped: [{ kind: "form-field", sel: "input.email", y: 300, box: [100, 300, 300, 40], text: "email: Your email" }],
  passes: [{ iteration: 0, desktop: { match: 70, weakest: [{ y: 600, height: 300, match: 40 }], heights: { original: 1400, copy: 1500 } }, mobile: null, changes: [], ai: { summary: "Spacing is off.", couldNotFix: ["The slider shows one slide only."], refused: ["rp2: transform rotate(3deg) is not allowed."], applied: 2 } }],
  finalDiff: null,
  assets: { pictures: { "https://example.com/a.jpg": null }, videos: {}, shots: {}, fonts: { "Acme Sans": null }, failures: { "https://example.com/a.jpg": "It is not a picture the page can use." } },
  analysis: null,
  cssLength: 1000,
  cssTrimmed: null,
  log: [{ at: "2026-10-02T10:00:00.000Z", level: "warn", phase: "assets", text: "Could not download a.jpg" }],
  ...over,
});

describe("the replicator's report", () => {
  it("counts what the original holds", () => {
    const census = censusOf(desktop, null);
    expect(census.controls).toMatchObject({ total: 1, types: { email: 1 } });
    expect(census.gradients.total).toBe(1);
    expect(census.embeds).toEqual([{ host: "maps.example.org", title: "Map", y: 1420 }]);
    expect(census.hints.carousel?.total).toBe(1);
    expect(census.tags.details).toBe(1);
  });

  it("names each gap with evidence, the change and where to start, worst first", () => {
    const report = buildReport(facts());
    const ids = report.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(["forms", "carousel", "embeds", "tabs-accordions", "pictures", "fonts", "height", "pseudo", "ai-refused", "ai-could-not-fix", "no-vision"]));
    const rank = { high: 0, medium: 1, low: 2 };
    expect(report.findings.map((f) => rank[f.severity])).toEqual([...report.findings.map((f) => rank[f.severity])].sort());
    const forms = report.findings.find((f) => f.id === "forms")!;
    expect(forms.evidence.join(" ")).toContain("input.email at 300px");
    expect(forms.where.join(" ")).toContain("replicate-build.ts");
    expect(report.findings.find((f) => f.id === "ai-refused")!.evidence[0]).toContain("transform");
    // The builder has blocks the converter does not use.
    expect(BUILDER_BLOCKS).toEqual(expect.arrayContaining(["accordion", "tabs", "emailForm", "html"]));
    expect(BUILDER_BLOCKS).not.toContain("storePart");
    expect(CONVERTER_BLOCKS.every((b) => BUILDER_BLOCKS.includes(b))).toBe(true);
  });

  it("says how each row compares with its stretch of the original", () => {
    const original = flat(100, 100, 255);
    const copy = flat(100, 100, 255);
    // The second row's stretch (600–1400 px at a scale of 14) is wrong in the copy.
    for (let y = 43; y < 100; y++) for (let x = 0; x < 100; x++) copy.data[(y * 100 + x) * 4] = 0;
    const diff = finalDiffOf(parts, { original, copy, scale: 14, capture: desktop }, null);
    expect(diff.rows[0].desktop).toBe(100);
    expect(diff.rows[1].desktop).toBeLessThan(10);
    const report = buildReport(facts({ finalDiff: diff }));
    expect(report.rows.map((r) => r.match.desktop)).toEqual([100, diff.rows[1].desktop]);
    expect(report.findings.some((f) => f.id === "weak-rows")).toBe(true);
    expect(report.rows[0]).toMatchObject({ sel: "section#hero.wide", columns: 0 });
    expect(report.rows[0].blocks[0]).toMatchObject({ label: "heading h1: Hello", sel: "input.email" });
  });

  it("is one piece of Markdown a developer can use as a brief", () => {
    const text = reportMarkdown(buildReport(facts()));
    expect(text).toContain("# Page replicator report: example.com");
    expect(text).toContain("## Findings, worst first");
    expect(text).toMatch(/### 1\. \[high · /);
    expect(text).toContain("Start in: `src/lib/replicate-build.ts");
    expect(text).toContain("## Page outline");
    expect(text).toContain("input.email");
    expect(text).toContain("could not fix: The slider shows one slide only.");
    expect(text).toContain("It is not a picture the page can use.");
    expect(text.length).toBeLessThan(40_000);
  });

  it("is honest when nothing is lacking", () => {
    const plain = capture(1440, 600, [node("0", "section", [0, 0, 1440, 600])]);
    plain.extras = undefined;
    plain.fonts = [];
    plain.left.fixed = [];
    const report = buildReport(facts({ desktop: plain, dropped: [], parts: [], passes: [], assets: null, vision: { used: true, why: null }, log: [], cssLength: null }));
    expect(report.findings).toEqual([]);
    expect(reportMarkdown(report)).toContain("None: nothing was found");
  });
});
