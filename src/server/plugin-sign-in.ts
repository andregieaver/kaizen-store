import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { makeApiToken, revokeApiToken } from "./api-tokens";
import { audit, type Membership } from "./auth";
import { encryptionKey } from "./encryption-key";
import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Signing a design tool's app in to a store (D898 F1, `commerce.plugin_sign_ins`, written only here). A Figma plugin runs in a frame that
 * cannot follow a redirect back, so it signs in as Figma's own docs show: it asks for a sign-in (`startPluginSignIn()`), shows its code and
 * opens the owner's admin at `PLUGIN_SIGN_IN_PAGE`; there the owner checks the code, picks the store and presses Connect
 * (`approvePluginSignIn()`), which makes an Admin API token for the plugin (`makeApiToken()`, owners only, in the store's token list
 * where it is revoked like any other); the plugin asks with the secret only it holds (`pollPluginSignIn()`) and is given the token once.
 * Nothing waits longer than ten minutes, and a token is kept here only encrypted, between Connect and the plugin taking it.
 */

export type PluginTool = "figma";

/** The admin page that approves a sign-in. */
export const PLUGIN_SIGN_IN_PAGE = "/admin/account/plugin";

const MINUTES = 10;
/** Eight characters a person reads off one screen and finds on another: no 0/O, 1/I/L. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PLUGIN_CODE = /^[A-HJ-NP-Z2-9]{8}$/;

/** What a plugin's token may do: read and save page drafts, and send pictures to the library. */
export const PLUGIN_SCOPES: Record<PluginTool, string[]> = { figma: ["content:read", "content:write", "products:manage"] };
const TOKEN_NAME: Record<PluginTool, string> = { figma: "Figma plugin" };

const hashOf = (value: string) => createHash("sha256").update(value).digest("hex");

