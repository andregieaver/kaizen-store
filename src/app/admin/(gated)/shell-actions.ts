"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

// The admin shell's one action from this folder, in a file of its own: every export of a "use server" file is listed in the
// server-reference manifest by every route that imports the file, and the shell is on every admin route (bloat review step 2.24).

export async function signOut(): Promise<void> {
  try {
    await (await createClient()).auth.signOut();
  } finally {
    redirect("/admin/sign-in");
  }
}
