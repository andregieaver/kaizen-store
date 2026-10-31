import type { Metadata } from "next";

import { NewPageView } from "../editor-views";

export const metadata: Metadata = { title: "New page" };

export default function Page() {
  return <NewPageView type="page" />;
}
