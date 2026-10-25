import { readFileSync } from "node:fs";
import { join } from "node:path";

import Bunzip from "seek-bzip";
import { describe, expect, it } from "vitest";

import {
  cellarPassages,
  consolidationQuery,
  latestConsolidation,
  lovdataPassages,
  lovdataVersion,
  missingPassages,
  normalisedLegalText,
  retsinformationPassages,
  retsinformationStatus,
  riksdagenPassages,
  tarFile,
} from "./legal-passages";

/**
 * Cutting official texts into passages (D311, unit L, `docs/ai-autopilot.md` 8.2), on answers stored as each route served them on
 * 2026-10-25 (cut to a few articles or sections): Cellar's XHTML, Riksdagen's text, Retsinformation's XML and Lovdata's open data.
 */

const fixturePath = (name: string) => join(__dirname, "fixtures", "legal", name);
const fixture = (name: string) => readFileSync(fixturePath(name), "utf8");

describe("Cellar (EU law)", () => {
  const passages = cellarPassages(fixture("cellar-crd.eng.xhtml"));

  it("cuts articles and annexes by their ids, titled as cited", () => {
    expect(passages.map((p) => p.key)).toEqual(["art_9", "art_16", "anx_I"]);
    expect(passages[0].title).toBe("Article 9 — Right of withdrawal");
    expect(passages[2].title).toBe("Annex I");
  });

  it("keeps the law's words and leaves out the consolidation's markers and amendment notes", () => {
    const art9 = passages[0].text;
    expect(art9).toContain("the consumer shall have a period of 14 days to withdraw from a distance or off-premises contract, without giving any reason");
    expect(art9).not.toMatch(/[▼►◄]/);
    expect(art9).not.toContain("32019L2161");
    expect(passages[2].text).toContain("B. Model withdrawal form");
  });

  it("finds the newest consolidated version, or the act itself", () => {
    const csv = '"c"\n"02011L0083-20180701"\n"02011L0083-20260927"\n"02011L0083-20220528"\n"02016R0679-20160504"\n';
    expect(latestConsolidation(csv, "32011L0083")).toBe("02011L0083-20260927");
    expect(latestConsolidation(csv, "32019L0771")).toBe("32019L0771");
    expect(consolidationQuery("32011L0083")).toContain('"02011L0083-"');
  });
});

describe("Riksdagen (Swedish law)", () => {
  const text = fixture("riksdagen-sfs-2005-59.txt");
  const passages = riksdagenPassages(text, "2026-10-25");
  const byKey = new Map(passages.map((p) => [p.key, p]));

  it("cuts sections by chapter, with their headings, and not at a line that starts with a reference", () => {
    expect([...byKey.keys()]).toEqual(["1:1", "1:2", "1:3", "1:4", "2:10", "2:10a", "2:10b", "2:11", "2:12", "2:16"]);
    expect(byKey.get("2:10")?.title).toBe("2 kap. 10 § (Konsumentens ångerrätt)");
    expect(byKey.get("2:10")?.text).toContain("inom 14 dagar från den dag som anges i 12 § (ångerfrist)");
    expect(byKey.get("2:10a")?.title).toMatch(/^2 kap\. 10 a §/);
    // A heading is the next section's, not the end of this one.
    expect(byKey.get("2:11")?.text.endsWith("Lag (2022:655).")).toBe(true);
  });

  it("takes the version of a section in force on the day", () => {
    expect(byKey.get("2:16")?.text).toContain("konsumentkreditlagen (2010:1846)");
    expect(riksdagenPassages(text, "2026-11-20").find((p) => p.key === "2:16")?.text).toContain("konsumentkreditlagen (2026:1011)");
  });

  it("joins a word broken at the end of a line", () => {
    expect(riksdagenPassages("1 kap. Test\n\n1 § Ange din e-\npostadress och\n- en rad.\n", "2026-10-25")[0].text).toBe("Ange din e-postadress och - en rad.");
  });
});

describe("Retsinformation (Danish law)", () => {
  const xml = fixture("retsinformation-lta-2025-1184.xml");

  it("cuts the act's sections and stops at its first commencement provisions", () => {
    const passages = retsinformationPassages(xml);
    expect(passages.map((p) => p.key)).toEqual(["17", "18", "19"]);
    expect(passages[1].title).toBe("§ 18");
    expect(passages[1].text).toContain("(fortrydelsesret)");
  });

  it("reads whether the act is in force", () => {
    expect(retsinformationStatus(xml)).toBe("Valid");
    expect(retsinformationStatus("<Dokument><Meta><Status>Historic</Status></Meta></Dokument>")).toBe("Historic");
  });
});

describe("Lovdata (Norwegian law)", () => {
  const html = fixture("lovdata-nl-20140620-027.xml");

  it("cuts sections by their names, titled as cited, without the notes of the acts that changed them", () => {
    const passages = lovdataPassages(html);
    expect(passages.map((p) => p.key)).toEqual(["20", "21"]);
    expect(passages[1].title).toBe("§ 21. Angrefristen");
    expect(passages[1].text).toMatch(/^Angrefristen utløper 14 dager fra den dag avtalen om tjeneste ble inngått/);
  });

  it("leaves out a section added by a law not yet in force, which has no words", () => {
    expect(html).toContain('data-name="§20a"');
    expect(lovdataPassages(html).find((p) => p.key === "20a")).toBeUndefined();
  });

  it("names the version: the act and the day its last change came into force", () => {
    expect(lovdataVersion(html)).toBe("NL/lov/2014-06-20-27@2023-10-01");
  });

  it("finds an act in the open data's archive, unpacked from bzip2 as served", () => {
    const archive = new Uint8Array(Bunzip.decode(readFileSync(fixturePath("lovdata-mini.tar.bz2"))));
    const file = tarFile(archive, "nl/nl-20140620-027.xml");
    expect(new TextDecoder().decode(file!)).toBe(html);
    expect(tarFile(archive, "nl/nl-20180615-038.xml")).toBeNull();
  });
});

describe("texts compared", () => {
  it("are normalised alike: soft hyphens, spaces, quotation marks and dashes", () => {
    expect(normalisedLegalText("reg­lerne  \n “14 dage” – ‘ok’")).toBe("reglerne \"14 dage\" - 'ok'");
  });

  it("say which named passages a read lacks", () => {
    expect(missingPassages([{ key: "art_9", title: "", text: "x" }], ["art_9", "art_16"])).toEqual(["art_16"]);
  });
});
