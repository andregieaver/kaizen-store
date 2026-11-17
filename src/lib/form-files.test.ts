import { describe, expect, it } from "vitest";

import { fileSize, formFileKind, formFilePath, namesActive, pdfProblem, safeFileName } from "./form-files";

const bytes = (text: string) => new TextEncoder().encode(text);
const pdf = (body: string) => bytes(`%PDF-1.7\n${body}\ntrailer << /Root 1 0 R >>\n%%EOF\n`);

describe("files sent with a form (D738 F6b)", () => {
  it("takes a whole PDF and refuses one that runs, launches or carries something", () => {
    expect(pdfProblem(pdf("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj"))).toBeNull();
    expect(pdfProblem(pdf("1 0 obj << /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj"))).toBe("active");
    expect(pdfProblem(pdf("1 0 obj << /S /Launch /F (cmd.exe) >> endobj"))).toBe("active");
    expect(pdfProblem(pdf("1 0 obj << /Names << /EmbeddedFiles 3 0 R >> >> endobj"))).toBeNull();
    expect(pdfProblem(pdf("1 0 obj << /Type /EmbeddedFile >> endobj"))).toBe("active");
    // Spelt with escapes, or inside a compressed stream the server opened.
    expect(pdfProblem(pdf("1 0 obj << /S /#4A#61vaScript >> endobj"))).toBe("active");
    expect(pdfProblem(pdf("1 0 obj << /Length 9 >> stream\nxx\nendstream"), ["<< /JS (x) >>"])).toBe("active");
    expect(pdfProblem(bytes("%PDF-1.7\nno end"))).toBe("not_pdf");
    expect(pdfProblem(bytes("<html>%%EOF</html>"))).toBe("not_pdf");
  });

  it("reads a name to its end, so /JSON or /JSX is not /JS", () => {
    expect(namesActive("<< /JSON 1 /JSX 2 >>")).toBe(false);
    expect(namesActive("<< /JS(x) >>")).toBe(true);
  });

  it("knows a file by its bytes, never by its name", () => {
    expect(formFileKind(pdf("x"))).toEqual({ type: "application/pdf" });
    expect(formFileKind(bytes("MZ\x90\x00 a program"))).toEqual({ problem: "not_allowed" });
    const big = new Uint8Array(3_100_000);
    big.set(bytes("%PDF-1.7"));
    expect(formFileKind(big)).toEqual({ problem: "too_big" });
  });

  it("keeps a safe name with the extension of what the file is, and a path under its owner", () => {
    expect(safeFileName("C:\\Users\\kari\\Kvittering mars.exe", "application/pdf")).toBe("Kvittering mars.pdf");
    expect(safeFileName("../../etc/passwd", "image/webp")).toBe("passwd.webp");
    expect(safeFileName("<script>.jpg", "image/jpeg")).toBe("script.jpg");
    expect(safeFileName("", "image/jpeg")).toBe("file.jpg");
    expect(formFilePath(null, "r1", "q2", "application/pdf")).toBe("platform/r1/q2.pdf");
    expect(fileSize(820_400)).toBe("820 kB");
    expect(fileSize(2_400_000)).toBe("2.4 MB");
  });
});
