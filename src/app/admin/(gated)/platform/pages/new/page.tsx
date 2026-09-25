import type { Metadata } from "next";

import { NewPageView } from "../views";

export const metadata: Metadata = { title: "New page" };

export default function Page() {
  return <NewPageView type="page" />;
}