function newCode(): string {
  const bytes = randomBytes(8);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** A new sign-in: the secret the plugin keeps to ask with, the code it shows, and where the owner approves it. */
export async function startPluginSignIn(tool: PluginTool): Promise<{ readKey: string; code: string; url: string; expiresIn: number }> {
  const readKey = randomBytes(32).toString("base64url");
  // Ended sign-ins go as new ones come; a clash of codes (one in a billion) is tried again.
  await db().execute(sql`delete from commerce.plugin_sign_ins where expires_at < now() - interval '1 hour'`);
  for (let attempt = 0; ; attempt++) {
    const code = newCode();
    try {
      await db().execute(sql`
        insert into commerce.plugin_sign_ins (tool, read_hash, code, expires_at)
        values (${tool}, ${hashOf(readKey)}, ${code}, now() + make_interval(mins => ${MINUTES}))
      `);
      return { readKey, code, url: `${siteUrl()}${PLUGIN_SIGN_IN_PAGE}?code=${code}`, expiresIn: MINUTES * 60 };
    } catch (error) {
      if (attempt >= 2) throw error;
    }
  }
}

export type PollAnswer = { status: "waiting" } | { status: "declined" } | { status: "gone" } | { status: "ready"; token: string; store: { name: string; slug: string } };

/** What the plugin is told when it asks: still waiting, declined, gone (ended, taken or unknown), or its token, once. */
export async function pollPluginSignIn(readKey: unknown): Promise<PollAnswer> {
  if (typeof readKey !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(readKey)) return { status: "gone" };
  const key = encryptionKey();
  return db().transaction(async (tx) => {
    const row = await typedRow(
      z.object({ id: col.uuid, status: col.text, token_sealed: col.textOrNull, name: col.textOrNull, slug: col.textOrNull, ended: z.boolean() }),
      sql`select p.id, p.status, p.token_sealed, s.name, s.slug, p.expires_at < now() as ended
          from commerce.plugin_sign_ins p left join commerce.stores s on s.id = p.store_id
          where p.read_hash = ${hashOf(readKey)} for update of p`,
      tx,
    );
    if (!row || row.ended || row.status === "taken") return { status: "gone" } as const;
    if (row.status === "declined") return { status: "declined" } as const;
    if (row.status !== "approved" || !row.token_sealed || !row.slug || !key) return { status: "waiting" } as const;
    await tx.execute(sql`update commerce.plugin_sign_ins set status = 'taken', token_sealed = null where read_hash = ${hashOf(readKey)}`);
    return { status: "ready", token: decryptSecret(row.token_sealed, key), store: { name: String(row.name), slug: row.slug } } as const;
  });
}

/** A sign-in waiting for the owner, as the approving page shows it; null when it is unknown, ended or already answered. */
export async function waitingSignIn(code: unknown): Promise<{ code: string; tool: PluginTool } | null> {
  if (typeof code !== "string" || !PLUGIN_CODE.test(code)) return null;
  const row = await typedRow(
    z.object({ code: col.text, tool: z.enum(["figma"]) }),
    sql`select code, tool from commerce.plugin_sign_ins where code = ${code} and status = 'waiting' and expires_at > now()`,
  );
  return row ?? null;
}

export type ApproveOutcome = { ok: true } | { ok: false; problem: "gone" | "owner" | "limit" | "off" };

/**
 * Connect: the owner's Admin API token for the plugin in this store, made now and handed to the plugin when it next asks. The person's
 * earlier token for the same tool in the store is revoked, so signing in again replaces it.
 */
export async function approvePluginSignIn(member: Membership, code: unknown): Promise<ApproveOutcome> {
  const waiting = await waitingSignIn(code);
  if (!waiting) return { ok: false, problem: "gone" };
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "off" };
  const earlier = await typedRows(
    z.object({ id: col.uuid }),
    sql`select id from commerce.api_tokens
        where store_id = ${member.store.id}::uuid and created_by = ${member.account.id}::uuid and name = ${TOKEN_NAME[waiting.tool]} and revoked_at is null`,
  );
  const made = await makeApiToken(member, { name: TOKEN_NAME[waiting.tool], scopes: PLUGIN_SCOPES[waiting.tool] });
  if (!made.ok) return { ok: false, problem: made.problem === "limit" ? "limit" : "owner" };
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`update commerce.plugin_sign_ins set status = 'approved', store_id = ${member.store.id}::uuid, account_id = ${member.account.id}::uuid,
          token_sealed = ${encryptSecret(made.token, key)}
        where code = ${waiting.code} and status = 'waiting' and expires_at > now() returning id`,
  );
  if (!row) {
    // Answered or ended in between: the token made for it is not left behind.
    await revokeApiToken(member, made.id);
    return { ok: false, problem: "gone" };
  }
  for (const old of earlier) {
    await revokeApiToken(member, old.id).catch((error) => log("warn", "plugin.old_token_kept", { storeId: member.store.id }, error));
  }
  await audit(member.account.id, member.store.id, "integration.plugin_connected", { tool: waiting.tool }, { target: { type: "api_token", id: made.id } });
  return { ok: true };
}

/** Decline: the plugin is told so, and no token is made. */
export async function declinePluginSignIn(code: unknown): Promise<void> {
  if (typeof code !== "string" || !PLUGIN_CODE.test(code)) return;
  await db().execute(sql`update commerce.plugin_sign_ins set status = 'declined' where code = ${code} and status = 'waiting'`);
}

/** The stores a person may connect a design tool to: those they own, open or setting up, not a template, starter or sandbox. */
export async function ownedStores(accountId: string): Promise<{ slug: string; name: string }[]> {
  return typedRows(
    z.object({ slug: col.text, name: col.text }),
    sql`select s.slug, s.name from commerce.store_members m join commerce.stores s on s.id = m.store_id
        where m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
          and s.status <> 'closed' and not (s.is_template or s.starter or s.sandbox)
        order by lower(s.name), s.slug limit 100`,
  );
}
