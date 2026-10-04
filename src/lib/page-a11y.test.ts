import { describe, expect, it } from "vitest";

import type { PageBlock, PageColumn, PageContent, PageRow, RichTextDoc } from "./page-content";
import {
  ALT_ADVISED_MAX,
  LEGAL_NOTICE_CLASS,
  PAGE_ISSUE_RULES,
  RULE_SEVERITY,
  RULE_TITLE,
  blockingIssues,
  groupIssues,
  isGenericLinkText,
  issueCounts,
  issueId,
  pageIssues,
  refusedIssues,
  themeSetsOf,
  unacknowledged,
  type PageIssue,
  type PageIssueRule,
} from "./page-a11y";

let n = 0;
const id = (p: string) => `${p}${++n}`;
const doc = (...content: RichTextDoc["content"]): RichTextDoc => ({ type: "doc", content });
const para = (text: string, link?: string) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text, ...(link && { marks: [{ type: "link" as const, attrs: { href: link } }] }) }] });
const h = (level: 2 | 3 | 4, text: string) => ({ type: "heading" as const, attrs: { level }, content: text ? [{ type: "text" as const, text }] : [] });
const text = (d: RichTextDoc, over: Record<string, unknown> = {}): PageBlock => ({ id: id("t"), type: "richText", doc: d, ...over }) as PageBlock;
const heading = (level: 1 | 2 | 3 | 4 | 5 | 6, t: string, over: Record<string, unknown> = {}): PageBlock => ({ id: id("h"), type: "heading", level, text: t, ...over }) as PageBlock;
const image = (alt: string, over: Record<string, unknown> = {}): PageBlock => ({ id: id("i"), type: "image", image: { url: "https://x/a.webp", width: 100, height: 100, alt }, caption: "", ...over }) as PageBlock;
const button = (label: string, href: string, over: Record<string, unknown> = {}): PageBlock => ({ id: id("b"), type: "button", label, href, ...over }) as PageBlock;
const col = (blocks: PageBlock[], over: Partial<PageColumn> = {}): PageColumn => ({ id: id("c"), blocks, ...over });
const row = (columns: PageColumn[], over: Partial<PageRow> = {}): PageRow => ({ id: id("r"), type: "row", layout: "one", columns, ...over }) as PageRow;
const page = (...rows: PageRow[]): Pick<PageContent, "rows" | "title"> => ({ title: "A page", rows });
const one = (...blocks: PageBlock[]) => page(row([col(blocks)]));
const rules = (issues: PageIssue[]) => issues.map((i) => i.rule);

describe("the rules", () => {
  it("have a severity and a title each, and the blocking ones are those that ask before publishing", () => {
    for (const rule of PAGE_ISSUE_RULES) {
      expect(["blocking", "warning"]).toContain(RULE_SEVERITY[rule]);
      expect(RULE_TITLE[rule].length).toBeGreaterThan(5);
    }
    const blocking = PAGE_ISSUE_RULES.filter((r) => RULE_SEVERITY[r] === "blocking");
    expect(blocking.sort()).toEqual(["contrast", "empty_link", "heading_empty", "image_alt", "legal_notice", "pay_page_block", "placeholder"].sort());
    expect(PAGE_ISSUE_RULES.filter((r) => RULE_SEVERITY[r] === "warning").sort()).toEqual(["alt_long", "heading_order", "link_text_generic"]);
  });
});

describe("pictures", () => {
  it("need alt text (blocking), and a very long one is a warning", () => {
    const missing = image("");
    const blank = image("   ");
    const fine = image("A red lamp on a table");
    const long = image("x".repeat(ALT_ADVISED_MAX + 1));
    const edge = image("x".repeat(ALT_ADVISED_MAX));
    const issues = pageIssues(one(missing, blank, fine, long, edge));
    expect(issues.map((i) => [i.rule, i.blockId])).toEqual([
      ["image_alt", missing.id],
      ["image_alt", blank.id],
      ["alt_long", long.id],
    ]);
    expect(issues[0]).toMatchObject({ severity: "blocking", where: "Picture" });
    expect(issues[2].severity).toBe("warning");
  });

  it("are left alone while there is none yet, and when they take their picture from a field", () => {
    expect(pageIssues(one({ id: "i", type: "image", image: null, caption: "" } as PageBlock))).toEqual([]);
    expect(pageIssues(one(image("", { bind: { source: "store", field: "x" } })))).toEqual([]);
  });

  it("know where they are, for the link to the block", () => {
    const block = image("");
    const r = row([col([]), col([block])]);
    const [issue] = pageIssues(page(r));
    expect(issue).toMatchObject({ blockId: block.id, rowId: r.id, columnId: r.columns[1].id });
  });
});

