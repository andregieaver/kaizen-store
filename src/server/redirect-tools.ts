import "server-only";

import type { OwnerToolInput, OwnerToolName } from "@/lib/owner-tools";
import { REDIRECT_TOOLS, overviewNotes, shapeCounts, shapeMissing } from "@/lib/redirect-tools";

import type { Membership } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { notFoundReport } from "./not-found";
import { checkRedirect, createRedirect, redirectCounts } from "./redirects";
import type { Store } from "./stores";

/**
 * The AI manager's redirect tools (D168, `docs/wave-2-redirects.md` 4.8, 5.5). `redirect_overview` reads `redirectCounts()` and `notFoundReport()` as the
 * Redirects pages do: every count is the store's own, the suggestions are the report's (`suggestTargets()`, code, never a model), and nothing is worked out by
 * the model. `add_redirect` is the only write: it goes through `createRedirect()` (the form's own check, `validateRedirect()`) with origin `assistant`, kept for
 * the owner's yes first because it changes what the live site answers. There is no tool that edits, deletes or imports a redirect: those are on the pages.
 * The member's key is asked by the service itself (`website:read`, `website:write`), as for every owner tool.
 */

type Ctx = {
  account: Membership["account"];
  store: Store;
  holder?: Pick<Membership, "role" | "kind" | "permissions">;
};

/** The member the tool works for, as the services take it: the assistant's own holder, or an owner for a run with none. */
const memberOf = (ctx: Ctx): Membership => ({ account: ctx.account, store: ctx.store, role: ctx.holder?.role ?? "owner", kind: ctx.holder?.kind, permissions: ctx.holder?.permissions });

const adminLink = (store: Store, path: string) => `/admin/${store.slug}${path}`;

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const NO_ACCESS = "I can't show that: your role has no access to the website's redirects.";

/** The redirects the store has, and the addresses asked for that were not there. */
export async function redirectOverviewTool(ctx: Ctx, { days, limit }: OwnerToolInput<"redirect_overview">) {
  const member = memberOf(ctx);
  const counts = await redirectCounts(member);
  const report = await notFoundReport(member, { days, limit });
  if (!counts || !report) return fail(NO_ACCESS);
  return {
    redirects: shapeCounts(counts),
    missing: shapeMissing(report, limit),
    notes: overviewNotes(report, counts),
    pages: { redirects: adminLink(ctx.store, "/redirects"), missing_addresses: adminLink(ctx.store, "/redirects/404s"), import: adminLink(ctx.store, "/redirects/import") },
  };
}

/**
 * Adds the redirect the owner said yes to. The service checks it again (the store may have changed since the call was kept) and a refusal comes back as the
 * form's own sentences; a warning (a target that is not a live page now, a chain made one hop) is repeated, never hidden.
 */
export async function addRedirectTool(ctx: Ctx, { from, to }: OwnerToolInput<"add_redirect">) {
  const member = memberOf(ctx);
  const saved = await createRedirect(member, { from, to }, { origin: "assistant" });
  if (!saved.ok) return fail(saved.problems.join(" ") || "That redirect could not be added.");
  const notes = saved.findings.filter((f) => f.severity !== "info" || f.code === "exists.replaced_automatic" || f.code === "exists.update").map((f) => f.text);
  return {
    done: saved.unchanged
      ? `The redirect from ${saved.source} to ${saved.target} was already there.`
      : `${saved.created ? "Added" : "Changed"} the redirect from ${saved.source} to ${saved.target}: it applies in every country and language, and is permanent (308).`,
    from: saved.source,
    to: saved.target,
    ...(notes.length > 0 ? { notes } : {}),
    admin: adminLink(ctx.store, "/redirects"),
  };
}

/**
 * Checks a gated `add_redirect` before it is kept for approval: what could not be added is refused now, in the form's words, and a redirect that is already
 * there as asked is not kept either, so the owner is never asked to approve what cannot be done or does nothing.
 */
export async function preflightRedirectTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<void> {
  if (name !== "add_redirect") return;
  const member = memberOf(ctx);
  const from = String(input.from ?? "");
  const to = String(input.to ?? "");
  const checked = await checkRedirect(member, { from, to });
  if (!checked.ok) return fail(checked.problems.join(" "));
  if (!checked.ok_to_save) {
    const errors = checked.findings.filter((f) => f.severity === "error").map((f) => f.text);
    return fail(errors.join(" ") || "That redirect cannot be added.");
  }
  if (checked.findings.some((f) => f.code === "exists.same")) return fail(`There is already a redirect from ${checked.source} to ${checked.target}: nothing to add.`);
}

/** The two tools' names, for the registry's test. */
export const REDIRECT_OWNER_TOOLS = REDIRECT_TOOLS satisfies readonly OwnerToolName[];

