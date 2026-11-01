import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { adminTexts } from "@/lib/admin-text";
import type { RunningPageJob } from "@/server/page-jobs";

import { AdminTextScope } from "./admin-text";
import { PageJobsPanel } from "./page-jobs-panel";

/** The AI's page work on the Pages list (PSI UX-01). */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");

const jobs: RunningPageJob[] = [
  { kind: "build", id: "b1", title: "Catering", running: true, asked: "2026-11-01T10:00:00.000Z" },
  { kind: "build", id: "b2", title: "", running: false, asked: "2026-11-01T10:01:00.000Z" },
  { kind: "pictures", pageId: "p1", title: "Om oss", type: "article", made: 2, waiting: 2, notMade: 1 },
];
const stop = async () => ({ status: "ok" as const, messages: [] });
const panel = (props: Partial<Parameters<typeof PageJobsPanel>[0]> = {}) =>
  createElement(PageJobsPanel, { jobs, pagesBase: "/admin/s/pages", articlesBase: "/admin/s/articles", stop, ...props });

describe("the AI's page work on the Pages list", () => {
  it("shows each build's state and each page's pictures with a bar, and a Stop for each", () => {
    const out = html(panel());
    expect(out).toContain("Being made by AI");
    expect(out).toContain("Catering");
    expect(out).toContain("Being built now");
    expect(out).toContain("Untitled page");
    expect(out).toContain("Waiting its turn");
    expect(out).toContain("2 of 5 pictures made · one could not be made");
    expect(out).toMatch(/<progress[^>]*value="3"[^>]*max="5"/);
    expect(out).toContain('href="/admin/s/articles/p1"');
    expect(out.match(/>Stop</g)).toHaveLength(2);
    expect(out).toContain(">Stop the pictures<");
  });

  it("offers no Stop to who may not change the site, shows nothing when nothing is being made, and speaks the account's language", () => {
    expect(html(panel({ stop: undefined }))).not.toContain(">Stop");
    expect(html(panel({ jobs: [] }))).toBe("");
    const nb = html(createElement(AdminTextScope, { texts: adminTexts("nb", ["website"]) } as Parameters<typeof AdminTextScope>[0], panel()));
    expect(nb).toContain("Lages av AI");
    expect(nb).toContain("Bygges nå");
    expect(nb).toContain("2 av 5 bilder laget · ett kunne ikke lages");
  });
});
