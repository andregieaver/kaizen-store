import type { Metadata } from "next";

import { PageTermsView } from "../../pages/views";

export const metadata: Metadata = { title: "Article categories and tags" };

export default function Page() {
  return <PageTermsView type="article" />;
}
