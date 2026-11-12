import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildSite, referencedAssets } from "../scripts/build.mjs";
import { resolveRequestPath } from "../scripts/serve.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

function tempDir() {
  return mkdtempSync(join(tmpdir(), "mireco-build-"));
}

test("build contains the site and nothing else", () => {
  const base = tempDir();
  try {
    const out = join(base, "site");
    const result = buildSite({ out });
    assert.equal(result.out, out);
    for (const f of ["index.html", "site.webmanifest", "jscolor.js", "LICENSE", "css/style.css", "js/app.js", "js/theme-boot.js", "apple-touch-icon.png"]) {
      assert.ok(existsSync(join(out, f)), f);
    }
    const top = readdirSync(out);
    for (const dev of ["scripts", "tests", "docs", "deploy", "package.json", "README.md", "certs", "node_modules", "Dockerfile", "CNAME"]) {
      assert.ok(!top.includes(dev), `${dev} must not be deployed`);
    }
    // Every asset the page, manifest and modules reference is present.
    const refs = referencedAssets(out);
    assert.ok(refs.includes("js/app.js") && refs.includes("js/apps.js") && refs.includes("android-chrome-192x192.png"));
    for (const ref of refs) assert.ok(existsSync(join(out, ref)), ref);
    // The built copy is byte-identical to the source.
    assert.equal(readFileSync(join(out, "js", "app.js"), "utf8"), readFileSync(join(ROOT, "js", "app.js"), "utf8"));
    // And the server can serve it as a root.
    assert.equal(resolveRequestPath(out, "/"), join(out, "index.html"));
    assert.equal(resolveRequestPath(out, "/.mireco-build"), null);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("rebuilding replaces a previous build", () => {
  const base = tempDir();
  try {
    const out = join(base, "site");
    buildSite({ out });
    writeFileSync(join(out, "stale.txt"), "old");
    buildSite({ out });
    assert.equal(existsSync(join(out, "stale.txt")), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("build refuses to wipe folders it didn't create", () => {
  const base = tempDir();
  try {
    const other = join(base, "important");
    mkdirSync(other);
    writeFileSync(join(other, "keep.txt"), "data");
    assert.throws(() => buildSite({ out: other }), /isn't empty/);
    assert.equal(readFileSync(join(other, "keep.txt"), "utf8"), "data");
    assert.throws(() => buildSite({ out: ROOT }), /Refusing/);
    assert.throws(() => buildSite({ out: resolve(ROOT, "..") }), /Refusing/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("the dev preview doesn't expose build output or deployment files", () => {
  for (const path of ["/dist/index.html", "/deploy/nginx.conf"]) {
    assert.equal(resolveRequestPath(ROOT, path), null, path);
  }
});
