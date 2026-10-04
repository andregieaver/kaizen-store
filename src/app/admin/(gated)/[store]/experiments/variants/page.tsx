import { redirect } from "next/navigation";

import { requirePermission } from "@/server/permissions";

/** A version has no list of its own: the tests are listed. */
export default async function Page({ params }: PageProps<"/admin/[store]/experiments/variants">) {
  const { store } = await requirePermission((await params).store, "marketing:read");
  redirect(`/admin/${store.slug}/experiments`);
}
