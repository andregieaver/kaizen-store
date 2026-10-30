// HTTPS in front of the test server, for the WebKit project (PSI UX-12): a production build sets its cookies `Secure`, which WebKit
// refuses over plain http://localhost (Chromium accepts them), so the cart and the shopper's account need the page served over HTTPS.
// The certificate is made here for the run (openssl, one day, localhost) and never kept; the browser is told to accept it
// (`ignoreHTTPSErrors` on the project). Requests go to the server unchanged, with the protocol the browser used.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";

const port = Number(process.env.HTTPS_PROXY_PORT ?? 3443);
const target = Number(process.env.PORT ?? 3000);

const dir = mkdtempSync(join(tmpdir(), "kz-e2e-https-"));
const keyPath = join(dir, "key.pem");
const certPath = join(dir, "cert.pem");
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" });
const key = readFileSync(keyPath);
const cert = readFileSync(certPath);
rmSync(dir, { recursive: true, force: true });

const server = https.createServer({ key, cert }, (req, res) => {
  const upstream = http.request(
    { host: "127.0.0.1", port: target, method: req.method, path: req.url, headers: { ...req.headers, "x-forwarded-proto": "https" } },
    (answer) => {
      res.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(res);
    },
  );
  upstream.on("error", () => {
    res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});

server.listen(port, () => console.log(`HTTPS for the e2e server on ${port} → ${target}`));
