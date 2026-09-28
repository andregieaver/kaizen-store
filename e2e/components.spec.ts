import { expect, test } from "@playwright/test";

import { storePageWith } from "./db";

/** The newer page components (D91), as the site shows them. */

test("a separator line draws with its own style, thickness, colour, width and place", async ({ page }) => {
  const address = await storePageWith("separator", [
    { id: "plain", type: "separator" },
    { id: "styled", type: "separator", line: "dashed", thickness: 4, color: "#ff0000", width: 50, position: "right", htmlId: "styled" },
  ]);
  await page.goto(address);
  const lines = page.locator("main hr");
  await expect(lines).toHaveCount(2);
  await expect(lines.first()).toHaveCSS("border-top-style", "solid");
  await expect(lines.first()).toHaveCSS("border-top-width", "1px");
  const styled = lines.nth(1);
  await expect(styled).toHaveCSS("border-top-style", "dashed");
  await expect(styled).toHaveCSS("border-top-width", "4px");
  await expect(styled).toHaveCSS("border-top-color", "rgb(255, 0, 0)");
  // Half its column, at the right.
  const [line, column] = await Promise.all([styled.boundingBox(), page.locator("#styled").boundingBox()]);
  expect(Math.round(line!.width)).toBe(Math.round(column!.width / 2));
  expect(Math.round(line!.x + line!.width)).toBe(Math.round(column!.x + column!.width));
});

test("a dual button shows its two buttons side by side, one under another on phones if set", async ({ page }) => {
  const address = await storePageWith("dual", [
    {
      id: "pair",
      type: "dualButton",
      first: { label: "Handle nå", href: "/products" },
      second: { label: "Les mer", href: "https://example.com", newTab: true, variant: "outline" },
      stackOnPhones: true,
      gap: 20,
    },
    { id: "half", type: "dualButton", first: { label: "Bare én", href: "/om" }, second: { label: "", href: "" } },
  ]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(address);
  const first = page.getByRole("link", { name: "Handle nå" });
  const second = page.getByRole("link", { name: "Les mer (opens in a new tab)" });
  await expect(second).toHaveAttribute("target", "_blank");
  const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(Math.round(a!.y)).toBe(Math.round(b!.y));
  expect(Math.round(b!.x - (a!.x + a!.width))).toBe(20);
  // A button without its text and address is left out.
  await expect(page.getByRole("link", { name: "Bare én" })).toBeVisible();
  await expect(page.locator("main a[href='']")).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 800 });
  const [c, d] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(d!.y).toBeGreaterThan(c!.y + c!.height);
  expect(Math.round(c!.width)).toBe(Math.round(d!.width));
});

test("an accordion opens its sections without script, one at a time if set, and find opens the one holding a word", async ({ page }) => {
  const text = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });
  const address = await storePageWith("accordion", [
    {
      id: "acc",
      type: "accordion",
      openFirst: true,
      single: true,
      items: [
        { id: "a", title: "Levering", body: text("Vi sender innen to dager.") },
        { id: "b", title: "Retur", body: text("Du kan returnere i 30 dager.") },
        { id: "c", title: "", body: text("Uten tittel vises ikke.") },
      ],
    },
  ]);
  await page.goto(address);
  const delivery = page.locator("main details").filter({ hasText: "Levering" });
  const returns = page.locator("main details").filter({ hasText: "Retur" });
  await expect(page.locator("main details")).toHaveCount(2);
  await expect(page.getByText("Vi sender innen to dager.")).toBeVisible();
  await expect(page.getByText("Du kan returnere i 30 dager.")).toBeHidden();
  // Opening the second closes the first.
  await returns.locator("summary").click();
  await expect(page.getByText("Du kan returnere i 30 dager.")).toBeVisible();
  await expect(delivery).not.toHaveAttribute("open");
  // The text is in the page for search engines and the browser's find, even while closed.
  expect(await page.content()).toContain("Vi sender innen to dager.");
});

