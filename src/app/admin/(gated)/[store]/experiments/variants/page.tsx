import { redirect } from "next/navigation";

import { requirePermission } from "@/server/permissions";
import { requireExtension } from "@/components/admin/extension-off";

/** A version has no list of its own: the tests are listed. */
export default async function Page({ params }: PageProps<"/admin/[store]/experiments/variants">) {
  const member = await requirePermission((await params).store, "marketing:read");
  const notInAccount = requireExtension(member, "ab_testing");
  if (notInAccount) return notInAccount;
  const { store } = member;
  redirect(`/admin/${store.slug}/experiments`);
}