describe("links and buttons", () => {
  it("need words and an address", () => {
    const noText = button("", "/shop");
    const noAddress = button("Shop", "");
    const empty = button("", "");
    const ok = button("See our shoes", "/shoes");
    const issues = pageIssues(one(noText, noAddress, empty, ok));
    expect(issues.map((i) => [i.rule, i.blockId])).toEqual([
      ["empty_link", noText.id],
      ["empty_link", noAddress.id],
      ["empty_link", empty.id],
    ]);
    expect(issues[0].message).toMatch(/no text/);
    expect(issues[1].message).toMatch(/no address/);
  });

  it("find a link in rich text with no words, and a link that says nothing", () => {
    const blank = text(doc(para("  ", "https://x.example")));
    const generic = text(doc(para("click here", "https://x.example")));
    const good = text(doc(para("Our returns policy", "/returns")));
    const issues = pageIssues(one(blank, generic, good));
    expect(issues.map((i) => [i.rule, i.blockId])).toEqual([["empty_link", blank.id], ["link_text_generic", generic.id]]);
    expect(issues[1].severity).toBe("warning");
  });

  it("warn about generic words in every language the stores write in", () => {
    for (const phrase of ["Click here", "read more", "Les mer", "klikk her", "Her", "Mer", "Läs mer", "här", "Klik her", "Læs mere", "  READ MORE… ", "Learn more »"]) {
      expect([phrase, isGenericLinkText(phrase)]).toEqual([phrase, true]);
    }
    for (const phrase of ["Read more about our shipping", "Frakt og levering", "Terms of sale", "Her finner du vilkårene", ""]) {
      expect([phrase, isGenericLinkText(phrase)]).toEqual([phrase, false]);
    }
    expect(rules(pageIssues(one(button("Read more", "/x"))))).toEqual(["link_text_generic"]);
  });

  it("check each of the two buttons, and leave a side that shows nothing", () => {
    const block = { id: "d", type: "dualButton", first: { label: "Shop", href: "/shop" }, second: { label: "More", href: "" } } as PageBlock;
    const unused = { id: "e", type: "dualButton", first: { label: "", href: "" }, second: { label: "Learn more", href: "/x" } } as PageBlock;
    const issues = pageIssues(one(block, unused));
    expect(issues.map((i) => [i.rule, i.blockId])).toEqual([["empty_link", "d"], ["link_text_generic", "e"]]);
  });

  it("find a social link with no address", () => {
    const block = { id: "s", type: "socialLinks", links: [{ id: "1", network: "instagram", href: "" }, { id: "2", network: "facebook", href: "https://facebook.com/x" }] } as PageBlock;
    expect(rules(pageIssues(one(block)))).toEqual(["empty_link"]);
  });

  it("look inside questions, tabs and accordions", () => {
    const faq = { id: "f", type: "faq", items: [{ id: "1", title: "Q", body: doc(para("here", "/x")) }] } as PageBlock;
    expect(rules(pageIssues(one(faq)))).toEqual(["link_text_generic"]);
  });
});

