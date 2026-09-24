"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { productInput, type ProductInput } from "@/lib/product-input";
import { requireMember, type Membership } from "@/server/auth";
import { catalogTag } from "@/server/catalog";
import { uploadProductImage, type UploadResult } from "@/server/media";
import {
  getEditorContext,
  getProductForEdit,
  saveProduct,
  setArchived,
  type EditorContext,
} from "@/server/products";

export type SaveState =
  | { status: "idle" }
  | {
      status: "saved";
      productId: string;
      savedAt: string;
      /** The product as stored, with ids for new variants and contacts. */
      product: ProductInput;
      context: EditorContext;
    }
  | { status: "error"; problems: string[] };

function refreshCatalogue(member: Membership) {
  updateTag(catalogTag(member.store.id));
}

/**
 * Saves the editor's JSON payload. The whole product is checked on the
 * server again; nothing the browser sends is trusted.
 */
export async function saveProductAction(
  storeSlug: string,
  productId: string | null,
  payload: string,
): Promise<SaveState> {
  const member = await requireMember(storeSlug);
  if (productId !== null && !z.uuid().safeParse(productId).success) {
    return { status: "error", problems: ["Unknown product."] };
  }
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { status: "error", problems: ["The form could not be read. Reload the page and try again."] };
  }
  const parsed = productInput.safeParse(json);
  if (!parsed.success) {
    return { status: "error", problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  }
  const context = await getEditorContext(member.store);
  const result = await saveProduct(member.store, context, productId, parsed.data);
  if (!result.ok) return { status: "error", problems: result.problems };
  refreshCatalogue(member);
  const fresh = await getEditorContext(member.store);
  const product = await getProductForEdit(member.store, fresh, result.productId);
  if (!product) return { status: "error", problems: ["The product was saved but could not be reloaded."] };
  const { archived, ...input } = product;
  void archived;
  return {
    status: "saved",
    productId: result.productId,
    savedAt: new Date().toISOString(),
    product: input,
    context: fresh,
  };
}

/** Receives a picture already shrunk by the browser, plus its thumbnail. */
export async function uploadImageAction(storeSlug: string, formData: FormData): Promise<UploadResult> {
  const member = await requireMember(storeSlug);
  const image = formData.get("image");
  const thumbnail = formData.get("thumbnail");
  if (!(image instanceof File) || !(thumbnail instanceof File)) {
    return { ok: false, problem: "Choose a picture to upload." };
  }
  return uploadProductImage(member.store.id, image, thumbnail);
}

export async function archiveProductAction(storeSlug: string, productId: string, archive: boolean) {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(productId).success) return;
  await setArchived(member.store, productId, archive);
  refreshCatalogue(member);
  redirect(`/admin/${storeSlug}/products${archive ? "" : `/${productId}`}`);
}
