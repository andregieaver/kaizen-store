import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { refusalOf } from "@/lib/form-problems";
import { COMMON_WORDS } from "@/lib/admin-words/common";
import { KIT_WORDS } from "@/lib/admin-words/kit";

import { ConfirmButton, splitQuestion } from "./confirm-button";
import { fieldClass, TextArea, type FieldControl } from "./field";
import { pageAddress } from "./pager";
import ConfirmDialog from "./confirm-dialog";
import { BUTTON_KINDS, BUTTON_SIZES, Button, ButtonLink, buttonClass, Card, Chip, CountBadge, EmptyState, Field, fillWidth, FocusFrame, FocusHeading, InsightPanel, KpiTile, List, ListRow, ListSearch, PageHeader, Pager, RowActions, RowAmount, RowFact, RowId, RowLead, ScoreBar, Select, ShareBar, TextInput, TrendChip } from "./index";

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

/**
 * The admin's components (docs/admin-style.md section 5): they draw in the colour roles only, so every scheme draws them, and they
 * keep what the style document promises a reader: colour never alone, a figure never hidden behind a bar, when the AI wrote a thing.
 */

describe("the components' source", () => {
  const dir = __dirname;
  const files = readdirSync(dir).filter((f) => f.endsWith(".tsx"));

  it.each(files)("%s names no colour of its own and no older token: roles only", (file) => {
    const source = readFileSync(join(dir, file), "utf8");
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/\b(?:bg|text|border|divide|ring|fill|stroke|outline)-(?:white|black|(?:red|green|blue|amber|yellow|emerald|neutral|gray|zinc|slate|stone)-\d{2,3})\b/);
    expect(source).not.toMatch(/\b(?:bg|text|border|divide)-(?:background|foreground|surface|border|accent)\b/);
    // Hierarchy is size and colour, never weight (docs/admin-style.md 5.1).
    expect(source).not.toMatch(/\bfont-(?:semibold|bold|extrabold|black)\b/);
  });
});

describe("Button", () => {
  it("draws every kind as a pill in its roles, with its height, and the link without a shape", () => {
    for (const kind of BUTTON_KINDS) {
      for (const size of BUTTON_SIZES) {
        const cls = buttonClass(kind, size);
        if (kind === "link") expect(cls).not.toContain("rounded-pill");
        else expect(cls).toContain("rounded-pill");
        expect(cls).toContain("disabled:opacity-45");
      }
    }
    expect(buttonClass("main")).toContain("bg-brand text-brand-ink");
    expect(buttonClass("strong", "card", true)).toContain("bg-inverse text-inverse-ink");
    expect(buttonClass("strong", "card", true)).toContain("w-full");
    expect(buttonClass("danger")).toContain("bg-danger-soft text-danger-text");
    expect(buttonClass("main", "header")).toContain("h-11");
    expect(buttonClass("icon", "card")).toContain("size-10");
  });

  it("is a button that submits nothing unless asked, and a link that is a link", () => {
    expect(html(h(Button, { kind: "main" }, "Save"))).toMatch(/^<button type="button"/);
    expect(html(h(Button, { kind: "main", type: "submit" }, "Save"))).toMatch(/^<button type="submit"/);
    const link = html(h(ButtonLink, { kind: "link", href: "/admin/x/invoices" }, "All invoices"));
    expect(link).toMatch(/^<a [^>]*href="\/admin\/x\/invoices"/);
    expect(link).toContain('aria-hidden="true"'); // the chevron
  });

  it("names a round icon button", () => {
    const out = html(h(Button, { kind: "icon", "aria-label": "Notifications", icon: h("svg") }));
    expect(out).toContain('aria-label="Notifications"');
  });
});