describe("headings", () => {
  it("find an empty heading, in a block and in rich text", () => {
    const empty = heading(2, " ");
    const rich = text(doc(h(2, "")));
    const issues = pageIssues(one(empty, rich));
    expect(issues.map((i) => [i.rule, i.blockId])).toEqual([["heading_empty", empty.id], ["heading_empty", rich.id]]);
    expect(issues[0].severity).toBe("blocking");
    expect(pageIssues(one(heading(2, "", { bind: { source: "store", field: "x" } })))).toEqual([]);
  });

  it("find a level that is skipped, across rows and rich text, and a second main heading", () => {
    const a = heading(1, "Title");
    const b = text(doc(h(2, "Section"), para("words"), h(4, "Skipped")));
    const c = heading(1, "Another title");
    const d = heading(3, "Deeper");
    const issues = pageIssues(page(row([col([a])]), row([col([b])]), row([col([c, d])])));
    const order = issues.filter((i) => i.rule === "heading_order");
    expect(order.map((i) => i.blockId)).toEqual([b.id, c.id, d.id]);
    expect(order[0].message).toMatch(/level 4 follows level 2/);
    expect(order[1].message).toMatch(/one main heading/);
    expect(order.every((i) => i.severity === "warning")).toBe(true);
    // c is level 1 after level 4: going up is fine, but it is a second main heading; d (3) after c (1) skips level 2.
    expect(order[2].message).toMatch(/level 3 follows level 1/);
  });

  it("let a page start at any level and go up or down by one", () => {
    expect(pageIssues(one(heading(3, "Start"), heading(4, "Next"), heading(2, "Up"), heading(3, "Down")))).toEqual([]);
    expect(pageIssues(one(heading(2, "A"), heading(2, "B"), heading(3, "C")))).toEqual([]);
  });
});

describe("contrast", () => {
  it("finds a heading colour too close to the row's or column's solid background", () => {
    const grey = heading(2, "Grey on white", { textColor: "#aaaaaa" });
    const ok = heading(2, "Black on white", { textColor: "#000000" });
    const issues = pageIssues(page(row([col([grey, ok])], { background: { type: "color", color: "#ffffff" } })));
    expect(issues.map((i) => [i.rule, i.blockId])).toEqual([["contrast", grey.id]]);
    expect(issues[0].message).toMatch(/2\.3:1.*4\.5:1/);
    // The column's own background wins over the row's.
    const inner = heading(2, "White on black column", { textColor: "#ffffff" });
    expect(pageIssues(page(row([col([inner], { background: { type: "color", color: "#000000" } })], { background: { type: "color", color: "#ffffff" } })))).toEqual([]);
  });

  it("does not check what it cannot know: pictures, gradients, videos, see-through colours", () => {
    const grey = () => heading(2, "Grey", { textColor: "#aaaaaa" });
    for (const background of [
      { type: "image", image: { url: "u", width: 1, height: 1 }, overlay: null },
      { type: "gradient", style: "shift", colors: ["#fff", "#eee"] },
      { type: "color", color: "#ffffff", opacity: 50 },
    ] as const) {
      expect(pageIssues(page(row([col([grey()])], { background: background as never })))).toEqual([]);
    }
    expect(pageIssues(page(row([col([grey()])], { background: { type: "video", video: { url: "v" }, poster: null, overlay: null } })))).toEqual([]);
  });

  it("holds a solid colour with opacity 100, and short hex colours, to the same rule", () => {
    const grey = heading(2, "Grey", { textColor: "#aaa" });
    expect(rules(pageIssues(page(row([col([grey])], { background: { type: "color", color: "#fff", opacity: 100 } }))))).toEqual(["contrast"]);
  });

  it("holds a button's text to its fill when the owner chose both", () => {
    const bad = button("Buy now", "/buy", { fill: "#ffff00", textColor: "#ffffff" });
    const good = button("Buy now", "/buy", { fill: "#000000", textColor: "#ffffff" });
    const theme = button("Buy now", "/buy", { fill: "#ffff00" });
    expect(rules(pageIssues(one(bad, good, theme)))).toEqual(["contrast"]);
    // An outline button's text sits on the background behind it.
    const outline = button("Buy now", "/buy", { variant: "outline", textColor: "#cccccc" });
    expect(rules(pageIssues(page(row([col([outline])], { background: { type: "color", color: "#ffffff" } }))))).toEqual(["contrast"]);
  });

  it("uses the theme's text colour where a text has none, in each look the site shows", () => {
    const body = text(doc(para("Words")));
    const dark = row([col([body])], { background: { type: "color", color: "#111111" } });
    const light = { sets: [{ name: "light", text: "#111111", background: "#ffffff" }] };
    const both = { sets: [{ name: "light", text: "#111111", background: "#ffffff" }, { name: "dark", text: "#f5f5f5", background: "#000000" }] };
    // Without the theme nothing is known about rich text.
    expect(pageIssues(page(dark))).toEqual([]);
    // The theme's dark text on a near-black row fails in the light set.
    const issues = pageIssues(page(dark), { theme: light });
    expect(issues.map((i) => i.rule)).toEqual(["contrast"]);
    expect(issues[0].message).toMatch(/in the light colours/);
    // Both looks: the light one still fails, the dark one would pass; one issue for the block.
    expect(pageIssues(page(dark), { theme: both })).toHaveLength(1);
    // A row with no background of its own is the theme's page: nothing of the owner's to hold it to.
    expect(pageIssues(one(body), { theme: light })).toEqual([]);
    // An explicit text colour with no explicit background is held to the theme's background.
    expect(rules(pageIssues(one(heading(2, "Pale", { textColor: "#eeeeee" })), { theme: light }))).toEqual(["contrast"]);
    expect(pageIssues(one(heading(2, "Dark", { textColor: "#222222" })), { theme: light })).toEqual([]);
  });

  it("makes theme sets from the theme's settings as themeWarnings() reads them", () => {
    const palette = { text: "#111", background: "#fff" };
    const settings = { light: palette, dark: { text: "#eee", background: "#000" } };
    expect(themeSetsOf({ mode: "auto", ...settings }).map((s) => s.name)).toEqual(["light", "dark"]);
    expect(themeSetsOf({ mode: "light", ...settings }).map((s) => s.name)).toEqual(["light"]);
    expect(themeSetsOf({ mode: "dark", ...settings }).map((s) => s.name)).toEqual(["dark"]);
    expect(themeSetsOf({ mode: "dark", visitorSwitch: true, ...settings }).map((s) => s.name)).toEqual(["light", "dark"]);
  });
});

