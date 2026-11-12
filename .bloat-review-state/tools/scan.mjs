import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const require = createRequire("/home/user/kaizen-store/node_modules/.pnpm/@tailwindcss+oxide@4.3.3/node_modules/@tailwindcss/oxide/");
const { Scanner } = require("@tailwindcss/oxide");
const R = "/home/user/kaizen-store";
const configs = {
  today: [
    { base: R + "/src", pattern: "**/*", negated: false },
    { base: R + "/src/data", pattern: "**/*", negated: true },
    { base: R + "/supabase/migrations", pattern: "*.sql", negated: false },
  ],
  noSql: [
    { base: R + "/src", pattern: "**/*", negated: false },
    { base: R + "/src/data", pattern: "**/*", negated: true },
  ],
  noSqlNoTests: [
    { base: R + "/src", pattern: "**/*", negated: false },
    { base: R + "/src/data", pattern: "**/*", negated: true },
    { base: R + "/src", pattern: "**/*.test.ts", negated: true },
    { base: R + "/src", pattern: "**/*.test.tsx", negated: true },
    { base: R + "/src/test", pattern: "**/*", negated: true },
  ],
  lean: [
    { base: R + "/src", pattern: "**/*", negated: false },
    { base: R + "/src/data", pattern: "**/*", negated: true },
    { base: R + "/src", pattern: "**/*.test.ts", negated: true },
    { base: R + "/src", pattern: "**/*.test.tsx", negated: true },
    { base: R + "/src/test", pattern: "**/*", negated: true },
    { base: R + "/src/lib/admin-messages", pattern: "**/*", negated: true },
    { base: R + "/src/lib/messages", pattern: "**/*", negated: true },
    { base: R + "/src/db", pattern: "**/*", negated: true },
  ],
};
const which = process.argv[2];
const t0 = process.hrtime.bigint();
const s = new Scanner({ sources: configs[which] });
const c = s.scan();
const ms = Number(process.hrtime.bigint() - t0) / 1e6;
console.log(which, "files", s.files.length, "candidates", c.length, "ms", Math.round(ms), "rssMB", Math.round(process.memoryUsage().rss / 1e6));
writeFileSync("cand-" + which + ".json", JSON.stringify(c));
