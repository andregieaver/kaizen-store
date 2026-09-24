import { z } from "zod";

const contents = z.array(
  z.object({ lineId: z.uuid(), variantId: z.uuid(), quantity: z.coerce.number().int().min(0).max(99) }),
);

/**
 * Reads a change-contents form (D29): per line, its `line` id, a
 * `variant:<id>` and a `quantity:<id>`; a ticked `remove:<id>` makes it 0.
 */
export function readContentsForm(form: FormData) {
  const lineIds = form.getAll("line").map(String);
  return contents.safeParse(
    lineIds.map((lineId) => ({
      lineId,
      variantId: String(form.get(`variant:${lineId}`) ?? ""),
      quantity: form.get(`remove:${lineId}`) ? 0 : form.get(`quantity:${lineId}`),
    })),
  );
}
