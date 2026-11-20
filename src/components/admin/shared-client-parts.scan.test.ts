import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The client parts nearly every admin page draws sit in the chunk every admin route loads (`shared-client-parts.ts`): the root admin
 * layout imports the list, and the list names the link wrapper and Lucide's icon base. Without it Turbopack puts a copy in each
 * layout's and page's first chunks (459 of 482 admin routes, a median of 12.6 KB more, after bloat review step 2.21 cut the server
 * path that had carried them there by accident).
 */
const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), "utf8");

describe("the admin's shared client parts", () => {
  it("are imported by the root admin layout", () => {
    expect(read("src/app/admin/layout.tsx")).toMatch(/^import "@\/components\/admin\/shared-client-parts";$/m);
  });

  it("name the link wrapper and Lucide's icon base", () => {
    const text = read("src/components/admin/shared-client-parts.ts");
    expect(text).toMatch(/^import \{ Icon \} from "lucide-react";$/m);
    expect(text).toMatch(/^import \{ AdminLink \} from "@\/components\/admin\/ui\/link";$/m);
    expect(text).toMatch(/SHARED_CLIENT_PARTS = \[AdminLink, Icon\]/);
  });
});
