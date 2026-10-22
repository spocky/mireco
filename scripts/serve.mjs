#!/usr/bin/env node
// Minimal static preview server for MiReCo (development only, no dependencies).
//
//   node scripts/serve.mjs [--host 127.0.0.1] [--port 8080] [--https]
//                          [--cert certs/dev-cert.pem] [--key certs/dev-key.pem]
//
// Only the files GitHub Pages would serve for the app are exposed: dotfiles,
// node_modules, certs, scripts, tests and package files are refused.
// With --https the server never falls back to HTTP.

import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, statSync, createReadStream, existsSync } from "node:fs";
import { networkInterfaces, release } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".md": "text/plain; charset=utf-8",
};

// Top-level paths that are part of the repository but not of the site.
const BLOCKED_TOP = new Set(["node_modules", "certs", "scripts", "tests", "package.json", "package-lock.json"]);

function parseArgs(argv) {
  const opts = {
    host: "127.0.0.1",
    port: 8080,
    https: false,
    cert: process.env.MIRECO_CERT || join(ROOT, "certs", "dev-cert.pem"),
    key: process.env.MIRECO_KEY || join(ROOT, "certs", "dev-key.pem"),
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`Missing value for ${arg}`);
      return v;
    };
    if (arg === "--host") opts.host = next();
    else if (arg === "--port") opts.port = Number(next());
    else if (arg === "--https") opts.https = true;
    else if (arg === "--cert") opts.cert = resolve(next());
    else if (arg === "--key") opts.key = resolve(next());
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/serve.mjs [--host HOST] [--port PORT] [--https] [--cert FILE] [--key FILE]");
      process.exit(0);
    } else fail(`Unknown option ${arg}`);
  }
  if (process.env.PORT) opts.port = Number(process.env.PORT);
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535) fail("Invalid port");
  return opts;
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Maps a URL path to a file inside ROOT, or null if it must not be served. */
export function resolveRequestPath(root, urlPath) {
  let pathname;
  try {
    pathname = decodeURIComponent(urlPath.split("?")[0].split("#")[0]);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((s) => s.startsWith(".") || s.includes("\\"))) return null; // dotfiles, traversal
  if (segments.length && BLOCKED_TOP.has(segments[0])) return null;
  let file = resolve(root, ...segments);
  if (file !== root && !file.startsWith(root + sep)) return null;
  try {
    if (statSync(file).isDirectory()) file = join(file, "index.html");
  } catch {
    return null;
  }
  if (!MIME[extname(file).toLowerCase()]) return null;
  return file;
}

function handler(req, res) {
  const send = (status, body) => {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    res.end(body);
  };
  if (req.method !== "GET" && req.method !== "HEAD") return send(405, "Method not allowed");
  const file = resolveRequestPath(ROOT, req.url || "/");
  let size;
  try {
    if (!file) throw new Error();
    size = statSync(file).size;
  } catch {
    log(req, 404);
    return send(404, "Not found");
  }
  res.writeHead(200, {
    "Content-Type": MIME[extname(file).toLowerCase()],
    "Content-Length": size,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  log(req, 200);
  if (req.method === "HEAD") return res.end();
  createReadStream(file).pipe(res);
}

function log(req, status) {
  const time = new Date().toLocaleTimeString();
  console.log(`${time}  ${status}  ${req.socket.remoteAddress}  ${req.method} ${req.url}`);
}

const VIRTUAL_ADAPTER = /vEthernet|WSL|Hyper-V|Docker|br-|veth|VirtualBox|VMware|vmnet|Tailscale|ZeroTier|utun|tun\d|tap\d/i;

/** LAN IPv4 addresses, likely Wi-Fi/Ethernet ones first. */
function lanAddresses() {
  const out = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === "IPv4" && !a.internal) out.push({ name, address: a.address, virtual: VIRTUAL_ADAPTER.test(name) });
    }
  }
  const rank = (a) => (a.virtual ? 10 : 0) + (a.address.startsWith("192.168.") ? 0 : a.address.startsWith("10.") ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b));
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const scheme = opts.https ? "https" : "http";
  let server;
  if (opts.https) {
    if (!existsSync(opts.cert) || !existsSync(opts.key)) {
      fail(
        `HTTPS preview needs a certificate and key:\n    cert: ${opts.cert}\n    key:  ${opts.key}\n\n` +
        "  Create them with mkcert (see README, \"HTTPS LAN preview\"):\n    npm run certs\n" +
        "  or point to existing files with --cert/--key or MIRECO_CERT/MIRECO_KEY.\n" +
        "  Not falling back to HTTP.",
      );
    }
    server = createHttpsServer({ cert: readFileSync(opts.cert), key: readFileSync(opts.key) }, handler);
  } else {
    server = createHttpServer(handler);
  }

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") fail(`Port ${opts.port} is already in use. Try another one, e.g.: npm run preview -- --port ${opts.port + 1}`);
    if (err.code === "EACCES") fail(`Not allowed to listen on ${opts.host}:${opts.port}.`);
    fail(err.message);
  });

  server.listen(opts.port, opts.host, () => {
    console.log(`\nMiReCo preview (${scheme.toUpperCase()}) serving ${ROOT}\n`);
    const allInterfaces = opts.host === "0.0.0.0" || opts.host === "::";
    if (allInterfaces || opts.host === "127.0.0.1" || opts.host === "localhost") {
      console.log(`  This computer:  ${scheme}://localhost:${opts.port}/`);
    } else {
      console.log(`  URL:            ${scheme}://${opts.host}:${opts.port}/`);
    }
    if (allInterfaces) {
      const lan = lanAddresses();
      if (lan.length === 0) console.log("  No LAN IPv4 address found.");
      for (const { name, address, virtual } of lan) {
        const note = virtual ? `${name}; virtual/VPN adapter, usually not reachable from a phone` : name;
        console.log(`  Phone / LAN:    ${scheme}://${address}:${opts.port}/   (${note})`);
      }
      console.log("\n  LAN preview is for trusted networks only. If the phone can't connect, allow");
      console.log("  Node.js through the firewall (README → \"Troubleshooting LAN preview\").");
      if (/microsoft/i.test(release())) {
        console.log("\n  ⚠ Running inside WSL2. Unless WSL uses mirrored networking, the addresses");
        console.log("    above are internal to WSL and NOT reachable from your phone. Run the");
        console.log("    server from Windows (PowerShell: npm run preview:lan) or see the README.");
      }
    } else {
      console.log("\n  Only reachable from this computer. Use `npm run preview:lan` for phones.");
    }
    if (opts.https) {
      console.log("\n  Uses your local development certificate. The phone must trust the mkcert CA;");
      console.log("  this is not the same as GitHub Pages' publicly trusted certificate.");
    }
    console.log("\n  Ctrl+C to stop.\n");
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
