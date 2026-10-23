import type { DnsChange } from "./dns-plan";
import type { DnsRecord } from "./dns-records";

/**
 * Ready-made DNS changes for what owners actually need (D315, `docs/domains.md` 5.2). Each recipe is data: the records it makes, the values
 * the owner brings from their provider (named, with where to find them), and the provider's own page it was read from, with the date. A
 * value is fixed here only where the provider's page states it for everyone (`verified`); a value the provider shows per account (Microsoft's
 * MX host, Zoho's, Proton's, Fastmail's) is always the owner's to paste. A recipe is a change set like any other: `planDns()`, the owner's yes
 * (or automatic), and Undo.
 */

export type RecipeId = "google_workspace" | "microsoft_365" | "verification" | "dmarc" | "provider_records";

export type RecipeInput = {
  key: string;
  /** Whether the recipe can't be made without it. */
  required: boolean;
  /** What it looks like, for checking what was pasted. */
  pattern?: RegExp;
};

export type Recipe = {
  id: RecipeId;
  kind: "email" | "verify" | "trust";
  inputs: readonly RecipeInput[];
  /** The provider's own page, read on `read`; null where the owner brings every value. */
  source: { url: string; read: string } | null;
  /** Builds the changes from the owner's values and the zone as it is (its MX records are replaced by a new provider's). */
  build(values: Record<string, string>, current: readonly DnsRecord[]): DnsChange[] | { problem: string };
};

const add = (record: DnsChange["record"]): DnsChange => ({ op: "add", record });
const removeAllMx = (current: readonly DnsRecord[]): DnsChange[] => current.filter((r) => r.type === "MX" && r.name === "").map((r) => ({ op: "remove", record: r }));

/** Lines a provider shows (`MX @ mx.example.com 10`, `TXT _dmarc "v=DMARC1; p=none"`, `CNAME selector._domainkey target`) as records. */
export function parseRecordLines(text: string): { records: DnsChange["record"][]; problems: string[] } {
  const records: DnsChange["record"][] = [];
  const problems: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const m = /^(A|AAAA|ALIAS|CNAME|MX|TXT|SRV|CAA)\s+(\S+)\s+(.+)$/i.exec(line);
    if (!m) {
      problems.push(`"${line.slice(0, 60)}" isn't a record: write the type, the name and the value, like MX @ mx.example.com 10.`);
      continue;
    }
    const type = m[1].toUpperCase() as DnsChange["record"]["type"];
    const name = m[2] === "@" ? "" : m[2];
    let rest = m[3].trim();
    if (type === "MX") {
      const parts = rest.split(/\s+/);
      const priorityFirst = /^\d+$/.test(parts[0]);
      const priority = Number(priorityFirst ? parts[0] : parts[1]);
      const host = priorityFirst ? parts[1] : parts[0];
      if (!host || !Number.isInteger(priority)) {
        problems.push(`"${line.slice(0, 60)}" needs a mail server and a priority.`);
        continue;
      }
      records.push({ type, name, value: host, mxPriority: priority });
      continue;
    }
    if (type === "SRV") {
      const [priority, weight, port, target] = rest.split(/\s+/);
      records.push({ type, name, value: "", srv: { priority: Number(priority), weight: Number(weight), port: Number(port), target: target ?? "" } });
      continue;
    }
    if (type === "TXT") rest = rest.replace(/^"([\s\S]*)"$/, "$1");
    records.push({ type, name, value: rest });
  }
  return { records, problems };
}

