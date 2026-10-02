// @vitest-environment node
import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { hostProblem, safeFetch } from "./replicate-fetch";

let server: http.Server;
let base = "";

beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === "/ok") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end("<h1>Hello</h1>");
    } else if (request.url === "/big") {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      response.end(Buffer.alloc(5000));
    } else if (request.url === "/stream") {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      const send = () => response.write(Buffer.alloc(1000));
      send();
      send();
      send();
      send();
      send();
      response.end();
    } else if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/ok" });
      response.end();
    } else if (request.url === "/loop") {
      response.writeHead(302, { Location: "/loop" });
      response.end();
    } else if (request.url === "/to-metadata") {
      response.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" });
      response.end();
    } else if (request.url === "/slow") {
      // Never answers.
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  vi.unstubAllEnvs();
});

describe("fetching from other websites", () => {
  it("refuses a local address unless tests allow it", async () => {
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "");
    const refused = await safeFetch(`${base}/ok`, { maxBytes: 1000 });
    expect(refused).toMatchObject({ ok: false });
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "1");
    const allowed = await safeFetch(`${base}/ok`, { maxBytes: 1000 });
    expect(allowed.ok && new TextDecoder().decode(allowed.bytes)).toBe("<h1>Hello</h1>");
    expect(allowed.ok && allowed.contentType).toBe("text/html");
  });

  it("never allows a local address on Vercel, whatever is set", async () => {
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "1");
    vi.stubEnv("VERCEL", "1");
    expect(await safeFetch(`${base}/ok`, { maxBytes: 1000 })).toMatchObject({ ok: false });
    vi.stubEnv("VERCEL", "");
  });

  it("checks a name's addresses, and the address the connection uses", async () => {
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "");
    expect(await hostProblem("example.com", async () => ["93.184.216.34"])).toBeNull();
    expect(await hostProblem("rebind.example.com", async () => ["93.184.216.34", "10.0.0.7"])).toMatch(/private network/);
    expect(await hostProblem("gone.example.com", async () => [])).toMatch(/could not be found/);
    expect(await hostProblem("gone.example.com", async () => Promise.reject(new Error("ENOTFOUND")))).toMatch(/could not be found/);
    expect(await hostProblem("169.254.169.254")).toMatch(/private network/);
    expect(await hostProblem("8.8.8.8")).toBeNull();
  });

  it("follows redirects, each checked, and stops at loops and at private places", async () => {
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "1");
    const followed = await safeFetch(`${base}/redirect`, { maxBytes: 1000 });
    expect(followed.ok && followed.url).toBe(`${base}/ok`);
    expect(await safeFetch(`${base}/loop`, { maxBytes: 1000, maxRedirects: 3 })).toMatchObject({ ok: false, problem: "The site redirected too many times." });
    // The metadata service is refused even when local pages are allowed for tests? No: allowed is allowed. Without it:
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "");
    expect(await safeFetch("http://169.254.169.254/latest/meta-data/", { maxBytes: 1000 })).toMatchObject({ ok: false });
    expect(await safeFetch("http://localhost/", { maxBytes: 1000 })).toMatchObject({ ok: false });
    expect(await safeFetch("file:///etc/passwd", { maxBytes: 1000 })).toMatchObject({ ok: false });
  });

  it("keeps to the size it is given, whether or not the site says how large", async () => {
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "1");
    expect(await safeFetch(`${base}/big`, { maxBytes: 1000 })).toMatchObject({ ok: false, problem: "The file is larger than can be copied." });
    expect(await safeFetch(`${base}/stream`, { maxBytes: 2500 })).toMatchObject({ ok: false, problem: "The file is larger than can be copied." });
    const fits = await safeFetch(`${base}/big`, { maxBytes: 6000 });
    expect(fits.ok && fits.bytes.length).toBe(5000);
  });

  it("says in words what went wrong, without throwing", async () => {
    vi.stubEnv("REPLICATE_ALLOW_PRIVATE", "1");
    expect(await safeFetch(`${base}/missing`, { maxBytes: 1000 })).toMatchObject({ ok: false, problem: "The site answered 404.", status: 404 });
    expect(await safeFetch(`${base}/slow`, { maxBytes: 1000, timeoutMs: 300 })).toMatchObject({ ok: false, problem: "The site took too long to answer." });
    expect(await safeFetch("http://127.0.0.1:1/", { maxBytes: 1000 })).toMatchObject({ ok: false, problem: "The site could not be reached." });
  });
});