test("tabs show one panel at a time, chosen by clicking or the arrow keys, with every panel in the page", async ({ page }) => {
  const text = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });
  const address = await storePageWith("tabs", [
    {
      id: "tabs",
      type: "tabs",
      items: [
        { id: "a", title: "Beskrivelse", body: text("En hvit kopp i steingods.") },
        { id: "b", title: "Mål", body: text("Åtte centimeter høy.") },
        { id: "c", title: "Stell", body: text("Tåler oppvaskmaskin.") },
        { id: "d", title: "", body: text("Uten tittel.") },
      ],
    },
  ]);
  await page.goto(address);
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveCount(3);
  await expect(page.getByRole("tab", { name: "Beskrivelse" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveText("En hvit kopp i steingods.");
  // Every panel is in the page for search engines, the others hidden.
  expect(await page.content()).toContain("Tåler oppvaskmaskin.");
  await expect(page.getByText("Tåler oppvaskmaskin.")).toBeHidden();

  await page.getByRole("tab", { name: "Mål" }).click();
  await expect(page.getByRole("tabpanel")).toHaveText("Åtte centimeter høy.");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Stell" })).toBeFocused();
  await expect(page.getByRole("tabpanel")).toHaveText("Tåler oppvaskmaskin.");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Beskrivelse" })).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Stell" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tab", { name: "Stell" })).toHaveAttribute("tabindex", "0");
  await expect(page.getByRole("tab", { name: "Mål" })).toHaveAttribute("tabindex", "-1");
});

test("FAQs show questions with answers, and tell search engines they are questions and answers", async ({ page }) => {
  const text = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });
  const address = await storePageWith("faq", [
    {
      id: "faq",
      type: "faq",
      items: [
        { id: "a", title: "Hvor lang er leveringstiden?", body: text("To til fire dager.") },
        { id: "b", title: "Kan jeg returnere?", body: text("Ja, i 30 dager.") },
        { id: "c", title: "Uten svar?", body: { type: "doc", content: [{ type: "paragraph" }] } },
      ],
    },
    { id: "quiet", type: "faq", structuredData: false, items: [{ id: "a", title: "Stille spørsmål", body: text("Stille svar.") }] },
  ]);
  await page.goto(address);
  await expect(page.locator("main summary")).toHaveCount(3);
  await expect(page.getByText("Uten svar?")).toHaveCount(0);
  await page.getByText("Kan jeg returnere?").click();
  await expect(page.getByText("Ja, i 30 dager.")).toBeVisible();
  const data = await page.locator('script[type="application/ld+json"]').allTextContents();
  const faqs = data.map((text) => JSON.parse(text)).filter((entry) => entry["@type"] === "FAQPage");
  expect(faqs).toHaveLength(1);
  expect(faqs[0].mainEntity).toEqual([
    { "@type": "Question", name: "Hvor lang er leveringstiden?", acceptedAnswer: { "@type": "Answer", text: "To til fire dager." } },
    { "@type": "Question", name: "Kan jeg returnere?", acceptedAnswer: { "@type": "Answer", text: "Ja, i 30 dager." } },
  ]);
});

test.describe("without script", () => {
  test.use({ javaScriptEnabled: false });

  test("an accordion's sections still open", async ({ page }) => {
    const text = (words: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] });
    const address = await storePageWith("accordion-nojs", [
      { id: "acc", type: "accordion", items: [{ id: "a", title: "Levering", body: text("Vi sender innen to dager.") }] },
    ]);
    await page.goto(address);
    await expect(page.getByText("Vi sender innen to dager.")).toBeHidden();
    await page.locator("main summary").click();
    await expect(page.getByText("Vi sender innen to dager.")).toBeVisible();
  });
});

