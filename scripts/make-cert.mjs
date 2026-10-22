#!/usr/bin/env node
// Creates a development certificate for the HTTPS preview with mkcert
// (https://github.com/FiloSottile/mkcert), covering localhost and every LAN
// IPv4 address of this computer. Extra names/IPs can be passed as arguments:
//
//   npm run certs -- 192.168.1.50 mypc.local
//
// Output: certs/dev-cert.pem and certs/dev-key.pem (git-ignored).

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dir = join(ROOT, "certs");
mkdirSync(dir, { recursive: true });

const lan = Object.values(networkInterfaces())
  .flat()
  .filter((a) => a && a.family === "IPv4" && !a.internal)
  .map((a) => a.address);
const names = [...new Set(["localhost", "127.0.0.1", "::1", ...lan, ...process.argv.slice(2)])];

const cert = join(dir, "dev-cert.pem");
const key = join(dir, "dev-key.pem");
console.log(`Creating certificate for: ${names.join(", ")}`);
const result = spawnSync("mkcert", ["-cert-file", cert, "-key-file", key, ...names], {
  stdio: "inherit",
});

if (result.error || result.status !== 0) {
  console.error(
    "\n✖ mkcert failed or isn't installed.\n" +
    "  Install it first (Windows: `winget install FiloSottile.mkcert` or `choco install mkcert`;\n" +
    "  macOS: `brew install mkcert`; Linux: see https://github.com/FiloSottile/mkcert),\n" +
    "  run `mkcert -install` once, then run `npm run certs` again.\n",
  );
  process.exit(1);
}
console.log(`\n✔ Wrote ${cert}\n✔ Wrote ${key}\n\nPhones must trust the mkcert root CA (see README). Find it with: mkcert -CAROOT`);
