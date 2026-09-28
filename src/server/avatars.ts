import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { avatarPictureUrl, initials, type AvatarView } from "@/lib/avatar";
import { gravatarPath } from "@/lib/gravatar";
import { parseKey } from "@/lib/secret-box";

import { removeAvatarFiles, uploadAvatarFile, type AvatarUpload } from "./media";

/**
 * Profile pictures (D97) for accounts (Kaizen's admin: owners, staff, hosts,
 * platform admins) and store customers: their own picture, else their
 * Gravatar through Kaizen's proxy, else their initials.
 */

type Person = { name?: string | null; email: string; avatarPath?: string | null };

/** The key Gravatar addresses are signed with; without it, no Gravatar. */
function signingKey(): Buffer | null {
  return parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
}

/** What `<Avatar>` draws for someone. */
export function avatarFor(person: Person): AvatarView {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = signingKey();
  const src =
    person.avatarPath && supabaseUrl
      ? avatarPictureUrl(supabaseUrl, person.avatarPath)
      : key && person.email
        ? gravatarPath(person.email, key)
        : null;
  return { label: person.name?.trim() || person.email, initials: initials(person.name, person.email), src };
}

export type AvatarOutcome = { ok: true } | Extract<AvatarUpload, { ok: false }>;

/** Stores an account's new picture and forgets its old one. */
export async function setAccountAvatar(accountId: string, file: File): Promise<AvatarOutcome> {
  const upload = await uploadAvatarFile(`accounts/${accountId}`, file);
  if (!upload.ok) return upload;
  const [row] = await db().execute<{ old: string | null }>(sql`
    update commerce.accounts a set avatar_path = ${upload.path}
    from (select avatar_path as old from commerce.accounts where id = ${accountId}::uuid for update) o
    where a.id = ${accountId}::uuid
    returning o.old
  `);
  await removeAvatarFiles(row ? [row.old].filter((p): p is string => Boolean(p)) : [upload.path]);
  return { ok: true };
}

/** Takes an account's picture away: it shows its Gravatar or initials again. */
export async function removeAccountAvatar(accountId: string): Promise<void> {
  const [row] = await db().execute<{ old: string | null }>(sql`
    update commerce.accounts a set avatar_path = null
    from (select avatar_path as old from commerce.accounts where id = ${accountId}::uuid for update) o
    where a.id = ${accountId}::uuid
    returning o.old
  `);
  if (row?.old) await removeAvatarFiles([row.old]);
}

/** Stores a customer's new picture in their store and forgets their old one. */
export async function setCustomerAvatar(storeId: string, customerId: string, file: File): Promise<AvatarOutcome> {
  const upload = await uploadAvatarFile(`customers/${storeId}/${customerId}`, file);
  if (!upload.ok) return upload;
  const [row] = await db().execute<{ old: string | null }>(sql`
    update commerce.customers c set avatar_path = ${upload.path}, updated_at = now()
    from (select avatar_path as old from commerce.customers
          where store_id = ${storeId}::uuid and id = ${customerId}::uuid for update) o
    where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
    returning o.old
  `);
  await removeAvatarFiles(row ? [row.old].filter((p): p is string => Boolean(p)) : [upload.path]);
  return { ok: true };
}

/** Takes a customer's picture away. */
export async function removeCustomerAvatar(storeId: string, customerId: string): Promise<void> {
  const [row] = await db().execute<{ old: string | null }>(sql`
    update commerce.customers c set avatar_path = null, updated_at = now()
    from (select avatar_path as old from commerce.customers
          where store_id = ${storeId}::uuid and id = ${customerId}::uuid for update) o
    where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
    returning o.old
  `);
  if (row?.old) await removeAvatarFiles([row.old]);
}
