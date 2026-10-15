import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NOTIFICATIONS } from "./notifications";

/**
 * The single readers and writers of wave 3's notifications (D238, `docs/wave-3-notifications.md` 3.4 and 6.5), held by reading the source:
 * - only `src/server/notifications.ts` reads or writes `notification_settings` and `email_templates` (the switches and the owner's words);
 * - only `src/server/staff-alerts.ts` reads or writes `staff_alert_settings` and `staff_alert_recipients`;
 * - nothing in the app writes `delivered_source = 'carrier'` (only the SQL function `commerce.record_carrier_delivery()` does);
 * - every module that sends a catalogue kind asks `notificationOn()`.
 * Tests, migrations and the schema are not the app and are left out.
 */

const ROOT = path.resolve(__dirname, "../..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      sources(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

const files = [...sources(path.join(ROOT, "src/server")), ...sources(path.join(ROOT, "src/app"))].map((f) => ({
  file: path.relative(ROOT, f),
  text: readFileSync(f, "utf8"),
}));

const readersOf = (pattern: RegExp) => files.filter((f) => pattern.test(f.text)).map((f) => f.file).sort();

describe("the notifications' tables have one module each", () => {
  it("only notifications.ts touches notification_settings and email_templates", () => {
    expect(readersOf(/commerce\.(notification_settings|email_templates)\b/)).toEqual(["src/server/notifications.ts"]);
  });

  it("only staff-alerts.ts touches staff_alert_settings and staff_alert_recipients", () => {
    expect(readersOf(/commerce\.staff_alert_(settings|recipients)\b/)).toEqual(["src/server/staff-alerts.ts"]);
  });

  it("no app code writes a carrier's delivery: only commerce.record_carrier_delivery() does", () => {
    expect(readersOf(/delivered_source\s*=\s*['"]carrier['"]|delivered_source\s*=\s*\$\{\s*["']carrier["']\s*\}/)).toEqual([]);
  });
});

describe("every sender of a catalogue kind asks notificationOn()", () => {
  /** The modules that send the catalogue's kinds (`orderNotice()` and the parcel emails, `returnMail()`, the confirmation). */
  const SENDERS = ["src/server/shopper-emails.ts", "src/server/return-emails.ts"];

  it("lists every module that names a catalogue kind as an email kind", () => {
    const kinds = NOTIFICATIONS.map((n) => n.id).filter((id) => id !== "return.acknowledgement");
    const naming = files
      .filter((f) => kinds.some((k) => new RegExp(`["'\`]${k.replace(".", "\\.")}["'\`]`).test(f.text)))
      .filter((f) => /sendEmail\(|orderNotice\(|returnMail\(/.test(f.text))
      .map((f) => f.file)
      .sort();
    // The change emails go through `orderNotice()` in shopper-emails.ts, which asks; notifications.ts names the kinds for the preview and sends only the
    // test email; a test fixture is not the app.
    const NOT_SENDERS = ["src/server/order-edit-emails.ts", "src/server/notifications.ts"];
    expect(naming.filter((f) => !SENDERS.includes(f) && !NOT_SENDERS.includes(f) && !f.endsWith("-fixture.ts"))).toEqual([]);
  });

  it("each of them calls notificationOn()", () => {
    for (const file of SENDERS) expect(files.find((f) => f.file === file)?.text, file).toMatch(/notificationOn\(/);
  });
});
