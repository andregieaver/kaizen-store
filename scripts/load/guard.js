// Load tests (D314, docs/capacity.md step 4.3) never run against production: only a preview deployment over a seeded Supabase branch.
// A developer tool for k6 (installed by the developer; nothing in package.json). The target is TARGET, the store's address STORE.

const PRODUCTION = [/(^|\.)kaizenaflow\.com$/, /(^|\.)kaizenstore\.site$/, /(^|\.)kaizenstore\.cloud$/];

/** The target's origin, refusing a production host or anything that is not https (or localhost). */
export function target(value) {
  if (!value) throw new Error("Set TARGET to a preview deployment's address, such as https://kaizen-store-git-branch.vercel.app.");
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (PRODUCTION.some((p) => p.test(host))) throw new Error(`${host} is production. Load tests run only against a preview deployment.`);
  if (url.protocol !== "https:" && host !== "localhost" && host !== "127.0.0.1") throw new Error("Use an https address.");
  return url.origin;
}