export const RECIPES: Record<RecipeId, Recipe> = {
  // Google's own pages, read 23 October 2026: one MX record, smtp.google.com at priority 1, other MX records removed; SPF
  // "v=spf1 include:_spf.google.com ~all" when Google is the only sender.
  google_workspace: {
    id: "google_workspace",
    kind: "email",
    inputs: [
      { key: "verification", required: false, pattern: /^google-site-verification=[\w-]+$/ },
      { key: "dkim", required: false, pattern: /^v=DKIM1;/i },
    ],
    source: { url: "https://knowledge.workspace.google.com/admin/domains/set-up-mx-records-for-google-workspace", read: "2026-10-23" },
    build: (values, current) => [
      ...removeAllMx(current),
      add({ type: "MX", name: "", value: "smtp.google.com", mxPriority: 1 }),
      add({ type: "TXT", name: "", value: "v=spf1 include:_spf.google.com ~all" }),
      ...(values.verification ? [add({ type: "TXT", name: "", value: values.verification })] : []),
      ...(values.dkim ? [add({ type: "TXT", name: "google._domainkey", value: values.dkim })] : []),
    ],
  },
  // Microsoft's page, read 23 October 2026: the MX host and the autodiscover target are shown per account in the Microsoft 365 admin center
  // (copied from there, priority 0), SPF "v=spf1 include:spf.protection.outlook.com -all", and the domain's MS=ms… verification record.
  microsoft_365: {
    id: "microsoft_365",
    kind: "email",
    inputs: [
      { key: "mx", required: true, pattern: /\.mail\.protection\.outlook\.com\.?$/i },
      { key: "autodiscover", required: true, pattern: /^[a-z0-9.-]+\.[a-z]{2,}\.?$/i },
      { key: "verification", required: false, pattern: /^MS=ms\d+$/ },
    ],
    source: { url: "https://learn.microsoft.com/en-us/microsoft-365/admin/get-help-with-domains/create-dns-records-at-any-dns-hosting-provider", read: "2026-10-23" },
    build: (values, current) => [
      ...removeAllMx(current),
      add({ type: "MX", name: "", value: values.mx, mxPriority: 0 }),
      add({ type: "CNAME", name: "autodiscover", value: values.autodiscover }),
      add({ type: "TXT", name: "", value: "v=spf1 include:spf.protection.outlook.com -all" }),
      ...(values.verification ? [add({ type: "TXT", name: "", value: values.verification })] : []),
    ],
  },
  // A service proving the domain is the owner's (Google Search Console, Meta, Pinterest, a mail provider): one TXT record with the value it gave.
  verification: {
    id: "verification",
    kind: "verify",
    inputs: [
      { key: "value", required: true, pattern: /^[\x21-\x7e][\x20-\x7e]{2,500}$/ },
      { key: "name", required: false, pattern: /^[a-z0-9_.-]{0,200}$/i },
    ],
    source: null,
    build: (values) => [add({ type: "TXT", name: values.name ?? "", value: values.value })],
  },
  // A starting DMARC policy: reports nothing and blocks nothing (`p=none`), which says it is a start; the owner tightens it later.
  dmarc: {
    id: "dmarc",
    kind: "trust",
    inputs: [{ key: "policy", required: false, pattern: /^(none|quarantine|reject)$/ }],
    source: null,
    build: (values, current) => [
      ...current.filter((r) => r.type === "TXT" && r.name === "_dmarc").map((r) => ({ op: "remove" as const, record: r })),
      add({ type: "TXT", name: "_dmarc", value: `v=DMARC1; p=${values.policy || "none"}` }),
    ],
  },
  // Any other provider (Zoho Mail, Proton Mail, Fastmail, one.com, Domeneshop …): the records it shows the owner, pasted as lines. A new
  // mail provider's MX records replace the old ones when `replace_mx` is set.
  provider_records: {
    id: "provider_records",
    kind: "email",
    inputs: [
      { key: "records", required: true },
      { key: "replace_mx", required: false, pattern: /^(yes|no)$/ },
    ],
    source: null,
    build: (values, current) => {
      const { records, problems } = parseRecordLines(values.records ?? "");
      if (problems.length > 0) return { problem: problems.join(" ") };
      if (records.length === 0) return { problem: "Paste the records your provider shows." };
      const mx = records.some((r) => r.type === "MX");
      return [...(mx && values.replace_mx === "yes" ? removeAllMx(current) : []), ...records.map(add)];
    },
  },
};

export const RECIPE_IDS = Object.keys(RECIPES) as RecipeId[];

/** The owner's values for a recipe, checked against what each looks like; the problems in words. */
export function recipeChanges(id: RecipeId, values: Record<string, string>, current: readonly DnsRecord[]): { ok: true; changes: DnsChange[] } | { ok: false; problems: string[] } {
  const recipe = RECIPES[id];
  const problems: string[] = [];
  const clean: Record<string, string> = {};
  for (const input of recipe.inputs) {
    const value = (values[input.key] ?? "").trim();
    if (!value) {
      if (input.required) problems.push(`Fill in ${input.key.replace(/_/g, " ")}.`);
      continue;
    }
    if (input.pattern && !input.pattern.test(value)) problems.push(`"${value.slice(0, 60)}" doesn't look like the ${input.key.replace(/_/g, " ")} value your provider shows.`);
    clean[input.key] = value.replace(/\.$/, "");
  }
  if (problems.length > 0) return { ok: false, problems };
  const built = recipe.build(clean, current);
  return Array.isArray(built) ? { ok: true, changes: built } : { ok: false, problems: [built.problem] };
}
