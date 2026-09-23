import "server-only";

import { sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/db/client";
import { createClient } from "@/lib/supabase/server";

export type StaffRole = "owner" | "admin";
export type Staff = { id: string; email: string; role: StaffRole };

type Row = Record<string, unknown>;

/**
 * The signed-in staff member, or null. The Supabase session token is verified
 * (not just read from the cookie) and must belong to an active staff member.
 */
export const getStaff = cache(async (): Promise<Staff | null> => {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return null; // Supabase is not configured (e.g. in CI).
  }
  const { data, error } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (error || typeof userId !== "string") return null;

  const [row] = await db().execute<Row>(sql`
    select id, email, role from commerce.staff
    where auth_user_id = ${userId}::uuid and disabled_at is null
  `);
  return row
    ? { id: String(row.id), email: String(row.email), role: row.role as StaffRole }
    : null;
});

/** For pages and actions: the staff member, or a redirect to sign in. */
export async function requireStaff(role?: "owner"): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect("/admin/sign-in");
  if (role === "owner" && staff.role !== "owner") {
    throw new Error("Only an owner can do this.");
  }
  return staff;
}

/** Whether a sign-in link may be sent to this email. */
export async function isActiveStaffEmail(email: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select 1 as ok from commerce.staff
    where lower(email) = lower(${email}) and disabled_at is null
  `);
  return Boolean(row);
}

/**
 * Links a Supabase Auth user to the staff row with the same email, on first
 * sign-in. Returns null if the email is not active staff.
 */
export async function linkStaffAccount(
  authUserId: string,
  email: string,
): Promise<Staff | null> {
  const [row] = await db().execute<Row>(sql`
    update commerce.staff
       set auth_user_id = ${authUserId}::uuid
     where lower(email) = lower(${email})
       and disabled_at is null
       and (auth_user_id is null or auth_user_id = ${authUserId}::uuid)
    returning id, email, role
  `);
  return row
    ? { id: String(row.id), email: String(row.email), role: row.role as StaffRole }
    : null;
}

/** Records a staff or settings change. Never pass secrets in `details`. */
export async function audit(
  staffId: string | null,
  action: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db().execute(sql`
    insert into commerce.settings_audit_log (staff_id, action, details)
    values (${staffId}::uuid, ${action}, ${JSON.stringify(details)}::jsonb)
  `);
}
