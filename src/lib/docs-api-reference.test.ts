import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { API_ERRORS, API_SCOPES } from "./admin-api";
import { ADMIN_API, type AdminOperation } from "./admin-api-routes";
import { anchorOf } from "./docs-schema";
import { matchPath } from "./admin-map";
import { adminExample, docsApiReference, referenceItemUrls, storefrontExample, topicExample, type OperationExample } from "./docs-api-reference";
import { curlSample, javascriptSample, javascriptSignatureCheck, phpSignatureCheck, pythonLiteral, pythonSample, pythonSignatureCheck, TOKEN_ENV } from "./docs-api-samples";
import { compileDocs, resolveDocLink, type DocSource } from "./docs-content";
import { parseMarkdown, type DocHref } from "./docs-markdown";
import { docsReferenceItems } from "./docs-reference";
import { docRefPageMarkdown } from "./docs-text";
import { mcpTools } from "./mcp-catalogue";
import { jsonSchemaOf } from "./openapi";
import { looksLikeApiCartKey, isHandle, STOREFRONT_ROUTES } from "./storefront-api";
import { UCP_TOOLS } from "./ucp-catalogue";
import { signWebhook, TOLERANCE_SECONDS } from "./webhook-signature";
import { webhookEnvelope, WEBHOOK_TOPICS } from "./webhook-topics";

const ROOT = process.cwd();
const run = promisify(execFile);

function repositorySources(): DocSource[] {
  const out: DocSource[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(md|json)$/.test(name)) out.push({ file: relative(ROOT, full).split(sep).join("/"), text: readFileSync(full, "utf8") });
    }
  };
  walk(join(ROOT, "content/docs"));
  return out;
}

const LIMITS = { mcp: { window: "minute", visitor: 120, store: 1200 }, agent: { window: "minute", visitor: 60, store: 1200 } };
const { reference, problems } = docsApiReference({ limits: LIMITS });
const { index } = compileDocs(repositorySources(), {}, reference);
const page = (path: string) => {
  const found = reference.pages.find((p) => p.path === path);
  if (!found) throw new Error(`No reference page ${path}`);
  return found;
};
const headingIds = (path: string) => page(path).headings.map((h) => h.id);
const BASE = "https://kaizenaflow.com";

