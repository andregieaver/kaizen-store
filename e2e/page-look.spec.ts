import { expect, test } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import sharp from "sharp";

import { shootPage } from "../src/lib/page-look-shoot";

/**
 * The page looks' photographer (D310, `docs/ai-autopilot.md` 9.2) in a real browser, against a small site served here: a page wider than a
 * phone scrolls sideways, a picture that does not load is counted, a button below the header in the first screen is found, and the
 * photograph is the page at the width asked for.
 */

const PAGES: Record<string, string> = {
  "/good": `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font:16px sans-serif">
    <header style="height:60px;background:#eee"><a href="/">Home</a></header>
    <main style="padding:20px"><h1>Lunch for your team</h1><p>We cook lunch for ten to two hundred people.</p><a href="/order" style="display:inline-block;padding:12px">Order lunch</a>
    <div style="height:1800px"></div><p>The end.</p></main></body></html>`,
  "/bad": `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;font:16px sans-serif">
    <header style="height:60px;background:#eee"><a href="/">Home</a></header>
    <main><div style="width:900px;height:200px;background:#cde">A banner wider than a phone</div><img src="/missing.png" alt="A kitchen" width="200" height="100">
    <div style="height:2000px"></div><a href="/order">Order lunch, far below</a></main></body></html>`,
};

let server: http.Server;
let origin = "";

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const body = PAGES[request.url ?? ""];
    if (!body) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html" }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test("a good page is measured as fine, at each width's own size", async ({ browser }) => {
  const phone = await shootPage(browser, `${origin}/good`, "phone");
  expect(phone.facts).toMatchObject({ sideways: false, brokenPictures: 0, actionInFirstScreen: true });
  expect(phone.facts.words).toBeGreaterThan(10);
  const size = await sharp(phone.picture).metadata();
  expect(size.width).toBe(390);
  expect(size.height).toBeGreaterThan(1800);

  const computer = await shootPage(browser, `${origin}/good`, "computer");
  expect((await sharp(computer.picture).metadata()).width).toBe(1280);
});

test("a bad page scrolls sideways on a phone, has a broken picture and no button in its first screen", async ({ browser }) => {
  const phone = await shootPage(browser, `${origin}/bad`, "phone");
  expect(phone.facts).toMatchObject({ sideways: true, brokenPictures: 1, actionInFirstScreen: false });
  const computer = await shootPage(browser, `${origin}/bad`, "computer");
  expect(computer.facts.sideways).toBe(false);
});

test("a page that answers with an error is not photographed", async ({ browser }) => {
  await expect(shootPage(browser, `${origin}/gone`, "phone")).rejects.toThrow(/The page answered/);
});