test("a YouTube video loads nothing from YouTube until the visitor presses play", async ({ page }) => {
  const address = await storePageWith("video", [
    { id: "yt", type: "video", source: "youtube", video: null, link: "https://youtu.be/dQw4w9WgXcQ", poster: null, title: "Slik lager vi koppene" },
  ]);
  const outside: string[] = [];
  page.on("request", (request) => {
    if (/youtube|ytimg|googlevideo/.test(new URL(request.url()).hostname)) outside.push(request.url());
  });
  // The player itself is not needed here, only its address.
  await page.route(/youtube-nocookie\.com/, (route) => route.fulfill({ body: "<html></html>", contentType: "text/html" }));
  await page.goto(address);
  const play = page.getByRole("button", { name: "Slik lager vi koppene (Spilles av fra YouTube)" });
  await expect(play).toBeVisible();
  await expect(page.locator("main iframe")).toHaveCount(0);
  expect(outside).toEqual([]);
  await play.click();
  await expect(page.locator("main iframe")).toHaveAttribute("src", /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1/);
  await expect(page.locator("main iframe")).toHaveAttribute("title", "Slik lager vi koppene");
});

test("HTML runs its scripts in a frame of its own, sealed from the site, and the frame fits its content", async ({ page }) => {
  const html = [
    '<div style="height: 600px">Påmelding til nyhetsbrev</div>',
    '<p id="out">waiting</p>',
    "<script>",
    "let reached = [];",
    "try { document.cookie; reached.push('cookies'); } catch {}",
    "try { localStorage.length; reached.push('storage'); } catch {}",
    "try { parent.document.title; reached.push('page'); } catch {}",
    "document.getElementById('out').textContent = reached.length ? 'reached ' + reached.join(', ') : 'sealed';",
    "</script>",
  ].join("\n");
  const address = await storePageWith("html", [
    { id: "code", type: "html", html, title: "Nyhetsbrev" },
    { id: "later", type: "html", html: "<p>Fra en annen tjeneste</p>", title: "Widget", waitForClick: true },
  ]);
  await page.goto(address);
  const frame = page.frameLocator('main iframe[title="Nyhetsbrev"]');
  await expect(frame.locator("#out")).toHaveText("sealed");
  await expect(frame.getByText("Påmelding til nyhetsbrev")).toBeVisible();
  // It grows to its content: the 600-pixel box and the line under it.
  await expect.poll(async () => (await page.locator('main iframe[title="Nyhetsbrev"]').boundingBox())?.height ?? 0).toBeGreaterThan(600);
  // Content set to wait loads only when asked for.
  await expect(page.locator('main iframe[title="Widget"]')).toHaveCount(0);
  // The store's header slides away as the page scrolls down to the button, so a first click can miss it.
  await expect(async () => {
    await page.getByRole("button", { name: "Vis innholdet" }).click({ timeout: 1000 });
    await expect(page.locator('main iframe[title="Widget"]')).toHaveCount(1, { timeout: 1000 });
  }).toPass();
  await expect(page.frameLocator('main iframe[title="Widget"]').getByText("Fra en annen tjeneste")).toBeVisible();
});

test("testimonials show what customers said, who said it and their stars", async ({ page }) => {
  const address = await storePageWith("testimonials", [
    {
      id: "said",
      type: "testimonials",
      items: [
        { id: "a", quote: "Den beste koppen jeg har hatt.", name: "Kari", role: "Kunde i Bergen", rating: 4, picture: null },
        { id: "b", quote: "Rask levering.", name: "Ola", role: "", picture: null },
        { id: "c", quote: "", name: "Uten ord", role: "", picture: null },
      ],
    },
  ]);
  await page.goto(address);
  await expect(page.locator("main figure blockquote")).toHaveCount(2);
  await expect(page.getByText("Uten ord")).toHaveCount(0);
  const kari = page.locator("main figure").filter({ hasText: "Kari" });
  await expect(kari.locator("figcaption")).toContainText("Kunde i Bergen");
  await expect(kari.getByRole("img", { name: "4 av 5 stjerner" })).toBeVisible();
  await expect(page.locator("main figure").filter({ hasText: "Ola" }).getByRole("img")).toHaveCount(0);
});

