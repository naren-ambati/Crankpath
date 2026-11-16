// A loopback HTTP server for git tests (no network beyond 127.0.0.1): it answers git's first
// request with a fixed status, so the installed git's own failure texts can be captured and the
// fixed options' behaviour observed. Every request is logged as one JSON line (method, path,
// whether an Authorization header came, and its value only as a sha256 digest).
//
//   node test/support/git-http-server.mjs <log file>     prints the port, then serves
//
// Paths: /status/<code>/... answers <code> (401 with a Basic challenge); /redirect/... answers
// 301 to /status/404/...; /slow/... sends headers and then nothing, holding the connection open.

import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";

const log = process.argv[2] ?? "git-http-server.log";
const server = http.createServer((req, res) => {
  const auth = req.headers.authorization;
  fs.appendFileSync(
    log,
    `${JSON.stringify({
      method: req.method,
      path: req.url,
      auth: auth === undefined ? null : createHash("sha256").update(auth).digest("hex"),
    })}\n`,
  );
  const url = req.url ?? "/";
  const status = /^\/status\/(\d{3})\//.exec(url);
  if (status !== null) {
    const code = Number(status[1]);
    const headers = code === 401 ? { "WWW-Authenticate": 'Basic realm="test"' } : {};
    res.writeHead(code, headers);
    res.end(`status ${code}\n`);
    return;
  }
  if (url.startsWith("/redirect/")) {
    res.writeHead(301, { Location: `/status/404/${url.slice("/redirect/".length)}` });
    res.end();
    return;
  }
  if (url.startsWith("/slow/")) {
    res.writeHead(200, { "Content-Type": "application/x-git-upload-pack-advertisement" });
    res.write("");
    return; // never ends
  }
  res.writeHead(404);
  res.end();
});
server.listen(0, "127.0.0.1", () => {
  const a = server.address();
  process.stdout.write(`${typeof a === "object" && a !== null ? a.port : 0}\n`);
});