/** Whether a program is on this machine (CI's runner has curl, Python and PHP; a sandbox may lack one). */
function has(program: string, args: string[] = ["--version"]): boolean {
  try {
    execFileSync(program, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("the generated reference (D442, E4)", () => {
  it("is made with no problem: every page's Markdown reads, every item has its heading, no address twice", () => {
    expect(problems).toEqual([]);
    expect(new Set(reference.pages.map((p) => p.path)).size).toBe(reference.pages.length);
    expect(reference.version).toMatch(/^\d+\.\d+$/);
    for (const p of reference.pages) {
      expect(p.path.startsWith("reference"), p.path).toBe(true);
      expect(p.title.length, p.path).toBeGreaterThan(0);
      expect(p.summary.length, p.path).toBeGreaterThan(0);
      expect(p.summary.length, p.path).toBeLessThanOrEqual(300);
      expect(p.blocks.length, p.path).toBeGreaterThan(0);
    }
  });

  it("has every Admin API operation on its resource's page, with its heading", () => {
    const tags = [...new Set(ADMIN_API.map((o) => o.tag))];
    for (const tag of tags) expect(page("reference/admin-api").markdown).toContain(`](/docs/reference/admin-api/${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")})`);
    for (const o of ADMIN_API) {
      const path = `reference/admin-api/${o.tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const anchor = o.name.replace(/[^a-z0-9]+/g, "-");
      expect(headingIds(path), o.name).toContain(anchor);
      expect(page(path).markdown, o.name).toContain(`\`${o.method} ${BASE}/api/admin/v1${o.path}\``);
      for (const part of ["answer", "errors", "example"]) expect(headingIds(path), `${o.name} ${part}`).toContain(`${anchor}-${part}`);
      if ("body" in o) expect(headingIds(path), o.name).toContain(`${anchor}-body`);
      if ("params" in o) expect(headingIds(path), o.name).toContain(`${anchor}-path`);
      if ("query" in o) expect(headingIds(path), o.name).toContain(`${anchor}-query`);
    }
  });

  it("has every storefront route, every webhook topic, every MCP tool, every scope and every error code", () => {
    const storefront = reference.pages.filter((p) => p.parent === "reference/storefront-api").map((p) => p.markdown).join("\n");
    for (const route of STOREFRONT_ROUTES) expect(storefront, route.what).toContain(`\`${route.method} ${BASE}/api/storefront/v1/{store}${route.path}\``);
    for (const topic of WEBHOOK_TOPICS) {
      const path = `reference/webhooks/${topic.id.replace(/[^a-z0-9]+/g, "-")}`;
      expect(page(path).title).toBe(topic.id);
      expect(page("reference/webhooks").markdown).toContain(`[\`${topic.id}\`](/docs/${path})`);
    }
    const mcp = reference.pages.filter((p) => p.parent === "reference/mcp");
    for (const tool of mcpTools()) expect(mcp.some((p) => p.headings.some((h) => h.id === tool.name.replace(/_/g, "-"))), tool.name).toBe(true);
    for (const tool of UCP_TOOLS) expect(headingIds("reference/mcp/shopping-agents")).toContain(tool.name.replace(/_/g, "-"));
    for (const scope of API_SCOPES) expect(headingIds("reference/scopes")).toContain(anchorOf(scope));
    for (const code of Object.keys(API_ERRORS)) expect(headingIds("reference/errors")).toContain(code.replace(/_/g, "-"));
    expect(page("reference/rate-limits").markdown).toContain("| 120 a connection, across its stores | 1,200 | a minute |");
  });

  it("leads every item of the docs' search to its heading in the reference", () => {
    const urls = referenceItemUrls(reference);
    for (const item of docsReferenceItems()) {
      const url = urls.get(`${item.item}:${item.id}`);
      expect(url, `${item.item} ${item.id}`).toBeDefined();
      const [path, anchor] = (url ?? "").split("#");
      const target = resolveDocLink(index, path, "en");
      expect(target && typeof target === "object", url).toBe(true);
      if (anchor && target && typeof target === "object") expect(target.headings.map((h) => h.id), url).toContain(anchor);
    }
  });

  it("links only to pages, headings and routes that exist", () => {
    const routes = new Set(readdirSync(join(ROOT, "src/app")).filter((name) => statSync(join(ROOT, "src/app", name)).isDirectory()));
    for (const p of reference.pages) {
      for (const { href } of parseMarkdown(p.markdown).links as { href: DocHref }[]) {
        const where = `${p.path} → ${JSON.stringify(href)}`;
        if (href.kind === "doc") {
          const target = resolveDocLink(index, href.path, "en");
          expect(target, where).not.toBeNull();
          if (href.anchor) {
            const headings = target === "changelog" ? (index.changelog?.headings ?? []) : target && typeof target === "object" ? target.headings : [];
            expect(headings.map((h) => h.id), where).toContain(href.anchor);
          }
        } else if (href.kind === "anchor") {
          expect(p.headings.map((h) => h.id), where).toContain(href.id);
        } else if (href.kind === "admin") {
          expect(matchPath(href.path), where).not.toBeNull();
        } else if (href.kind === "site") {
          expect(routes.has(href.path.split("/")[1]), where).toBe(true);
        }
      }
    }
  });

  it("draws schemas as tables: fields with their type and whether they are required, a union's shapes each a table", () => {
    const products = page("reference/admin-api/products").markdown;
    expect(products).toContain("| `title` | string, 1 to 200 characters | yes | The product's name in the store's main language. |");
    expect(products).toContain("| `stock` | integer, 0 to 1,000,000 | no, default `0` | Units in stock of each variant to start with. |");
    expect(products).toContain("| `data[].variants[].prices[].amount_minor` | integer |");
    const checkout = page("reference/admin-api/checkout").markdown;
    expect(checkout).toContain("**The body, shape 1 of 2**");
    expect(checkout).toContain("**`effect` when `kind` is `hide_shipping`**");
    // A pattern's `|` is escaped in its cell, and reads back as one.
    expect(checkout).toContain("matching `^(flat\\|(method\\|pickup\\|local):[0-9a-f-]{36})$`");
    const table = page("reference/admin-api/checkout").blocks.find((b) => b.type === "table" && JSON.stringify(b).includes("effect.options"));
    expect(JSON.stringify(table)).toContain("^(flat|(method|pickup|local):[0-9a-f-]{36})$");
    // A webhook topic's payload, and an MCP tool's inputs.
    expect(page("reference/webhooks/order-paid").markdown).toContain("| `data.order.total` | number | An amount in the currency's units, such as 199.5 (not minor units). |");
    expect(page("reference/mcp/products").markdown).toContain("| `store` | string | yes | The store, by its slug from list_stores. |");
  });

  it("answers each page as Markdown with full addresses", () => {
    const md = docRefPageMarkdown(page("reference/admin-api/products"), index);
    expect(md.startsWith("# Products\n\n> ")).toBe(true);
    expect(md).toContain("](http://localhost:3000/docs/reference/scopes#products-read)");
    expect(md).toContain(`made from the API contract ${reference.version}`);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The examples: each body one the operation's own zod takes, each sample sent for real
// ---------------------------------------------------------------------------------------------------------------------

const adminCalls = ADMIN_API.map((o) => ({ o, example: adminExample(o, `${BASE}/api/admin/v1`) }));
const storefrontCalls = STOREFRONT_ROUTES.map((route) => ({ route, example: storefrontExample(route, `${BASE}/api/storefront/v1`, "X-Storefront-Token") }));

describe("the examples (E4)", () => {
  it("has an example for every operation whose path, query and body its own zod takes", () => {
    for (const { o, example } of adminCalls) {
      expect(example, o.name).not.toBeNull();
      if (!example) continue;
      if ("params" in o) expect(o.params.safeParse(example.params).success, o.name).toBe(true);
      if ("query" in o) expect(o.query.safeParse(example.query).success, o.name).toBe(true);
      if ("body" in o) {
        const parsed = (o.body as z.ZodType).safeParse(example.body);
        expect(parsed.success ? [] : parsed.error.issues, o.name).toEqual([]);
      } else expect(example.body, o.name).toBeUndefined();
    }
    for (const { route, example } of storefrontCalls) {
      expect(example, route.what).not.toBeNull();
      if (!example) continue;
      if ("body" in route) expect(route.body.safeParse(example.body).success, route.what).toBe(true);
      if ("handle" in example.params) expect(isHandle(String(example.params.handle))).toBe(true);
      if ("cart" in example.params) expect(looksLikeApiCartKey(String(example.params.cart))).toBe(true);
      if ("variantId" in example.params) expect(z.uuid().safeParse(example.params.variantId).success).toBe(true);
    }
  });

  it("puts a body right where its zod asks more than its JSON Schema says (a variant by its id or its SKU, not both)", () => {
    const adjust = adminCalls.find((c) => c.o.name === "inventory.adjust")?.example?.body as { rows: Record<string, unknown>[] };
    expect(Object.keys(adjust.rows[0]).filter((k) => k === "variant_id" || k === "sku")).toHaveLength(1);
    // Two ids of different things are different ids.
    expect(adjust.rows[0].variant_id).not.toBe(adjust.rows[0].location_id);
  });

  it("has an example for every webhook topic that the topic's own envelope takes", () => {
    for (const topic of WEBHOOK_TOPICS) {
      const example = topicExample(topic);
      expect(example, topic.id).not.toBeNull();
      expect(webhookEnvelope(z.literal(topic.id), topic.data).safeParse(example).success, topic.id).toBe(true);
      expect(page(`reference/webhooks/${topic.id.replace(/[^a-z0-9]+/g, "-")}`).markdown).toContain(JSON.stringify(example, null, 2));
    }
  });

  it("writes Python literals", () => {
    expect(pythonLiteral({ a: true, b: null, c: [1, "x"], d: {} })).toBe('{\n    "a": True,\n    "b": None,\n    "c": [\n        1,\n        "x",\n    ],\n    "d": {},\n}');
  });

  it("shows each sample on its operation's page as it is tested", () => {
    for (const { o, example } of adminCalls) {
      if (!example) continue;
      const markdown = page(`reference/admin-api/${o.tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`).markdown;
      for (const sample of [curlSample(example.call), javascriptSample(example.call), pythonSample(example.call)]) expect(markdown, o.name).toContain(sample);
    }
  });
});

type Received = { method: string; url: string; headers: IncomingMessage["headers"]; body: string };

describe("the example requests, sent to a server (E4)", () => {
  let server: Server;
  let origin = "";
  const received: Received[] = [];
  const childEnv = (token: Record<string, string>): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...token, NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" };
    for (const key of ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY"]) delete env[key];
    return env;
  };
  const dir = mkdtempSync(join(tmpdir(), "kf-docs-samples-"));

  beforeAll(async () => {
    server = createServer((request, response) => {
      let body = "";
      request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
      request.on("end", () => {
        received.push({ method: request.method ?? "", url: request.url ?? "", headers: request.headers, body });
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
  });

  const local = (code: string) => code.split(BASE).join(origin);

  /** The one request a sample sent, checked against its example: method, address, token, content type and body. */
  function expectSent(before: number, example: OperationExample, token: string, admin: boolean, body: z.ZodType | null, label: string) {
    expect(received.length - before, label).toBe(1);
    const got = received[received.length - 1];
    expect(got.method, label).toBe(example.call.method);
    expect(`${origin}${got.url}`, label).toBe(local(example.call.url));
    if (admin) expect(got.headers.authorization, label).toBe(`Bearer ${token}`);
    else expect(got.headers["x-storefront-token"], label).toBe(token);
    if (example.call.body === undefined) {
      expect(got.body, label).toBe("");
      return;
    }
    expect(got.headers["content-type"], label).toBe("application/json");
    const sent: unknown = JSON.parse(got.body);
    expect(sent, label).toEqual(example.call.body);
    if (body) expect(body.safeParse(sent).success, label).toBe(true);
  }

  const cases = () => [
    ...adminCalls.flatMap(({ o, example }) => (example ? [{ label: o.name, example, admin: true, body: "body" in o ? ((o as AdminOperation & { body: z.ZodType }).body as z.ZodType) : null }] : [])),
    ...storefrontCalls.flatMap(({ route, example }) => (example ? [{ label: route.what, example, admin: false, body: "body" in route ? (route.body as z.ZodType) : null }] : [])),
  ];

  it.skipIf(!has("curl"))("curl sends each request as its operation describes it", async () => {
    for (const c of cases()) {
      const token = c.admin ? "kf_test_curl" : "kfs_test_curl";
      const before = received.length;
      await run("sh", ["-c", local(curlSample(c.example.call))], { env: childEnv({ [c.admin ? TOKEN_ENV.admin : TOKEN_ENV.storefront]: token }) });
      expectSent(before, c.example, token, c.admin, c.body, `curl ${c.label}`);
    }
  });

  it("JavaScript's fetch sends each request as its operation describes it", async () => {
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<void>;
    for (const c of cases()) {
      const token = c.admin ? "kf_test_js" : "kfs_test_js";
      const before = received.length;
      await new AsyncFunction("process", local(javascriptSample(c.example.call)))({ env: { [c.admin ? TOKEN_ENV.admin : TOKEN_ENV.storefront]: token } });
      expectSent(before, c.example, token, c.admin, c.body, `javascript ${c.label}`);
    }
  });

  it.skipIf(!has("python3"))("Python's urllib sends each request as its operation describes it", async () => {
    for (const [i, c] of cases().entries()) {
      const token = c.admin ? "kf_test_py" : "kfs_test_py";
      const file = join(dir, `request_${i}.py`);
      writeFileSync(file, local(pythonSample(c.example.call)));
      const before = received.length;
      await run("python3", ["-I", file], { env: childEnv({ [c.admin ? TOKEN_ENV.admin : TOKEN_ENV.storefront]: token }) });
      expectSent(before, c.example, token, c.admin, c.body, `python ${c.label}`);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The signature checks, run against signatures `signWebhook()` makes
// ---------------------------------------------------------------------------------------------------------------------

describe("the webhook signature checks (E4)", () => {
  const dir = mkdtempSync(join(tmpdir(), "kf-docs-signature-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const secret = "whsec_dGVzdC1zZWNyZXQtZm9yLXRoZS1kb2NzLXNhbXBsZXM";
  const body = JSON.stringify(topicExample(WEBHOOK_TOPICS[0]));
  const now = () => Math.floor(Date.now() / 1000);
  /** What each check must say: a fresh signature yes; a changed body, another secret or an old timestamp no; one of several signatures yes. */
  const cases = () => {
    const stamp = now();
    const good = signWebhook(secret, stamp, body);
    const old = now() - TOLERANCE_SECONDS - 60;
    return [
      { name: "fresh", body, timestamp: String(stamp), signature: good, expected: true },
      { name: "several, the second ours", body, timestamp: String(stamp), signature: `${signWebhook("whsec_old", stamp, body)}, ${good}`, expected: true },
      { name: "changed body", body: body.replace(/1/, "2"), timestamp: String(stamp), signature: good, expected: false },
      { name: "another secret", body, timestamp: String(stamp), signature: signWebhook("whsec_other", stamp, body), expected: false },
      { name: "too old", body, timestamp: String(old), signature: signWebhook(secret, old, body), expected: false },
      { name: "no timestamp", body, timestamp: "", signature: good, expected: false },
      { name: "no signature", body, timestamp: String(stamp), signature: "", expected: false },
    ];
  };
  const env = (c: ReturnType<typeof cases>[number]): NodeJS.ProcessEnv => ({ ...process.env, CHECK_SECRET: secret, CHECK_BODY: c.body, CHECK_TIMESTAMP: c.timestamp, CHECK_SIGNATURE: c.signature });

  it("are the ones the webhooks page shows", () => {
    const markdown = page("reference/webhooks").markdown;
    for (const check of [javascriptSignatureCheck(), pythonSignatureCheck(), phpSignatureCheck()]) expect(markdown).toContain(check);
    // The signature to try a check on is one `signWebhook()` made.
    const tried = /Kaizena-Webhook-Timestamp: (\d+)\nKaizena-Webhook-Signature: (v1=[0-9a-f]{64})\n\n(.+)\n```/.exec(markdown);
    const shown = /signed with the secret `(whsec_[^`]+)`/.exec(markdown);
    expect(tried && shown).toBeTruthy();
    if (tried && shown) expect(signWebhook(shown[1], Number(tried[1]), tried[3])).toBe(tried[2]);
  });

  it("JavaScript's verifies a real signature and refuses the rest", async () => {
    writeFileSync(join(dir, "verify.mjs"), javascriptSignatureCheck());
    writeFileSync(
      join(dir, "check.mjs"),
      `import { verifyKaizenaWebhook } from "./verify.mjs";\nconst e = process.env;\nprocess.stdout.write(String(verifyKaizenaWebhook(Buffer.from(e.CHECK_BODY, "utf8"), e.CHECK_TIMESTAMP, e.CHECK_SIGNATURE, e.CHECK_SECRET)));\n`,
    );
    for (const c of cases()) {
      const { stdout } = await run(process.execPath, [join(dir, "check.mjs")], { env: env(c) });
      expect(stdout, c.name).toBe(String(c.expected));
    }
  });

  it.skipIf(!has("python3"))("Python's verifies a real signature and refuses the rest", async () => {
    writeFileSync(join(dir, "verify.py"), pythonSignatureCheck());
    writeFileSync(
      join(dir, "check.py"),
      `import os\nnamespace = {}\nexec(compile(open(${JSON.stringify(join(dir, "verify.py"))}).read(), "verify.py", "exec"), namespace)\ne = os.environ\nprint(str(namespace["verify_kaizena_webhook"](e["CHECK_BODY"].encode(), e["CHECK_TIMESTAMP"], e["CHECK_SIGNATURE"], e["CHECK_SECRET"])).lower(), end="")\n`,
    );
    for (const c of cases()) {
      const { stdout } = await run("python3", ["-I", join(dir, "check.py")], { env: env(c) });
      expect(stdout, c.name).toBe(String(c.expected));
    }
  });

  it.skipIf(!has("php", ["-v"]))("PHP's verifies a real signature and refuses the rest", async () => {
    writeFileSync(join(dir, "verify.php"), phpSignatureCheck());
    writeFileSync(
      join(dir, "check.php"),
      `<?php\nrequire ${JSON.stringify(join(dir, "verify.php"))};\n$ok = verify_kaizena_webhook(getenv('CHECK_BODY'), getenv('CHECK_TIMESTAMP') === '' ? null : getenv('CHECK_TIMESTAMP'), getenv('CHECK_SIGNATURE'), getenv('CHECK_SECRET'));\necho $ok ? 'true' : 'false';\n`,
    );
    for (const c of cases()) {
      const { stdout } = await run("php", ["-n", join(dir, "check.php")], { env: env(c) });
      expect(stdout, c.name).toBe(String(c.expected));
    }
  });
});

describe("JSON Schema for the reference (E4)", () => {
  it("makes a new operation's example from its zod alone, unions and refinements too", async () => {
    const { exampleFor, schemaMarkdown, schemaTable } = await import("./docs-schema");
    const body = z.union([
      z.strictObject({ enabled: z.boolean() }),
      z.object({
        name: z.string().min(1),
        rows: z
          .array(z.object({ a: z.string().optional(), b: z.int().optional(), at: z.iso.datetime({ offset: true }) }).refine((r) => (r.a === undefined) !== (r.b === undefined)))
          .min(1),
        currency: z.string().regex(/^[A-Z]{3}$/),
      }),
    ]);
    const example = exampleFor(body, jsonSchemaOf(body));
    expect(example && body.safeParse(example.value).success).toBe(true);
    const second = body.options[1];
    const made = exampleFor(second, jsonSchemaOf(second));
    expect(made?.value).toMatchObject({ name: "Example", currency: "NOK", rows: [{ a: "example", at: "2026-11-03T09:30:00Z" }] });
    expect(second.safeParse(made?.value).success).toBe(true);
    const markdown = schemaMarkdown(schemaTable(jsonSchemaOf(body)), true);
    expect(markdown).toContain("**The body, shape 2 of 2**");
    expect(markdown).toContain("| `rows[].at` | string (date-time) | yes |   |");
  });
});
