import { notFound } from "next/navigation";
import { z } from "zod";

import { exportFieldGroups, getFieldGroup } from "@/server/custom-fields";
import { requirePermission } from "@/server/permissions";

/**
 * The store's field groups as a JSON file to keep or move to another store
 * (D118): all of them, or the ones named by `?group=<id>` (repeatable).
 */
export async function GET(request: Request, { params }: RouteContext<"/admin/[store]/fields/export">) {
  const { store } = await requirePermission((await params).store, "products:read");
  const wanted = new URL(request.url).searchParams.getAll("group");
  if (!wanted.every((id) => z.uuid().safeParse(id).success)) notFound();
  const file = await exportFieldGroups(store.id, wanted.length > 0 ? wanted : undefined);
  if (wanted.length > 0 && file.groups.length === 0) notFound();
  const name = wanted.length === 1 ? ((await getFieldGroup(store.id, wanted[0]))?.slug ?? "group") : "all";
  return new Response(JSON.stringify(file, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="fields-${store.slug}-${name}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