describe("chips and badges", () => {
  it("draws a state in its signal's tint and words, the dot hidden", () => {
    const out = html(h(Chip, { signal: "warning", dot: true, children: "Overdue" }));
    expect(out).toContain("bg-warning-soft text-warning-text");
    expect(out).toContain('aria-hidden="true" class="size-1.5 rounded-full bg-warning-solid"');
    expect(out).toContain("Overdue");
  });

  it("says a trend in words, the arrow only repeating it", () => {
    const out = html(h(TrendChip, { direction: "up", signal: "danger", children: "Up 11 since June" }));
    expect(out).toContain('<span aria-hidden="true">↑</span>Up 11 since June');
    expect(out).toContain("bg-danger-soft");
  });

  it("reads a count by what it counts", () => {
    expect(html(h(CountBadge, { count: 4, label: "4 open invoices" }))).toContain('<span class="sr-only">4 open invoices</span>');
    expect(html(h(CountBadge, { count: 4 }))).not.toContain("sr-only");
  });
});

describe("cards and tiles", () => {
  it("labels a card by its title, flat in light and lined in dark", () => {
    const out = html(h(Card, { title: "Payment behaviour", count: 3, countLabel: "3 customers", aside: "Last 12 months" }, "body"));
    const id = out.match(/aria-labelledby="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`<h2 id="${id}" class="text-title text-ink">Payment behaviour</h2>`);
    expect(out).toContain("rounded-card bg-card dark:border dark:border-line");
    expect(out).not.toMatch(/shadow/);
    expect(out).toContain("3 customers");
  });

  it("says what a card is for under its title, on a line of its own", () => {
    const out = html(h(Card, { title: "Calendar sync", description: "Give each site this calendar." }, "body"));
    expect(out).toContain('<div class="max-w-[75ch] basis-full text-body text-muted">Give each site this calendar.</div>');
    expect(out.indexOf("Calendar sync")).toBeLessThan(out.indexOf("Give each site"));
  });

  it("is a section without a name when it has no title", () => {
    expect(html(h(Card, {}, "body"))).not.toContain("aria-labelledby");
  });

  it("shows a KPI's label, value and context, a dash (never 0) for a figure not known, and links the whole tile", () => {
    const out = html(h(KpiTile, { label: "Outstanding", value: "842 000 kr", context: "Across 12 invoices" }));
    expect(out).toContain("text-metric text-ink tabular-nums");
    expect(out).toContain("Across 12 invoices");
    expect(html(h(KpiTile, { label: "Profit", value: null, context: "Costs are not entered yet." }))).not.toMatch(/>0</);
    expect(html(h(KpiTile, { label: "Orders", value: "31", href: "/admin/s/orders" }))).toMatch(/^<a [^>]*href="\/admin\/s\/orders"/);
  });
});

describe("bars", () => {
  it("never draws past the track", () => {
    expect(fillWidth(0.58)).toBe("58%");
    expect(fillWidth(1.4)).toBe("100%");
    expect(fillWidth(-1)).toBe("0%");
    expect(fillWidth(Number.NaN)).toBe("0%");
  });

  it("is read from its label and figure; the bar is hidden", () => {
    const out = html(h(ShareBar, { label: "Paid on time", figure: "58 %", share: 0.58, signal: "positive" }));
    expect(out).toContain("Paid on time");
    expect(out).toContain("58 %");
    expect(out).toMatch(/<span aria-hidden="true" class="block h-2[^"]*"><span class="[^"]*bg-positive-solid[^"]*" style="width:58%">/);
    expect(html(h(ScoreBar, { label: "Payment history", points: "+22", share: 0.7, signal: "insight" }))).toContain("+22");
  });
});

describe("the insight panel", () => {
  it("always says when the AI wrote it", () => {
    const out = html(h(InsightPanel, { title: "What changed", at: new Date("2026-10-14T09:00:00Z"), when: "Today, 11:00", children: "Fewer late payments." }));
    expect(out).toContain('<time dateTime="2026-10-14T09:00:00.000Z"');
    expect(out).toContain("Today, 11:00");
    expect(out).toContain("bg-insight-soft");
  });
});

describe("lists", () => {
  it("gives only a linked row the pointer's colour", () => {
    const plain = html(h(List, { label: "Invoices", children: h(ListRow, { children: [h(RowId, { key: 1, children: "INV-1" }), h(RowAmount, { key: 2, children: "100 kr" })] }) }));
    expect(plain).toContain('aria-label="Invoices"');
    expect(plain).not.toContain("hover:bg-sunken");
    const linked = html(h(List, { children: h(ListRow, { href: "/admin/s/invoices/1", children: h(RowId, { children: "INV-1" }) }) }));
    expect(linked).toContain('href="/admin/s/invoices/1"');
    expect(linked).toContain("hover:bg-sunken");
  });

  it("links a row with buttons of its own by its title, and lets a fact name itself with a line under it", () => {
    const out = html(
      h(List, {
        children: h(ListRow, {
          children: [
            h(RowLead, { key: 1, title: "SUMMER10", href: "/admin/s/discounts/1", sub: "10 % off" }),
            h(RowFact, { key: 2, sub: "1 200 kr given", className: "hidden sm:block", children: "Used 3 of 10" }),
            h(RowActions, { key: 3, children: h(Button, { kind: "quiet", children: "Edit" }) }),
          ],
        }),
      }),
    );
    expect(out).toContain('<a class="text-body-strong text-ink underline-offset-2 hover:underline" href="/admin/s/discounts/1">SUMMER10</a>');
    expect(out).toContain('<span class="block text-caption text-muted">10 % off</span>');
    expect(out).toContain("hidden sm:block");
    expect(out).toContain("Used 3 of 10");
    expect(out.match(/<a /g)).toHaveLength(1);
    expect(out).toContain('class="ml-auto flex shrink-0 items-center gap-1"');
  });
});

describe("the focus layout", () => {
  it("draws Kaizena Flow's mark, one card on the canvas with the page's h1, and no level's navigation", () => {
    const out = html(
      h(FocusFrame, { title: "Sign in to Kaizena Flow", description: "Only invited accounts.", back: { href: "/admin/sign-in", label: "Back to sign in" }, aside: "Ask for a store", children: "form" }),
    );
    expect(out).toContain('data-admin-layout="focus"');
    expect(out).toContain("bg-canvas");
    expect(out).toContain('<h1 class="text-display text-ink">Sign in to Kaizena Flow</h1>');
    expect(out).toContain('href="/admin/sign-in"');
    expect(out).toContain("Ask for a store");
    expect(out).toContain("rounded-card bg-card");
    expect(out.match(/<main/g)).toHaveLength(1);
    expect(out).not.toContain("<nav");
    expect(out).toContain("max-w-[440px]");
    expect(html(h(FocusFrame, { width: "wide" }))).toContain("max-w-[560px]");
  });

  it("lets a page whose title depends on what it finds draw the heading inside", () => {
    const out = html(h(FocusFrame, { children: h(FocusHeading, { title: "This sign-in has expired" }) }));
    expect(out.match(/<h1/g)).toHaveLength(1);
  });
});

describe("the page header", () => {
  it("joins the facts with a dot read as a pause, and leaves out empty ones", () => {
    const out = html(h(PageHeader, { eyebrow: "Customers", title: "Alderney Ceramics", meta: ["Oslo", null, "Since 2021"] }));
    expect(out).toContain('<h1 class="text-display text-ink');
    expect(out).toContain("Oslo<span aria-hidden=\"true\"> · </span><span class=\"sr-only\">, </span>Since 2021");
    expect(out).toContain("text-eyebrow text-muted uppercase");
  });
});

describe("the page header's way back and description", () => {
  it("leads back to the page it belongs under, and says what the page is for at a reading width", () => {
    const out = html(h(PageHeader, { back: { href: "/admin/s/plans", label: "Plans" }, title: "Plan features", description: "Tick what each plan includes." }));
    expect(out).toMatch(/<a [^>]*href="\/admin\/s\/plans"[^>]*>.*Plans<\/a>/);
    expect(out).toContain('aria-hidden="true"'); // the chevron
    expect(out).toContain('<div class="mt-2 max-w-[75ch] text-body text-ink-2">Tick what each plan includes.</div>');
    expect(out.indexOf("Plans")).toBeLessThan(out.indexOf("<h1"));
  });
});

describe("fields (code review 1.12)", () => {
  it("draws a field's box in the roles, 40 px or dense, as wide as asked", () => {
    expect(fieldClass()).toContain("min-h-10 px-3");
    expect(fieldClass()).toContain("rounded-md border border-line bg-card text-sm font-normal");
    expect(fieldClass({ dense: true })).toContain("min-h-9 px-2");
    expect(fieldClass({ full: true })).toContain("w-full");
    expect(fieldClass()).not.toContain("w-full");
    const input = html(h(TextInput, { name: "q", defaultValue: "mugs", className: "max-w-xs" }));
    expect(input).toMatch(/^<input class="[^"]*min-h-10[^"]* max-w-xs" name="q" value="mugs"\/>$/);
    const select = html(h(Select, { name: "tag", defaultValue: "b", dense: true }, h("option", { value: "a" }, "A"), h("option", { value: "b" }, "B")));
    expect(select).toMatch(/^<select class="[^"]*min-h-9 px-2[^"]*" name="tag">/);
    expect(select).toContain('<option value="b" selected="">B</option>');
    expect(html(h(TextArea, { name: "note", rows: 3 }))).toContain("rounded-md border border-line bg-card");
  });

  it("ties the label, the hint and the problem to the control, and marks a required one", () => {
    const out = html(
      h(Field, { label: "Email", hint: "Where receipts go.", problem: "Write an email address.", required: true, children: (control: FieldControl) => h(TextInput, { name: "email", ...control }) }),
    );
    const id = out.match(/<label for="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(out).toContain(`id="${id}"`);
    expect(out).toContain(`aria-describedby="${id}-hint ${id}-problem"`);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('required=""');
    expect(out).toContain('<span aria-hidden="true" class="text-danger-text"> *</span>');
    expect(out.indexOf("Where receipts go.")).toBeLessThan(out.indexOf("Write an email address."));
    expect(out).toContain(`<p id="${id}-problem" class="text-sm text-danger-text">Write an email address.</p>`);
  });

  it("says nothing it was not given, and takes a control drawn another way by its id", () => {
    const plain = html(h(Field, { label: "Name", children: (control: FieldControl) => h(TextInput, { name: "name", ...control }) }));
    expect(plain).not.toContain("aria-describedby");
    expect(plain).not.toContain('aria-invalid="');
    expect(plain).not.toContain("required");
    const given = html(h(Field, { label: "Colour", id: "colour", children: h("input", { id: "colour", type: "color" }) }));
    expect(given).toContain('<label for="colour"');
    expect(given).toContain('<input id="colour" type="color"/>');
  });
});

describe("the empty state (code review 1.12)", () => {
  it("names what is missing, says what it is for and offers one next step", () => {
    const out = html(h(EmptyState, { title: "No price lists yet", action: h(ButtonLink, { kind: "main", href: "/admin/s/price-lists/new" }, "Make a price list") }, "Give a group of customers their own prices."));
    expect(out).toContain("border-dashed border-line");
    expect(out).toContain('<p class="text-body-strong text-ink">No price lists yet</p>');
    expect(out).toContain("Give a group of customers their own prices.");
    expect(out).toMatch(/href="\/admin\/s\/price-lists\/new"/);
    expect(out.indexOf("No price lists yet")).toBeLessThan(out.indexOf("Make a price list"));
  });

  it("has a small left-aligned form for a panel or a dialog", () => {
    const out = html(h(EmptyState, { title: "Nothing saved", compact: true }, "Save a section to use it again."));
    expect(out).toContain("items-start");
    expect(out).toContain('<div class="text-xs text-muted">Save a section to use it again.</div>');
    expect(out).not.toContain("text-center");
  });

  it("takes a screen's own classes after its own, so a phone keeps the plain line a redesign round gave it (code review 2.9, D845)", () => {
    const out = html(h(EmptyState, { title: "No redirects yet", className: "max-sm:items-start max-sm:border-0 max-sm:p-0 max-sm:text-left" }));
    expect(out).toMatch(/class="flex flex-col items-center [^"]*text-center max-sm:items-start max-sm:border-0 max-sm:p-0 max-sm:text-left"/);
    // No line and no step: the title alone (a list whose header already holds the next step).
    expect(out).not.toContain("text-muted");
    expect(out).not.toContain("<a ");
  });
});

describe("the pager (code review 1.12)", () => {
  const words = { label: "Pages", shownOf: "{shown} of {total}", previous: "Previous {n}", next: "Next {n}", first: "Back to the first page" };

  it("pages by number: how many of how many, and the hundred after, keeping the other values", () => {
    const out = html(h(Pager, { words, base: "/admin/s/pages", query: { status: "draft", page: "1" }, page: 1, size: 100, shown: 100, total: 150 }));
    expect(out).toContain('<nav aria-label="Pages"');
    expect(out).toContain("100 of 150");
    expect(out).toContain('href="/admin/s/pages?status=draft&page=2"');
    expect(out).toContain('rel="next"');
    expect(out).toContain("Next 100");
    expect(out).not.toContain("Previous");
  });

  it("leads back to page one without the page in the address, and draws nothing when everything is shown", () => {
    const out = html(h(Pager, { words, label: "Pages of the list", base: "/admin/s/pages", page: 2, size: 100, shown: 50, total: 150 }));
    expect(out).toContain('aria-label="Pages of the list"');
    expect(out).toContain("150 of 150");
    expect(out).toMatch(/rel="prev"[^>]*href="\/admin\/s\/pages"/);
    expect(out).not.toContain("Next");
    expect(html(h(Pager, { words, base: "/admin/s/pages", page: 1, size: 100, shown: 12, total: 12 }))).toBe("");
    expect(pageAddress("/x", { q: "a b", tags: ["1", "2"] }, 3)).toBe("/x?q=a+b&page=3");
  });

  it("pages by cursor: the way back names the first page, and nothing is drawn with nowhere to go", () => {
    const out = html(h(Pager, { words, previous: "/admin/s/orders", first: true, next: "/admin/s/orders?after=abc" }));
    expect(out).toContain("Back to the first page");
    expect(out).toMatch(/rel="next"[^>]*href="\/admin\/s\/orders\?after=abc"/);
    expect(html(h(Pager, { words: { ...words, next: "Next 50 orders" }, next: "/n" }))).toContain("Next 50 orders");
    expect(html(h(Pager, { words, previous: null, next: null }))).toBe("");
  });
});

describe("the list's search (code review 1.12)", () => {
  it("is a GET form with a real named field, so it works without a script and the words stay in the address", () => {
    const out = html(h(ListSearch, { action: "/admin/s/customers", words: { label: "Search", button: "Search" }, value: "anna", placeholder: "Name or email", keep: { show: "new", sort: null } }));
    expect(out).toMatch(/^<form role="search"[^>]* action="\/admin\/s\/customers" method="get">/);
    expect(out).toContain('<input type="hidden" name="show" value="new"/>');
    expect(out).not.toContain('name="sort"');
    expect(out).toMatch(/<input id="[^"]+" type="search" [^>]*name="q" value="anna"\/>/);
    expect(out).toContain('placeholder="Name or email"');
    expect(out).toMatch(/<label for="[^"]+" class="sr-only">Search<\/label>/);
    expect(out).toContain('<button type="submit" class="flex size-9');
  });

  it("names the field and the form as the list asks, hides the button where Enter is enough, and holds the list's tools", () => {
    const out = html(
      h(ListSearch, { action: "/a", words: { label: "Search", button: "Search" }, name: "query", label: "Search orders", formLabel: "Find orders", button: "hidden", tools: h("details", null, "Filters"), children: h("p", null, "under") }),
    );
    expect(out).toContain('aria-label="Find orders"');
    expect(out).toContain('name="query"');
    expect(out).toContain(">Search orders</label>");
    expect(out).toContain('<button type="submit" class="sr-only">Search</button>');
    expect(out).toContain("<details>Filters</details></div><p>under</p></form>");
  });
});

describe("the confirm button (code review 1.12)", () => {
  it("submits its form as its submitter, or calls its action, after asking: closed, it is a button with a dialog to open", () => {
    const form = html(h(ConfirmButton, { question: "Delete Spring?", confirm: "Delete", name: "intent", value: "delete" }, "Delete"));
    expect(form).toMatch(/^<button value="delete" type="submit" class="[^"]*border-edge[^"]*" aria-haspopup="dialog" name="intent">Delete<\/button>$/);
    const own = html(h(ConfirmButton, { question: "Revoke Shop key?", confirm: "Revoke", action: () => undefined, kind: "danger", size: "dense" }, "Revoke"));
    expect(own).toMatch(/^<button type="button" class="[^"]*h-8[^"]*bg-danger-soft/);
    expect(html(h(ConfirmButton, { question: "Remove?", confirm: "Remove", kind: "none", className: "text-sm underline" }, "Remove"))).toContain('class="text-sm underline"');
  });

  it("asks with the action's own words: the first sentence the title, the rest under it", () => {
    expect(splitQuestion("Remove Hook? Nothing more is sent to it and its log goes too.")).toEqual({ title: "Remove Hook?", detail: "Nothing more is sent to it and its log goes too." });
    expect(splitQuestion("Delete this response for good?")).toEqual({ title: "Delete this response for good?", detail: "" });
    expect(splitQuestion("I want to delete Home; this cannot be undone.")).toEqual({ title: "I want to delete Home; this cannot be undone.", detail: "" });
    expect(splitQuestion("Is 1?5 ok? Yes.")).toEqual({ title: "Is 1?5 ok?", detail: "Yes." });
    const dialog = html(h(ConfirmDialog, { title: "Remove Hook?", detail: "Its log goes too.", confirm: "Remove", cancel: "Cancel", danger: true, onCancel: () => undefined, onConfirm: () => undefined }));
    expect(dialog).toContain("Remove Hook?");
    expect(dialog).toContain("<p>Its log goes too.</p>");
    expect(dialog).toMatch(/data-confirm-cancel="">Cancel<\/button>/);
    expect(dialog).toMatch(/bg-danger-soft[^"]*" data-confirm-yes="">Remove<\/button>/);
  });

  it("shows what a refused action said, in the shapes the admin's actions answer with", () => {
    expect(refusalOf({ ok: false, problems: ["In use.", "Try later."] })).toBe("In use. Try later.");
    expect(refusalOf({ ok: false, problem: "Not connected." })).toBe("Not connected.");
    expect(refusalOf({ ok: false, message: "Gone." })).toBe("Gone.");
    expect(refusalOf({ ok: true })).toBeNull();
    expect(refusalOf(undefined)).toBeNull();
  });

  it("is kept out of the kit's index, which every route's server code reaches: its index names no client part but the link", () => {
    const index = readFileSync(join(__dirname, "index.ts"), "utf8");
    const named = [...index.matchAll(/^export \{[^}]*\} from "\.\/([\w-]+)";$/gm)].map((m) => m[1]);
    const client = named.filter((name) => /^\s*["']use client["']/.test(readFileSync(join(__dirname, `${name}.tsx`), "utf8")));
    expect(client).toEqual(["link"]);
    expect(index).not.toMatch(/export \{[^}]*\bConfirmButton\b[^}]*\} from/);
  });

  it("never asks with the browser's own confirm", () => {
    for (const file of ["confirm-button.tsx", "confirm-dialog.tsx"]) expect(readFileSync(join(__dirname, file), "utf8")).not.toMatch(/\bconfirm\(/);
  });
});

describe("the kit's words (code review 1.12)", () => {
  it("are in both languages, with the same placeholders", () => {
    const en = KIT_WORDS.en;
    const nb = KIT_WORDS.nb;
    for (const key of Object.keys(en.pager) as (keyof typeof en.pager)[]) {
      expect(nb.pager[key].match(/\{\w+\}/g) ?? []).toEqual(en.pager[key].match(/\{\w+\}/g) ?? []);
    }
    expect(nb.search.button).toBe("Søk");
    expect(COMMON_WORDS.nb.form.cancel).toBe("Avbryt");
  });
});
