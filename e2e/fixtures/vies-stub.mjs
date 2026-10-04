// A stand-in for VIES, the Commission's VAT number service, for the end-to-end tests (e2e/vat-reverse-charge.spec.ts).
// The app is pointed at it with VIES_TEST_URL and VIES_ALLOW_TEST_URL=1 (playwright.config.ts); neither is honoured on Vercel.
//   POST /check-vat-number   the answer, by the current mode: valid (default), invalid, down (HTTP 503)
//   POST /__mode             {"mode": "valid" | "invalid" | "down"} changes the mode; GET /__calls counts the requests
//   GET  /__health           for Playwright to know it is up
import http from "node:http";

const port = Number(process.env.VIES_STUB_PORT ?? 3911);
let mode = "valid";
let calls = 0;

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      if (req.url === "/__health") return send(res, 200, { ok: true });
      if (req.url === "/__calls") return send(res, 200, { calls });
      if (req.url === "/__mode" && req.method === "POST") {
        mode = JSON.parse(raw || "{}").mode ?? "valid";
        return send(res, 200, { mode });
      }
      if (req.url === "/check-vat-number" && req.method === "POST") {
        calls += 1;
        if (mode === "down") return send(res, 503, { message: "MS_UNAVAILABLE" });
        let body = {};
        try {
          body = JSON.parse(raw);
        } catch {
          return send(res, 400, { message: "bad request" });
        }
        if (mode === "invalid") return send(res, 200, { valid: false, countryCode: body.countryCode, vatNumber: body.vatNumber });
        return send(res, 200, {
          valid: true,
          countryCode: body.countryCode,
          vatNumber: body.vatNumber,
          name: "KUNDE APS",
          address: "HOVEDGADEN 1\n1000 KOBENHAVN",
          requestIdentifier: body.requesterNumber ? "WAPIAEPE2E" : "---",
        });
      }
      send(res, 404, { message: "not here" });
    });
  })
  .listen(port, "127.0.0.1");
