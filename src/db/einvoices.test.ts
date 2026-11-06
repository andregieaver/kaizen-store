import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { NOT_PERSONAL } from "@/lib/personal-data";
import { COPY_RULES } from "@/lib/store-copy-rules";
import { STORE_EXPORT_LEFT_OUT } from "@/lib/store-export-scope";

import { createTestDatabase } from "./testing";

/**
 * E-invoices through Peppol (B1, D463): the rules the database holds for a document's sending and for what the network's register said, run
 * against real Postgres (PGlite) with every migration applied. One row per document; handed over means an access point, its message id and
 * the time; refused, failed and not valid say why; the register's answers are keyed by a well-formed participant.
 */

let db: PGlite;
let shop: string;

beforeAll(async () => {
  db = await createTestDatabase();
  shop = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('ei-shop', 'E-invoices', 'NO') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);
const doc = "00000000-0000-4000-8000-0000000000e1";

describe("a document's sending", () => {
  it("is one row per document, of a known type and state", async () => {
    await db.query("insert into commerce.einvoice_sends (store_id, document_type, document_id, state) values ($1, 'work_invoice', $2, 'pending')", [shop, doc]);
    await rejects("insert into commerce.einvoice_sends (store_id, document_type, document_id, state) values ($1, 'work_invoice', $2, 'pending')", [shop, doc], /einvoice_sends_document_key/);
    await rejects("insert into commerce.einvoice_sends (store_id, document_type, document_id, state) values ($1, 'receipt', $2, 'pending')", [shop, doc], /einvoice_sends_type/);
    await rejects("update commerce.einvoice_sends set state = 'lost' where document_id = $1", [doc], /einvoice_sends_state/);
  });

  it("is handed over only with the access point, its message id and the time, and refused only with a reason", async () => {
    await rejects("update commerce.einvoice_sends set state = 'sent' where document_id = $1", [doc], /einvoice_sends_sent/);
    await rejects("update commerce.einvoice_sends set state = 'refused' where document_id = $1", [doc], /einvoice_sends_problem/);
    await db.query("update commerce.einvoice_sends set state = 'sent', access_point = 'stand-in', message_id = 'm-1', sent_at = now() where document_id = $1", [doc]);
    const other = "00000000-0000-4000-8000-0000000000e2";
    await db.query("insert into commerce.einvoice_sends (store_id, document_type, document_id, state) values ($1, 'invoice', $2, 'pending')", [shop, other]);
    await rejects(
      "update commerce.einvoice_sends set state = 'sent', access_point = 'stand-in', message_id = 'm-1', sent_at = now() where document_id = $1",
      [other],
      /einvoice_sends_message_key/,
    );
  });

  it("is a record of the store, never copied, and holds no person's data", () => {
    expect(STORE_EXPORT_LEFT_OUT.einvoice_sends).toBe("record");
    expect(COPY_RULES.einvoice_sends).toBeDefined();
    expect(NOT_PERSONAL.einvoice_sends).toBeDefined();
    expect(NOT_PERSONAL.peppol_receivers).toBeDefined();
  });
});

describe("what the register said", () => {
  it("is keyed by a participant value of a scheme and a number", async () => {
    await db.query("insert into commerce.peppol_receivers (participant, invoice, credit_note) values ('0192:923609016', true, true)");
    await rejects("insert into commerce.peppol_receivers (participant, invoice, credit_note) values ('iso6523-actorid-upis::0192:1', true, true)", [], /peppol_receivers_participant/);
    await rejects("insert into commerce.peppol_receivers (participant, invoice, credit_note) values ('0192:923609016', false, false)", [], /peppol_receivers_pkey/);
  });
});
