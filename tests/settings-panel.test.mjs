import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { GLYPHS } from "../js/apps.js";
import { changedKeys, normalizeColor } from "../js/settings-panel.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

test("every generic icon and UI icon exists in the sprite", () => {
  for (const id of [...GLYPHS.map((g) => g.id), "add", "home", "search", "delete", "chevron"]) {
    assert.match(html, new RegExp(`<symbol id="i-${id}"`), id);
  }
});

test("settings dirty check ignores color notation", () => {
  assert.equal(normalizeColor("#FFF"), "#ffffff");
  assert.equal(normalizeColor("#333333"), "#333333");
  assert.deepEqual(changedKeys({ bgColor: "#333333", btColor: "#FFFFFF", keyIntervalMs: 80 }, { bgColor: "#333", btColor: "#fff", keyIntervalMs: "80" }), []);
  assert.deepEqual(changedKeys({ customPackage1: "com.netflix.ninja", enableVibrator: false }, { customPackage1: "", enableVibrator: true }), ["customPackage1", "enableVibrator"]);
});
