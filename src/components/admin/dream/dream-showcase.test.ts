import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { homeEn } from "@/lib/admin-messages/home.en";
import { homeNb } from "@/lib/admin-messages/home.nb";
import { DREAM_STEP_IDS, initialSteps, type DreamSteps } from "@/lib/dream-factory";
import type { DreamShowcase } from "@/server/dream-showcase";

import { DreamFeed, DreamMade, DreamProgress, DreamReady, DreamSketch, DreamTimeline } from "./dream-showcase";

/** Watching the Dream Factory build (D419): what the owner sees as the run goes, from the run's steps and what it has made. */

const NOW = new Date("2026-11-02T10:10:00Z");
const START = new Date("2026-11-02T10:00:00Z");
const w = homeEn.dream;

const EMPTY: DreamShowcase = { notes: [], brand: null, look: null, marks: { logo: null, icon: null, at: null }, products: [], productCount: 0, pages: [], legal: [], goals: [], feed: [] };

const MADE: DreamShowcase = {
  notes: [{ topic: "Ceramics in Norway", finding: "Handmade mugs sell at 300 to 600 kroner.", sites: ["example.com"], at: "2026-11-02T10:02:00Z" }],
  brand: { tagline: "Slow mornings, made by hand", voice: "Warm and plain", values: ["Handmade", "Local clay"] },
  look: {
    title: "Leire calm",
    light: { background: "#fafaf7", surface: "#f1ece4", text: "#2b2622", muted: "#6d655d", border: "#e2dbd0", accent: "#7a3e2b", accentText: "#ffffff" } as never,
    fonts: { heading: "Playfair Display", body: "Inter" } as never,
    at: "2026-11-02T10:04:00Z",
  },
  marks: { logo: "https://cdn.example.com/leire-logo.png", icon: null, at: "2026-11-02T10:05:00Z" },
  products: [
    { id: "p1", title: "Morning mug", picture: "https://cdn.example.com/mug.jpg", price: "kr 349", at: "2026-11-02T10:06:00Z" },
    { id: "p2", title: "Breakfast bowl", picture: null, price: null, at: "2026-11-02T10:07:00Z" },
  ],
  productCount: 6,
  pages: [
    { title: "Home", status: "built", pageId: "page-1" },
    { title: "About us", status: "building", pageId: null },
  ],
  legal: [{ name: "Terms of sale", status: "written" }],
  goals: ["First ten orders"],
  feed: [
    { at: "2026-11-02T10:07:00Z", kind: "product", label: "Breakfast bowl" },
    { at: "2026-11-02T10:02:00Z", kind: "note", label: "Ceramics in Norway" },
  ],
};

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element).replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&amp;", "&");

function steps(over: Partial<DreamSteps>): DreamSteps {
  return { ...initialSteps(), ...over };
}

describe("the run as it goes", () => {
  it("shows the progress, what the AI does now and the minutes since the start", () => {
    const out = html(
      createElement(DreamProgress, {
        steps: steps({ brief: { status: "done", tries: 1 }, confirm: { status: "done", tries: 0 }, research: { status: "running", tries: 1, startedAt: "2026-11-02T10:05:00Z" } }),
        startedAt: START,
        now: NOW,
        storeName: "Leire",
        words: w,
      }),
    );
    expect(out).toContain("Building Leire");
    expect(out).toContain("2 of 16 steps done");
    expect(out).toContain('aria-valuenow="13"');
    expect(out).toContain("Started 10 min ago");
    expect(out).toContain(w.show.doing.research);
    expect(out).not.toContain(`${w.show.next}: `);
  });

  it("puts every step on the timeline with its status, its minutes and what a step offers", () => {
    const out = html(
      createElement(DreamTimeline, {
        steps: steps({ brief: { status: "done", tries: 1, startedAt: "2026-11-02T10:00:00Z", finishedAt: "2026-11-02T10:02:00Z" }, research: { status: "asking", tries: 3, detail: "No sources found." } }),
        now: NOW,
        words: w,
        action: (id) => (id === "research" ? createElement("button", null, "Try again") : null),
      }),
    );
    for (const id of DREAM_STEP_IDS) expect(out).toContain(w.steps[id]);
    expect(out).toContain("2 min");
    expect(out).toContain("No sources found.");
    expect(out).toContain(w.show.doing.research);
    expect(out.match(/Try again/g)).toHaveLength(1);
  });
});

