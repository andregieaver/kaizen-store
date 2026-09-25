import type { Metadata } from "next";

import { StorePageTermsView } from "../views";

export const metadata: Metadata = { title: "Page categories and tags" };

export default function Page({ params }: PageProps<"/admin/[store]/pages/categories">) {
  return <StorePageTermsView type="page" params={params} />;
}
