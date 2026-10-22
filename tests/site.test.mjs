// Static-site checks (GitHub Pages under a repository subpath), settings
// persistence and the preview server's path filtering.

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createSettingsStore, DEFAULTS } from "../js/settings.js";
import { resolveRequestPath } from "../scripts/serve.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (f) => readFileSync(join(ROOT, f), "utf8");

// ---------- GitHub Pages ----------

test("index.html only uses relative local asset paths that exist", () => {
  const html = read("index.html");
  const refs = [...html.matchAll(/\b(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length > 5);
  for (const ref of refs) {
    if (/^(https?:|#|mailto:)/.test(ref)) continue;
    assert.ok(!ref.startsWith("/"), `absolute path breaks under /REPOSITORY/: ${ref}`);
    assert.ok(existsSync(join(ROOT, ref)), `missing asset ${ref}`);
  }
  assert.doesNotMatch(html, /href="javascript:/, "no javascript: links left");
  assert.doesNotMatch(html, /<iframe/, "iframe transport removed");
  assert.doesNotMatch(html, /fonts\.googleapis/, "no third-party font requests");
});

test("module imports are relative", () => {
  for (const f of ["app.js", "keyboard-panel.js", "text-sender.js", "commands.js", "transport.js"]) {
    for (const [, spec] of read("js/" + f).matchAll(/from "([^"]+)"/g)) {
      assert.ok(spec.startsWith("./"), `${f}: ${spec}`);
      assert.ok(existsSync(join(ROOT, "js", spec)), `${f}: ${spec} missing`);
    }
  }
});

test("manifest works under a repository subpath", () => {
  const manifest = JSON.parse(read("site.webmanifest"));
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  for (const icon of manifest.icons) {
    assert.ok(!icon.src.startsWith("/"));
    assert.ok(existsSync(join(ROOT, icon.src)), icon.src);
  }
});

test("inherited custom domain is removed and Jekyll is disabled", () => {
  assert.equal(existsSync(join(ROOT, "CNAME")), false);
  assert.equal(existsSync(join(ROOT, ".nojekyll")), true);
});

test("CSP only allows connections to the device API port", () => {
  const csp = /Content-Security-Policy" content="([^"]+)"/.exec(read("index.html"))[1];
  assert.match(csp, /connect-src http:\/\/\*:6095;/);
  assert.match(csp, /script-src 'self';/);
});

// ---------- settings ----------

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test("settings default to the original values", () => {
  const store = createSettingsStore({ storage: memoryStorage(), doc: null });
  const values = store.load();
  assert.equal(values.customPackage1, "com.google.android.youtube.tv");
  assert.equal(values.enableVibrator, true);
  assert.equal(values.textMode, "auto");
  assert.deepEqual(Object.keys(values).sort(), Object.keys(DEFAULTS).sort());
});

test("legacy cookies are migrated to localStorage and then expired", () => {
  const storage = memoryStorage();
  const written = [];
  const doc = {};
  Object.defineProperty(doc, "cookie", {
    get: () => "deviceIP=192.168.1.20; enableVibrator=false; bgColor=%23123456; other=1",
    set: (v) => written.push(v),
  });
  const values = createSettingsStore({ storage, doc }).load();
  assert.equal(values.deviceIP, "192.168.1.20");
  assert.equal(values.enableVibrator, false);
  assert.equal(values.bgColor, "#123456");
  assert.equal(storage.map.get("mireco.deviceIP"), "192.168.1.20");
  assert.equal(written.length, 3);
  assert.ok(written.every((c) => c.includes("expires=Thu, 01 Jan 1970")));
});

test("settings persist and are clamped", () => {
  const storage = memoryStorage();
  const store = createSettingsStore({ storage, doc: null });
  store.load();
  assert.equal(store.update({ textMode: "compose", keyIntervalMs: "5000", allowNonAscii: true, unknown: 1 }), true);
  const reloaded = createSettingsStore({ storage, doc: null }).load();
  assert.equal(reloaded.textMode, "compose");
  assert.equal(reloaded.keyIntervalMs, 1000);
  assert.equal(reloaded.allowNonAscii, true);
  assert.equal("unknown" in reloaded, false);
});

test("settings still work when storage throws", () => {
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const store = createSettingsStore({ storage, doc: null });
  store.load();
  assert.equal(store.update({ deviceIP: "10.0.0.2" }), false);
  assert.equal(store.get("deviceIP"), "10.0.0.2");
  assert.equal(store.persistent, false);
});

// ---------- preview server ----------

test("preview server serves site files only", () => {
  assert.equal(resolveRequestPath(ROOT, "/"), join(ROOT, "index.html"));
  assert.equal(resolveRequestPath(ROOT, "/js/app.js?v=1"), join(ROOT, "js", "app.js"));
  assert.equal(resolveRequestPath(ROOT, "/site.webmanifest"), join(ROOT, "site.webmanifest"));
  for (const blocked of [
    "/.git/config", "/.gitignore", "/certs/dev-key.pem", "/node_modules/x.js", "/package.json",
    "/scripts/serve.mjs", "/tests/site.test.mjs", "/../secret.html", "/%2e%2e/secret.html",
    "/js/..%5C..%5Csecret.html", "/LICENSE", "/missing.html", "/%E0%A4%A",
  ]) {
    assert.equal(resolveRequestPath(ROOT, blocked), null, blocked);
  }
});
