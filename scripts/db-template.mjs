// A template database: every migration and the demo catalogue applied once, then a lane or a
// test run gets its own copy in about a second instead of replaying 250 migrations.
//
//   node scripts/db-template.mjs build              make or bring the template up to date
//   node scripts/db-template.mjs rebuild            drop it and build from scratch
//   node scripts/db-template.mjs clone <name>       a new database from the template (--force replaces <name>)
//   node scripts/db-template.mjs drop <name>
//   node scripts/db-template.mjs list               databases on the server besides the system ones
//   node scripts/db-template.mjs prune <prefix> --yes   drop every database whose name starts with the prefix
//
// The template is named kaizen_template_<hash of this checkout's path> (TEMPLATE_DB overrides).
// DATABASE_URL names the server (its database is ignored; default
// postgres://postgres:postgres@localhost:5432/postgres). `clone` prints the new database's URL
// last, so `export DATABASE_URL=$(node scripts/db-template.mjs clone w2_lane | tail -1)` works.
//
// The template remembers what it was built from in its database comment (file names with
// checksums and the seed's checksum). New migration files are applied on top of it; an edited
// file or a changed seed rebuilds it, so a clone always equals `db-setup.mjs --seed`.
import { createHash } from "node:crypto";

import postgres from "postgres";

import { readMigrations, readSeed, root, withDatabase } from "./lib/migrations.mjs";

// One template per checkout (a lane in its own worktree has its own migrations, and two trees
// sharing one template would rebuild it back and forth); TEMPLATE_DB overrides.
const TEMPLATE = process.env.TEMPLATE_DB || `kaizen_template_${createHash("sha1").update(root).digest("hex").slice(0, 6)}`;
const SERVER = process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5432/postgres";
const PROTECTED = new Set(["postgres", "template0", "template1", TEMPLATE]);
const NAME = /^[a-z][a-z0-9_]{1,60}$/;
const MARK = "kaizen-template ";

const [command, target, ...rest] = process.argv.slice(2);
const flags = new Set([target, ...rest].filter((value) => value?.startsWith("--")));
const name = target && !target.startsWith("--") ? target : undefined;

const admin = postgres(withDatabase(SERVER, "postgres"), { max: 1, onnotice: () => {} });
const quote = (identifier) => `"${identifier.replace(/"/g, '""')}"`;

function checkName(value) {
  if (!value || !NAME.test(value)) throw new Error(`"${value ?? ""}" is not a database name (lowercase letters, digits, underscores, starting with a letter).`);
  if (PROTECTED.has(value)) throw new Error(`"${value}" is a protected database.`);
}

async function exists(database) {
  return (await admin`select 1 from pg_database where datname = ${database}`).length > 0;
}

async function stop(database) {
  await admin`select pg_terminate_backend(pid) from pg_stat_activity where datname = ${database} and pid <> pg_backend_pid()`;
}

async function readState() {
  if (!(await exists(TEMPLATE))) return null;
  const [row] = await admin`select shobj_description(oid, 'pg_database') as comment from pg_database where datname = ${TEMPLATE}`;
  if (!row?.comment?.startsWith(MARK)) return null;
  try {
    return JSON.parse(row.comment.slice(MARK.length));
  } catch {
    return null;
  }
}

async function writeState(state) {
  const text = `${MARK}${JSON.stringify(state)}`.replace(/'/g, "''");
  await admin.unsafe(`COMMENT ON DATABASE ${quote(TEMPLATE)} IS '${text}'`);
}

async function applyOn(database, work) {
  const db = postgres(withDatabase(SERVER, database), { max: 1, onnotice: () => {} });
  try {
    await work(db);
  } finally {
    await db.end();
  }
}

async function build({ fresh }) {
  const migrations = await readMigrations();
  const seed = await readSeed();
  const want = migrations.map(({ file, checksum }) => [file, checksum.slice(0, 12)]);
  const state = fresh ? null : await readState();

  if (state) {
    const same = state.seed === seed.checksum.slice(0, 12);
    const prefix = state.files.length <= want.length && state.files.every(([file, sum], index) => want[index][0] === file && want[index][1] === sum);
    if (same && prefix) {
      const pending = migrations.slice(state.files.length);
      if (pending.length === 0) {
        console.log(`The template is up to date (${state.files.length} migrations).`);
        return;
      }
      await stop(TEMPLATE);
      await applyOn(TEMPLATE, async (db) => {
        for (const entry of pending) {
          await db.begin((tx) => tx.unsafe(entry.sql));
          console.log(`applied ${entry.file}`);
        }
      });
      await writeState({ files: want, seed: seed.checksum.slice(0, 12) });
      console.log(`The template now has ${want.length} migrations.`);
      return;
    }
    console.log(same ? "A migration file was edited since the template was built: rebuilding." : "The demo seed changed: rebuilding.");
  }

  if (await exists(TEMPLATE)) {
    await stop(TEMPLATE);
    await admin.unsafe(`DROP DATABASE ${quote(TEMPLATE)}`);
  }
  await admin.unsafe(`CREATE DATABASE ${quote(TEMPLATE)}`);
  const started = Date.now();
  await applyOn(TEMPLATE, async (db) => {
    for (const entry of migrations) await db.unsafe(entry.sql);
    await db.unsafe(seed.sql);
  });
  await writeState({ files: want, seed: seed.checksum.slice(0, 12) });
  console.log(`Built the template from ${migrations.length} migrations and the seed in ${Math.round((Date.now() - started) / 1000)} s.`);
}

try {
  // One template operation at a time on a server (two lanes cloning together, or a build during a clone).
  await admin`select pg_advisory_lock(727002)`;
  switch (command) {
    case "build":
      await build({ fresh: false });
      break;
    case "rebuild":
      await build({ fresh: true });
      break;
    case "clone": {
      checkName(name);
      await build({ fresh: false });
      if (await exists(name)) {
        if (!flags.has("--force")) throw new Error(`"${name}" exists already; pass --force to replace it.`);
        await stop(name);
        await admin.unsafe(`DROP DATABASE ${quote(name)}`);
      }
      await stop(TEMPLATE);
      await admin.unsafe(`CREATE DATABASE ${quote(name)} TEMPLATE ${quote(TEMPLATE)}`);
      console.log(withDatabase(SERVER, name));
      break;
    }
    case "drop":
      checkName(name);
      if (await exists(name)) {
        await stop(name);
        await admin.unsafe(`DROP DATABASE ${quote(name)}`);
        console.log(`dropped ${name}`);
      } else console.log(`${name} does not exist`);
      break;
    case "list": {
      const rows = await admin`select datname from pg_database where datname <> all(${[...PROTECTED]}) order by datname`;
      console.log(rows.map((row) => row.datname).join("\n") || "(none)");
      break;
    }
    case "prune": {
      if (!name || name.length < 2) throw new Error("prune needs a prefix of at least two characters.");
      const rows = await admin`select datname from pg_database where datname like ${`${name.replace(/[\\%_]/g, "\\$&")}%`} and datname <> all(${[...PROTECTED]}) order by datname`;
      if (!flags.has("--yes")) {
        console.log(`${rows.length} database(s) would be dropped (add --yes):\n${rows.map((row) => row.datname).join("\n")}`);
        break;
      }
      for (const row of rows) {
        await stop(row.datname);
        await admin.unsafe(`DROP DATABASE ${quote(row.datname)}`);
        console.log(`dropped ${row.datname}`);
      }
      break;
    }
    default:
      console.error("usage: node scripts/db-template.mjs build | rebuild | clone <name> [--force] | drop <name> | list | prune <prefix> [--yes]");
      process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await admin.end();
}
