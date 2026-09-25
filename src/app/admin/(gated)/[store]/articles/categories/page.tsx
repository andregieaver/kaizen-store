import type { Metadata } from "next";

import { StorePageTermsView } from "../../pages/views";

export const metadata: Metadata = { title: "Article categories and tags" };

export default function Page({ params }: PageProps<"/admin/[store]/articles/categories">) {
  return <StorePageTermsView type="article" params={params} />;
}