describe("text still to fill in, and the notice", () => {
  it("finds a [[placeholder]] in any text, but not an ordinary bracket", () => {
    const rich = text(doc(para("Delivery takes [[Add: delivery time]] days")));
    const head = heading(2, "[[Add: name]]");
    const btn = button("[[Add: label]]", "/x");
    const alt = image("A picture of [[Add: product]]");
    const fine = text(doc(para("Prices [in euro] include VAT [1]")));
    const issues = pageIssues(one(rich, head, btn, alt, fine));
    expect(issues.filter((i) => i.rule === "placeholder").map((i) => i.blockId).sort()).toEqual([rich.id, head.id, btn.id, alt.id].sort());
    expect(issues.every((i) => i.rule !== "placeholder" || i.severity === "blocking")).toBe(true);
  });

  it("finds one in the title", () => {
    const issues = pageIssues({ title: "[[Add: title]]", rows: [] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: "placeholder", blockId: null, rowId: null });
  });

  it("finds the review notice by its class, among other classes", () => {
    const notice = text(doc(para("DRAFT: needs legal review")), { className: `a ${LEGAL_NOTICE_CLASS} b` });
    const other = text(doc(para("Fine")), { className: "legal-review-notice-not" });
    expect(pageIssues(one(notice, other)).map((i) => [i.rule, i.blockId])).toEqual([["legal_notice", notice.id]]);
  });
});

describe("translations", () => {
  const withEn = (blocks: PageBlock[], translations: PageContent["translations"], title = "A page") => ({ ...page(row([col(blocks)])), title, translations });

  it("finds a [[placeholder]] left in a translation after it was filled in the main language", () => {
    const block = text(doc(para("Delivery takes 3 days.")));
    const issues = pageIssues(withEn([block], { "en-GB": { [`block.${block.id}.doc`]: doc(para("Delivery takes [[Add: delivery time]].")) } }));
    expect(rules(issues)).toEqual(["placeholder"]);
    expect(issues[0].blockId).toBe(block.id);
    expect(issues[0].message).toContain("en-GB");
    expect(blockingIssues(issues)).toHaveLength(1);
    expect(unacknowledged(issues, [])).toHaveLength(1);
  });

  it("finds one in a translated heading and in a translated title, but reports a block once", () => {
    const head = heading(2, "Levering");
    const issues = pageIssues(withEn([head], { "en-GB": { [`block.${head.id}.text`]: "[[Add: heading]]", title: "[[Add: title]]" } }));
    expect(issues.map((i) => i.where)).toEqual(["Title", "Heading"]);
    const both = text(doc(para("[[Add: x]]")));
    const again = pageIssues(withEn([both], { "en-GB": { [`block.${both.id}.doc`]: doc(para("[[Add: x]]")) } }));
    expect(rules(again)).toEqual(["placeholder"]);
  });

  it("ignores a translation of a block that is gone, as the site does, and a clean translation", () => {
    const block = text(doc(para("Fine.")));
    expect(pageIssues(withEn([block], { "en-GB": { "block.gone.doc": doc(para("[[Add: x]]")) } }))).toEqual([]);
    expect(pageIssues(withEn([block], { "en-GB": { [`block.${block.id}.doc`]: doc(para("All good.")) } }))).toEqual([]);
  });
});

