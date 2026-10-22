import { test } from "node:test";
import assert from "node:assert/strict";

import {
  APPS, INPUTS, describeButton, findApp, findInput, formatIconSetting,
  isValidPackageName, normalizeIconText, parseIconSetting, searchApps,
} from "../js/apps.js";
import { customButtonParams } from "../js/commands.js";

test("catalog entries are unique, valid and renderable", () => {
  const ids = new Set();
  const packages = new Set();
  for (const app of APPS) {
    assert.ok(!ids.has(app.id), `duplicate id ${app.id}`);
    assert.ok(!packages.has(app.package), `duplicate package ${app.package}`);
    ids.add(app.id);
    packages.add(app.package);
    assert.ok(isValidPackageName(app.package), app.package);
    assert.match(app.bg, /^#[0-9a-f]{3,6}$/i);
    assert.match(app.fg, /^#[0-9a-f]{3,6}$/i);
    assert.ok(app.svg.length > 10 && !/<script|on\w+=/i.test(app.svg), app.id);
  }
  assert.ok(APPS.length >= 15);
});

test("existing defaults are recognised apps", () => {
  assert.equal(findApp("com.google.android.youtube.tv").name, "YouTube");
  assert.equal(findApp("com.spocky.projengmenu").name, "Projectivy Launcher");
  assert.equal(findApp("  com.netflix.ninja ").name, "Netflix");
  assert.equal(findApp("com.unknown.app"), null);
});

test("package name validation", () => {
  for (const ok of ["com.netflix.ninja", "tv.pluto.android", "org.xbmc.kodi", "a.b", "com.my_app.v2"]) {
    assert.equal(isValidPackageName(ok), true, ok);
  }
  for (const bad of ["", "netflix", "com..app", ".com.app", "com.app.", "com.1app", "com app.x", "com.app/x", "HDMI1"]) {
    assert.equal(isValidPackageName(bad), false, bad);
  }
});

test("HDMI inputs are recognised case-insensitively and keep their command", () => {
  assert.equal(findInput("hdmi2").value, "HDMI2");
  assert.equal(INPUTS.length, 3);
  const info = describeButton("hdmi1");
  assert.equal(info.kind, "input");
  assert.equal(info.action, "Switch to HDMI 1");
  assert.deepEqual(info.icon, { type: "input", number: "1" });
  assert.deepEqual(customButtonParams(info.value), { action: "changesource", source: "hdmi1" });
});

test("icon settings round-trip and reject junk", () => {
  assert.deepEqual(parseIconSetting(""), { type: "auto" });
  assert.deepEqual(parseIconSetting("glyph:movie"), { type: "glyph", id: "movie" });
  assert.deepEqual(parseIconSetting("glyph:nope"), { type: "auto" });
  assert.deepEqual(parseIconSetting("text:abcdef"), { type: "text", text: "abc" });
  assert.deepEqual(parseIconSetting("text:   "), { type: "auto" });
  assert.equal(formatIconSetting({ type: "glyph", id: "music" }), "glyph:music");
  assert.equal(formatIconSetting({ type: "text", text: " TV+ " }), "text:TV+");
  assert.equal(formatIconSetting({ type: "auto" }), "");
  assert.equal(normalizeIconText("😀😀😀😀"), "😀😀😀", "counts code points, not UTF-16 units");
});

test("describeButton picks the right icon", () => {
  assert.equal(describeButton(""), null);
  assert.equal(describeButton("   "), null);

  const netflix = describeButton("com.netflix.ninja");
  assert.equal(netflix.kind, "app");
  assert.equal(netflix.action, "Open Netflix");
  assert.equal(netflix.icon.type, "brand");
  assert.equal(netflix.icon.app.id, "netflix");

  // A known app can still get a custom icon.
  assert.deepEqual(describeButton("com.netflix.ninja", "glyph:star").icon, { type: "glyph", id: "star" });

  const custom = describeButton("com.example.mediacenter");
  assert.equal(custom.kind, "custom");
  assert.equal(custom.name, "Mediacenter");
  assert.deepEqual(custom.icon, { type: "glyph", id: "apps" });
  assert.deepEqual(describeButton("com.example.mediacenter", "text:MC").icon, { type: "text", text: "MC" });
});

test("search matches names and package names", () => {
  assert.deepEqual(searchApps("tube").map((a) => a.id).sort(), ["smarttube", "youtube", "youtube-kids", "youtube-music"]);
  assert.deepEqual(searchApps("NINJA").map((a) => a.id), ["netflix"]);
  assert.equal(searchApps("").length, APPS.length);
  assert.deepEqual(searchApps("hdmi 2", INPUTS).map((i) => i.id), ["hdmi2"]);
});