test("Google reviews not set up show nothing, and the page around them still shows", async ({ page }) => {
  const address = await storePageWith("google-reviews", [
    { id: "g", type: "testimonials", source: "google", items: [] },
    { id: "h", type: "heading", text: "Etter anmeldelsene", level: 2 },
  ]);
  await page.goto(address);
  await expect(page.getByRole("heading", { name: "Etter anmeldelsene" })).toBeVisible();
  await expect(page.locator("main figure")).toHaveCount(0);
});

test("a content grid as a carousel scrolls a screenful at a time with its arrows, which are off at either end", async ({ page }) => {
  const address = await storePageWith("carousel", [
    {
      id: "grid",
      type: "contentGrid",
      source: { type: "products" },
      categories: [],
      tags: [],
      sort: "newest",
      limit: 12,
      columns: { mobile: 1, tablet: 2, desktop: 2 },
      show: { image: false, heading: true, excerpt: false, price: false, button: false },
      buttonLabel: "",
      emptyText: "",
      headingLevel: 3,
      excerptLines: 3,
      gap: 24,
      display: "carousel",
      peek: true,
    },
  ]);
  await page.goto(address);
  const track = page.locator("main [data-carousel-track]");
  await expect(track.locator("li").first()).toBeVisible();
  expect(await track.locator("li").count()).toBeGreaterThan(2);
  const previous = page.getByRole("button", { name: "Forrige" });
  const next = page.getByRole("button", { name: "Neste" });
  await expect(previous).toBeDisabled();
  await next.click();
  await expect.poll(() => track.evaluate((element) => element.scrollLeft)).toBeGreaterThan(100);
  await expect(previous).toBeEnabled();
  // Two tiles to a screen, and a quarter of the next.
  const [first, row] = await Promise.all([track.locator("li").first().boundingBox(), track.boundingBox()]);
  expect(first!.width).toBeLessThan(row!.width / 2);
  expect(first!.width).toBeGreaterThan(row!.width / 3);
});

test("social media buttons link to the profiles, each named for screen readers, opening in a new tab", async ({ page }) => {
  const address = await storePageWith("social", [
    {
      id: "social",
      type: "socialLinks",
      links: [
        { id: "a", network: "instagram", href: "instagram.com/kaizen" },
        { id: "b", network: "linkedin", href: "https://www.linkedin.com/company/kaizen" },
        { id: "c", network: "email", href: "post@example.com" },
        { id: "d", network: "facebook", href: "" },
      ],
      look: "filled",
    },
  ]);
  await page.goto(address);
  const instagram = page.getByRole("link", { name: "Instagram" });
  await expect(instagram).toHaveAttribute("href", "https://instagram.com/kaizen");
  await expect(instagram).toHaveAttribute("target", "_blank");
  await expect(instagram).toHaveAttribute("rel", "me noopener noreferrer");
  await expect(page.getByRole("link", { name: "LinkedIn" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Email" })).toHaveAttribute("href", "mailto:post@example.com");
  await expect(page.getByRole("link", { name: "Email" })).not.toHaveAttribute("target", "_blank");
  await expect(page.getByRole("link", { name: "Facebook" })).toHaveCount(0);
});

test("an icon list shows its lines after their icons, a line with an address as a link", async ({ page }) => {
  const address = await storePageWith("icon-list", [
    {
      id: "icons",
      type: "iconList",
      items: [
        { id: "a", icon: "truck", text: "Fri frakt over 500 kr", href: "/levering" },
        { id: "b", icon: "rotateCcw", text: "30 dagers retur", href: "" },
        { id: "c", icon: "check", text: "", href: "" },
      ],
    },
  ]);
  await page.goto(address);
  const lines = page.locator("main li").filter({ has: page.locator("svg") });
  await expect(lines).toHaveCount(2);
  await expect(page.getByRole("link", { name: "Fri frakt over 500 kr" })).toHaveAttribute("href", "/levering");
  await expect(page.getByText("30 dagers retur")).toBeVisible();
  await expect(lines.first().locator("svg")).toHaveAttribute("aria-hidden", "true");
});