describe("the sketch of the store", () => {
  it("shimmers where nothing is made yet, in neutral greys", () => {
    const out = html(createElement(DreamSketch, { show: EMPTY, storeName: "Leire", address: "leire.kaizenaflow.com", words: w }));
    expect(out).toContain("leire.kaizenaflow.com");
    expect(out).toContain("Leire");
    expect(out).toContain("dream-shimmer");
    expect(out).toContain(w.show.preview);
  });

  it("fills in with the logo, the tagline in the look's fonts and colours, the pages and the products", () => {
    const out = html(createElement(DreamSketch, { show: MADE, storeName: "Leire", address: "leire.kaizenaflow.com", words: w }));
    expect(out).toContain('src="https://cdn.example.com/leire-logo.png"');
    expect(out).toContain("Slow mornings, made by hand");
    expect(out).toContain('font-family:"Playfair Display", serif');
    expect(out).toContain("background-color:#7a3e2b");
    expect(out).toContain("About us");
    expect(out).toContain("Morning mug");
    expect(out).toContain("kr 349");
  });
});

describe("what was made", () => {
  it("lists the feed newest first with how long ago, or says what will show there", () => {
    expect(html(createElement(DreamFeed, { show: EMPTY, now: NOW, words: w }))).toContain(w.show.nothingYet);
    const out = html(createElement(DreamFeed, { show: MADE, now: NOW, words: w }));
    expect(out).toContain("Made the product Breakfast bowl");
    expect(out).toContain("3 min ago");
    expect(out.indexOf("Breakfast bowl")).toBeLessThan(out.indexOf("Ceramics in Norway"));
  });

  it("shows a card for each kind made, with links into the admin", () => {
    const out = html(createElement(DreamMade, { show: MADE, base: "/admin/leire", words: w }));
    expect(out).toContain("Warm and plain");
    expect(out).toContain("Local clay");
    expect(out).toContain("Headings: Playfair Display");
    expect(out).toContain("From example.com");
    expect(out).toContain("Products (6)");
    expect(out).toContain("and 4 more");
    expect(out).toContain('href="/admin/leire/products/p1"');
    expect(out).toContain(w.show.noPicture);
    expect(out).toContain('href="/admin/leire/pages/page-1"');
    expect(out).toContain("Terms of sale");
    expect(out).toContain("First ten orders");
    expect(html(createElement(DreamMade, { show: EMPTY, base: "/admin/leire", words: w }))).toBe("<div class=\"flex flex-col gap-4\"></div>");
  });

  it("links nowhere for a viewer who is not the store's member (Platform → AI watching a test run)", () => {
    const out = html(createElement(DreamMade, { show: MADE, base: null, words: w }));
    expect(out).toContain("Morning mug");
    expect(out).not.toContain("<a ");
  });

  it("says the store is ready, with the ways on", () => {
    const out = html(createElement(DreamReady, { show: MADE, links: { store: "https://leire.kaizenaflow.com/no", front: "/admin/leire/pages/page-1", products: "/admin/leire/products" }, words: w }));
    expect(out).toContain(w.show.readyTitle);
    expect(out).toContain('href="https://leire.kaizenaflow.com/no"');
    expect(out).toContain(w.show.editFront);
    expect(out).toContain(w.show.seeProducts);
  });
});

describe("the words", () => {
  it("has every step's narration in both languages", () => {
    for (const id of DREAM_STEP_IDS) {
      expect(homeEn.dream.show.doing[id]).not.toBe("");
      expect(homeNb.dream.show.doing[id]).not.toBe("");
    }
  });

  it("renders in Norwegian", () => {
    const out = html(createElement(DreamFeed, { show: MADE, now: NOW, words: homeNb.dream }));
    expect(out).toContain(homeNb.dream.show.latest);
  });
});
