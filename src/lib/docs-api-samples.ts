import { ID_HEADER, SIGNATURE_HEADER, TIMESTAMP_HEADER, TOLERANCE_SECONDS } from "./webhook-signature";

/**
 * The code the docs' generated reference shows (wave 14 unit E4, D442): an example request in curl, JavaScript and Python made from an
 * operation's real method, address and an example body its own zod takes (`exampleFor()`), and the webhook signature check in JavaScript,
 * Python and PHP, the same steps as `verifyWebhook()`. Each is tested by running it: the requests against a local server, the checks against a
 * signature `signWebhook()` made (`docs-api-reference.test.ts`). Pure.
 */

/** Where a sample reads its token from: an environment variable, never a token written into code. */
export const TOKEN_ENV = { admin: "KAIZENA_TOKEN", storefront: "KAIZENA_STOREFRONT_TOKEN" } as const;
/** Where a sample reads an endpoint's signing secret from. */
export const SECRET_ENV = "KAIZENA_WEBHOOK_SECRET";

/** One example call: its method, its full address (path parameters filled in, its query), the header its token goes in, and its body. */
export type ApiCall = {
  method: string;
  url: string;
  /** `Authorization` (`Bearer` and the token) or the storefront's own header (the token alone). */
  auth: { header: string; bearer: boolean; env: string };
  body?: unknown;
};

const shellSingle = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** The call with curl, in a POSIX shell: the token from the environment, the body as JSON. */
export function curlSample(call: ApiCall): string {
  const auth = call.auth.bearer ? `"${call.auth.header}: Bearer $${call.auth.env}"` : `"${call.auth.header}: $${call.auth.env}"`;
  const parts = [`curl${call.method === "GET" ? "" : ` -X ${call.method}`} ${shellSingle(call.url)}`, `-H ${auth}`];
  if (call.body !== undefined) parts.push(`-H "Content-Type: application/json"`, `-d ${shellSingle(JSON.stringify(call.body))}`);
  return parts.join(" \\\n  ");
}

const indent = (text: string, by: string) => text.replace(/\n/g, `\n${by}`);

/** The call with `fetch` (a browser, Node.js 18 and later, Deno, Bun), in a module where `await` may stand at the top. */
export function javascriptSample(call: ApiCall): string {
  const auth = call.auth.bearer
    ? `${/^[A-Za-z_$][\w$]*$/.test(call.auth.header) ? call.auth.header : JSON.stringify(call.auth.header)}: \`Bearer \${process.env.${call.auth.env}}\``
    : `${JSON.stringify(call.auth.header)}: process.env.${call.auth.env}`;
  const lines = [`const response = await fetch(${JSON.stringify(call.url)}, {`];
  if (call.method !== "GET") lines.push(`  method: ${JSON.stringify(call.method)},`);
  lines.push("  headers: {", `    ${auth},`);
  if (call.body !== undefined) lines.push(`    "Content-Type": "application/json",`);
  lines.push("  },");
  if (call.body !== undefined) lines.push(`  body: JSON.stringify(${indent(JSON.stringify(call.body, null, 2), "  ")}),`);
  lines.push("});", "const answer = await response.json();");
  return lines.join("\n");
}

/** A JSON value as a Python literal (`True`, `False`, `None`), indented by four. */
export function pythonLiteral(value: unknown, level = 0): string {
  const pad = "    ".repeat(level + 1);
  const end = "    ".repeat(level);
  if (value === null || value === undefined) return "None";
  if (value === true) return "True";
  if (value === false) return "False";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "None";
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => `${pad}${pythonLiteral(item, level + 1)},`).join("\n")}\n${end}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return `{\n${entries.map(([key, item]) => `${pad}${JSON.stringify(key)}: ${pythonLiteral(item, level + 1)},`).join("\n")}\n${end}}`;
}