describe("the checkout page", () => {
  const html = { id: "h", type: "html", html: "<b>x</b>", title: "T" } as PageBlock;
  const youtube = { id: "y", type: "video", source: "youtube", video: null, link: "https://youtu.be/x", poster: null, title: "V" } as PageBlock;
  const vimeo = { id: "v", type: "video", source: "vimeo", video: null, link: "https://vimeo.com/1", poster: null, title: "V" } as PageBlock;
  const upload = { id: "u", type: "video", source: "upload", video: { url: "https://x/a.mp4" }, link: "", poster: null, title: "V" } as PageBlock;

  it("refuses HTML and a video from another site, and only there", () => {
    expect(rules(pageIssues(one(html, youtube, vimeo, upload), { checkout: true }))).toEqual(["pay_page_block", "pay_page_block", "pay_page_block"]);
    expect(pageIssues(one(html, youtube, vimeo, upload))).toEqual([]);
    expect(pageIssues(one(html, youtube), { checkout: false })).toEqual([]);
  });

  it("is refused, not asked about: it can never be acknowledged", () => {
    const issues = pageIssues(one(html), { checkout: true });
    expect(refusedIssues(issues)).toHaveLength(1);
    expect(unacknowledged(issues, ["pay_page_block", issueId(issues[0])])).toHaveLength(1);
  });
});

describe("what publishing makes of the list", () => {
  const issues = pageIssues(one(image(""), image(""), heading(2, "A"), heading(4, "B"), button("Read more", "/x")));

  it("asks about the blocking issues only", () => {
    expect(blockingIssues(issues).map((i) => i.rule)).toEqual(["image_alt", "image_alt"]);
    expect(unacknowledged(issues, undefined)).toHaveLength(2);
  });

  it("takes an acknowledgement by issue or by rule", () => {
    const [first, second] = issues.filter((i) => i.rule === "image_alt");
    expect(unacknowledged(issues, [issueId(first)])).toEqual([second]);
    expect(unacknowledged(issues, ["image_alt"])).toEqual([]);
    expect(unacknowledged(issues, ["contrast"])).toHaveLength(2);
    expect(issueId({ rule: "heading_empty", blockId: null })).toBe("heading_empty:page");
  });

  it("counts each rule for the audit entry, never the text", () => {
    expect(issueCounts(issues)).toEqual([{ rule: "image_alt", count: 2 }, { rule: "heading_order", count: 1 }, { rule: "link_text_generic", count: 1 }]);
    expect(JSON.stringify(issueCounts(issues))).not.toMatch(/Read more/);
  });

  it("groups them for the tab, blocking first", () => {
    const groups = groupIssues(issues);
    expect(groups.map((g) => g.rule)).toEqual(["image_alt", "heading_order", "link_text_generic"]);
    expect(groups[0]).toMatchObject({ title: RULE_TITLE.image_alt, severity: "blocking" });
    expect(groups[0].issues).toHaveLength(2);
    const rulesSeen: PageIssueRule[] = groups.map((g) => g.rule);
    expect(new Set(rulesSeen).size).toBe(rulesSeen.length);
  });

  it("finds nothing wrong with an empty page, or one that is fine", () => {
    expect(pageIssues({ title: "x", rows: [] })).toEqual([]);
    expect(pageIssues(one(heading(1, "Welcome"), text(doc(h(2, "Shipping"), para("We ship in two days. ", undefined), para("Details in our shipping policy", "/shipping"))), image("A parcel"), button("See the shop", "/shop")))).toEqual([]);
  });
});
