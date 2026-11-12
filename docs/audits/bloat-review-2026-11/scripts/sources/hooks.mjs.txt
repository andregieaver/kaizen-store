import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as presolve } from "node:path";
const SRC = "/home/user/kaizen-store/src";
const tryFile = (p) => { for (const c of [p, p + ".ts", p + ".tsx", p + "/index.ts"]) if (existsSync(c) && statSync(c).isFile()) return c; return null; };
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) { const f = tryFile(SRC + "/" + specifier.slice(2)); if (f) return { url: pathToFileURL(f).href, shortCircuit: true }; }
    if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      const f = tryFile(presolve(dirname(fileURLToPath(context.parentURL)), specifier)); if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
    }
    return next(specifier, context);
  },
});