/** The call in Python with the standard library alone (`urllib.request`), so it runs without installing anything. */
export function pythonSample(call: ApiCall): string {
  const auth = call.auth.bearer ? `"Bearer " + os.environ[${JSON.stringify(call.auth.env)}]` : `os.environ[${JSON.stringify(call.auth.env)}]`;
  const lines = ["import json", "import os", "import urllib.request", "", "request = urllib.request.Request(", `    ${JSON.stringify(call.url)},`];
  if (call.method !== "GET") lines.push(`    method=${JSON.stringify(call.method)},`);
  lines.push("    headers={", `        ${JSON.stringify(call.auth.header)}: ${auth},`);
  if (call.body !== undefined) lines.push(`        "Content-Type": "application/json",`);
  lines.push("    },");
  if (call.body !== undefined) lines.push(`    data=json.dumps(${indent(pythonLiteral(call.body, 1), "")}).encode(),`);
  lines.push(")", "with urllib.request.urlopen(request) as response:", "    answer = json.load(response)");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------------------------------------------------
// Checking a webhook's signature
// ---------------------------------------------------------------------------------------------------------------------

/** A header as PHP reads it from `$_SERVER`: `Kaizena-Webhook-Signature` is `HTTP_KAIZENA_WEBHOOK_SIGNATURE`. */
const phpServerKey = (header: string) => `HTTP_${header.toUpperCase().replace(/-/g, "_")}`;

/** The check in JavaScript (Node.js): an ES module exporting `verifyKaizenaWebhook()`. */
export function javascriptSignatureCheck(): string {
  return [
    `import { createHmac, timingSafeEqual } from "node:crypto";`,
    ``,
    `// Whether a delivery came from Kaizena Flow. \`body\` is the raw body as it arrived (a string or a Buffer, before any`,
    `// JSON parsing), \`timestamp\` and \`signatures\` the ${TIMESTAMP_HEADER} and ${SIGNATURE_HEADER} headers, \`secret\` the endpoint's.`,
    `export function verifyKaizenaWebhook(body, timestamp, signatures, secret) {`,
    `  const stamp = Number(timestamp);`,
    `  if (!timestamp || !Number.isInteger(stamp) || Math.abs(Date.now() / 1000 - stamp) > ${TOLERANCE_SECONDS}) return false;`,
    `  const digest = createHmac("sha256", secret).update(\`\${stamp}.\`).update(body).digest("hex");`,
    `  const expected = Buffer.from(\`v1=\${digest}\`);`,
    `  return String(signatures ?? "")`,
    `    .split(/[ ,]+/)`,
    `    .some((part) => {`,
    `      const given = Buffer.from(part);`,
    `      return given.length === expected.length && timingSafeEqual(given, expected);`,
    `    });`,
    `}`,
    ``,
    `// With Express, keep the body raw for this route:`,
    `// app.post("/webhooks/kaizena-flow", express.raw({ type: "application/json" }), (req, res) => {`,
    `//   const ok = verifyKaizenaWebhook(req.body, req.get("${TIMESTAMP_HEADER}"), req.get("${SIGNATURE_HEADER}"), process.env.${SECRET_ENV});`,
    `//   if (!ok) return res.sendStatus(400);`,
    `//   const delivery = JSON.parse(req.body); // do the work once per delivery.id (${ID_HEADER})`,
    `//   res.sendStatus(200);`,
    `// });`,
  ].join("\n");
}

/** The check in Python 3.10 and later, with the standard library alone. */
export function pythonSignatureCheck(): string {
  return [
    `import hashlib`,
    `import hmac`,
    `import re`,
    `import time`,
    ``,
    ``,
    `def verify_kaizena_webhook(body: bytes, timestamp: str | None, signatures: str | None, secret: str) -> bool:`,
    `    """Whether a delivery came from Kaizena Flow.`,
    ``,
    `    body is the raw body as it arrived (bytes, before any JSON parsing); timestamp and signatures are the`,
    `    ${TIMESTAMP_HEADER} and ${SIGNATURE_HEADER} headers; secret is the endpoint's.`,
    `    """`,
    `    if not timestamp or not re.fullmatch(r"[0-9]+", timestamp):`,
    `        return False`,
    `    stamp = int(timestamp)`,
    `    if abs(time.time() - stamp) > ${TOLERANCE_SECONDS}:`,
    `        return False`,
    `    digest = hmac.new(secret.encode(), f"{stamp}.".encode() + body, hashlib.sha256).hexdigest()`,
    `    expected = f"v1={digest}"`,
    `    return any(hmac.compare_digest(part, expected) for part in re.split(r"[ ,]+", signatures or "") if part)`,
    ``,
    ``,
    `# With Flask:`,
    `# ok = verify_kaizena_webhook(request.get_data(), request.headers.get("${TIMESTAMP_HEADER}"),`,
    `#                             request.headers.get("${SIGNATURE_HEADER}"), os.environ["${SECRET_ENV}"])`,
  ].join("\n");
}

/** The check in PHP 8. */
export function phpSignatureCheck(): string {
  return [
    `<?php`,
    ``,
    `// Whether a delivery came from Kaizena Flow. $body is the raw body as it arrived (before any JSON parsing),`,
    `// $timestamp and $signatures the ${TIMESTAMP_HEADER} and ${SIGNATURE_HEADER} headers, $secret the endpoint's.`,
    `function verify_kaizena_webhook(string $body, ?string $timestamp, ?string $signatures, string $secret): bool`,
    `{`,
    `    if ($timestamp === null || !preg_match('/^[0-9]+$/', $timestamp)) {`,
    `        return false;`,
    `    }`,
    `    $stamp = (int) $timestamp;`,
    `    if (abs(time() - $stamp) > ${TOLERANCE_SECONDS}) {`,
    `        return false;`,
    `    }`,
    `    $expected = 'v1=' . hash_hmac('sha256', $stamp . '.' . $body, $secret);`,
    `    foreach (preg_split('/[ ,]+/', $signatures ?? '', -1, PREG_SPLIT_NO_EMPTY) as $part) {`,
    `        if (hash_equals($expected, $part)) {`,
    `            return true;`,
    `        }`,
    `    }`,
    `    return false;`,
    `}`,
    ``,
    `// $ok = verify_kaizena_webhook(`,
    `//     file_get_contents('php://input'),`,
    `//     $_SERVER['${phpServerKey(TIMESTAMP_HEADER)}'] ?? null,`,
    `//     $_SERVER['${phpServerKey(SIGNATURE_HEADER)}'] ?? null,`,
    `//     getenv('${SECRET_ENV}'),`,
    `// );`,
  ].join("\n");
}
