// Hidden key tester: unlock gesture and sending raw key names.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CommandQueue } from "../js/command-queue.js";
import { createKeyboardPanel, TAP_WINDOW_MS, UNLOCK_TAPS } from "../js/keyboard-panel.js";
import { TESTER_SUGGESTIONS } from "../js/key-tester.js";
import { createMockTransport, createPanelDom } from "./helpers/fakes.mjs";

function setup({ failWhen, device = { ok: true, host: "192.168.1.20", addressSpace: "local" } } = {}) {
  const doc = createPanelDom();
  const transport = createMockTransport({ failWhen });
  const queue = new CommandQueue({ send: transport.send, intervalMs: 0 });
  const store = { textMode: "compose", allowNonAscii: false };
  const updates = [];
  let clock = 1000;
  const panel = createKeyboardPanel({
    doc,
    queue,
    getDevice: () => device,
    settings: { get: (k) => store[k], update: (p) => (updates.push(p), Object.assign(store, p), true) },
    explainError: async () => "Couldn't reach the TV.",
    vibrate: () => {},
    now: () => clock,
  });
  const el = (id) => doc.getElementById(id);
  const tap = (times, gap = 100) => {
    for (let i = 0; i < times; i++) {
      clock += gap;
      el("keyboardTitle").click();
    }
  };
  const pause = (ms) => (clock += ms);
  const keycodes = async () => {
    await queue.idle();
    await new Promise((r) => setTimeout(r, 0));
    return transport.urls.map((u) => new URL(u).searchParams.get("keycode"));
  };
  const selectMode = (value) => {
    const radio = el("keyboardPanel").children.find((c) => c.value === value);
    for (const r of el("keyboardPanel").children.filter((c) => c.name === "textMode")) r.checked = r === radio;
    radio.dispatchEvent(new Event("change"));
  };
  const logResults = () => el("testerLog").children.map((li) => [li.querySelector(".when") ? li.children[1].textContent : "", li.dataset.state, li.querySelector(".result").textContent]);
  return { doc, el, panel, queue, transport, updates, tap, pause, keycodes, selectMode, logResults };
}

test("the key tester is hidden until the title is tapped 8 times in a row", () => {
  const { el, panel, tap } = setup();
  assert.equal(UNLOCK_TAPS, 8);
  assert.equal(el("testerModeOption").hidden, true);
  tap(7);
  assert.equal(el("testerModeOption").hidden, true);
  tap(1);
  assert.equal(el("testerModeOption").hidden, false);
  assert.equal(panel.testerUnlocked, true);
  assert.ok(el("keyboardPanel").querySelector(".segmented").classList.contains("has-tester"));
  assert.equal(panel.mode, "compose", "unlocking only reveals the option");
});

test("a pause resets the tap count", () => {
  const { el, tap, pause } = setup();
  tap(5);
  pause(TAP_WINDOW_MS + 1);
  tap(3); // 5 + 3 but not in a row
  assert.equal(el("testerModeOption").hidden, true);
  tap(5, TAP_WINDOW_MS + 1); // slow taps never add up
  assert.equal(el("testerModeOption").hidden, true);
  tap(5); // 1 (from the last slow tap) + ... completes 8 quick taps in a row only now
  tap(2);
  assert.equal(el("testerModeOption").hidden, false);
});

test("extra taps don't count toward the next toggle and 8 more hide it again", () => {
  const { el, panel, tap, pause, selectMode } = setup();
  tap(8);
  selectMode("tester");
  assert.equal(panel.mode, "tester");
  tap(3); // stray taps right after unlocking
  pause(TAP_WINDOW_MS + 1);
  tap(8);
  assert.equal(el("testerModeOption").hidden, true);
  assert.equal(panel.mode, "compose", "hiding the tester returns to the saved text mode");
  assert.equal(el("keyboardPanel").dataset.mode, "compose");
});

test("tester mode switches the panel UI and is never saved as the text mode", () => {
  const { el, panel, tap, selectMode, updates, doc } = setup();
  tap(8);
  selectMode("tester");
  assert.equal(el("keyboardPanel").dataset.mode, "tester");
  assert.match(el("modeHint").textContent, /^Key tester/);
  assert.equal(doc.activeElement, el("testerKey"));
  assert.deepEqual(updates, []);
  selectMode("auto");
  assert.equal(panel.mode, "auto");
  assert.deepEqual(updates, [{ textMode: "auto" }]);
});

test("sends the key name verbatim as one keyevent and logs the result", async () => {
  const { el, tap, selectMode, keycodes, logResults, transport } = setup();
  tap(8);
  selectMode("tester");
  el("testerKey").value = "  wakeup ";
  el("testerSend").click();
  el("testerKey").value = "KEYCODE_DEL";
  el("testerKey").dispatchEvent(Object.assign(new Event("keydown"), { key: "Enter", preventDefault() {} }));
  el("testerKey").value = "a&b c";
  el("testerSend").click();
  assert.deepEqual(await keycodes(), ["wakeup", "KEYCODE_DEL", "a&b c"]);
  assert.ok(transport.urls[2].endsWith("keycode=a%26b%20c"), transport.urls[2]);
  const log = logResults();
  assert.deepEqual(log.map((l) => l[0]), ["a&b c", "KEYCODE_DEL", "wakeup"], "newest first");
  assert.ok(log.every((l) => l[1] === "sent" && /TV answered/.test(l[2])));
});

test("empty input sends nothing; suggestion chips send immediately", async () => {
  const { el, tap, selectMode, keycodes } = setup();
  tap(8);
  selectMode("tester");
  el("testerKey").value = "   ";
  el("testerSend").click();
  const chip = el("testerChips").children.find((c) => c.textContent === "mute");
  chip.click();
  assert.equal(el("testerKey").value, "mute");
  assert.deepEqual(await keycodes(), ["mute"]);
  assert.ok(TESTER_SUGGESTIONS.includes("wakeup") && TESTER_SUGGESTIONS.includes("del"));
});

test("failures are logged with an explanation and never retried", async () => {
  const { el, tap, selectMode, keycodes, logResults, transport } = setup({ failWhen: () => true });
  tap(8);
  selectMode("tester");
  el("testerKey").value = "sleep";
  el("testerSend").click();
  await keycodes();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(transport.urls.length, 1);
  const [entry] = logResults();
  assert.equal(entry[1], "failed");
  assert.match(entry[2], /^Failed: Couldn't reach the TV\./);
});

test("without a device the tester explains instead of sending", () => {
  const { el, tap, selectMode, logResults, transport } = setup({ device: { ok: false, error: "no ip" } });
  tap(8);
  selectMode("tester");
  el("testerKey").value = "wakeup";
  el("testerSend").click();
  assert.equal(transport.urls.length, 0);
  assert.match(logResults()[0][2], /IP address in Settings/);
});

test("the log keeps only the latest entries", async () => {
  const { el, tap, selectMode, keycodes } = setup();
  tap(8);
  selectMode("tester");
  for (let i = 0; i < 20; i++) {
    el("testerKey").value = `k${i}`;
    el("testerSend").click();
  }
  await keycodes();
  assert.equal(el("testerLog").children.length, 12);
});
