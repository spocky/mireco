// Keyboard panel behaviour with a minimal fake DOM (no browser needed).

import { test } from "node:test";
import assert from "node:assert/strict";

import { CommandQueue } from "../js/command-queue.js";
import { createKeyboardPanel } from "../js/keyboard-panel.js";
import { createMockTransport, createPanelDom, decodeKeycodes, keycodesToText } from "./helpers/fakes.mjs";

function setup({ textMode = "compose", failWhen, delayMs = 0 } = {}) {
  const doc = createPanelDom();
  const transport = createMockTransport({ failWhen, delayMs });
  const queue = new CommandQueue({ send: transport.send, intervalMs: 0 });
  const store = { textMode, allowNonAscii: false };
  const updates = [];
  const settings = {
    get: (k) => store[k],
    update: (patch) => (updates.push(patch), Object.assign(store, patch), true),
  };
  let vibrations = 0;
  let opened = 0;
  const panel = createKeyboardPanel({
    doc,
    queue,
    getDevice: () => ({ ok: true, host: "192.168.1.20", addressSpace: "local" }),
    settings,
    explainError: async () => "Couldn't reach the TV.",
    vibrate: () => vibrations++,
    onOpen: () => opened++,
  });
  const el = (id) => doc.getElementById(id);
  const received = async () => {
    await queue.idle();
    return keycodesToText(decodeKeycodes(transport.urls));
  };
  return { doc, el, panel, queue, transport, updates, received, get vibrations() { return vibrations; }, get opened() { return opened; } };
}

test("opens, focuses the field and closes back to the button", () => {
  const { doc, el, panel } = setup();
  assert.equal(el("keyboardPanel").hidden, true);
  el("keyboardButton").click();
  assert.equal(panel.isOpen(), true);
  assert.equal(el("keyboardPanel").hidden, false);
  assert.equal(el("keyboardButton").getAttribute("aria-expanded"), "true");
  assert.equal(doc.activeElement, el("textEntry"));
  el("keyboardClose").click();
  assert.equal(el("keyboardPanel").hidden, true);
  assert.equal(el("keyboardButton").getAttribute("aria-expanded"), "false");
  assert.equal(doc.activeElement, el("keyboardButton"));
});

test("Escape closes the panel", () => {
  const { el, panel } = setup();
  panel.open();
  const e = new Event("keydown", { cancelable: true });
  Object.defineProperty(e, "key", { value: "Escape" });
  el("keyboardPanel").dispatchEvent(e);
  assert.equal(panel.isOpen(), false);
});

test("closing keeps the draft and flags it on the keyboard button", () => {
  const { el, panel } = setup();
  panel.open();
  el("textEntry").typeChars("unsent draft");
  panel.close();
  assert.equal(el("textEntry").value, "unsent draft");
  assert.equal(el("keyboardBadge").hidden, false);
  panel.open();
  assert.equal(el("textEntry").value, "unsent draft");
  assert.equal(el("textEntry").selectionStart, "unsent draft".length);
});

test("repeated open/close doesn't duplicate listeners or transmissions", async () => {
  const { el, panel, received } = setup();
  for (let i = 0; i < 5; i++) {
    el("keyboardButton").click();
    el("keyboardButton").click();
  }
  panel.open();
  el("textEntry").typeChars("once");
  el("textSend").click();
  assert.equal(await received(), "once");
});

test("Send vibrates once for the whole text, not per character", async () => {
  const ctx = setup();
  ctx.panel.open();
  ctx.el("textEntry").typeChars("a long sentence to type");
  ctx.el("textSend").click();
  await ctx.received();
  assert.equal(ctx.vibrations, 1);
});

test("Send is disabled for an empty draft and repeated clicks don't duplicate", async () => {
  const { el, panel, received } = setup();
  panel.open();
  assert.equal(el("textSend").disabled, true);
  el("textEntry").typeChars("abc");
  assert.equal(el("textSend").disabled, false);
  el("textSend").click();
  el("textSend").click();
  assert.equal(await received(), "abc");
  assert.equal(el("textEntry").value, "");
  assert.match(el("textStatus").textContent, /Done: 3 keys sent/);
  assert.match(el("textStatus").textContent, /doesn't confirm/);
});

test("mode switch is persisted and updates the explanation", () => {
  const { doc, el, panel, updates } = setup({ textMode: "auto" });
  panel.open();
  assert.match(el("modeHint").textContent, /^Auto words/);
  const compose = doc.getElementById("keyboardPanel").children.find((c) => c.value === "compose");
  compose.checked = true;
  compose.dispatchEvent(new Event("change"));
  assert.deepEqual(updates.at(-1), { textMode: "compose" });
  assert.equal(panel.controller.mode, "compose");
  assert.match(el("modeHint").textContent, /^Compose & Send/);
});

test("Clear empties the draft without sending", async () => {
  const { el, panel, transport } = setup();
  panel.open();
  el("textEntry").typeChars("discard me");
  el("textClear").click();
  assert.equal(el("textEntry").value, "");
  assert.equal(transport.urls.length, 0);
});

test("Stop cancels queued text and offers it back", async () => {
  const { el, panel, queue, received } = setup({ delayMs: 5 });
  panel.open();
  el("textEntry").typeChars("abcdefgh");
  el("textSend").click();
  assert.equal(el("textStop").hidden, false);
  el("textStop").click();
  const sent = await received();
  assert.equal(queue.pendingCount, 0);
  assert.equal(el("recovery").hidden, false);
  const notSent = /Not sent: “(.*)”/.exec(el("recoveryText").textContent)[1];
  assert.equal(sent + notSent, "abcdefgh");
  el("textEntry").typeChars("XY");
  el("recoveryRestore").click();
  assert.equal(el("textEntry").value, notSent + "XY");
  assert.equal(el("recovery").hidden, true);
});

test("a failed key stops the text, keeps the rest recoverable and never resends", async () => {
  let failures = 0;
  const { el, panel, transport, queue } = setup({
    failWhen: (c) => c.token?.char === "l" && failures++ === 0,
  });
  panel.open();
  el("textEntry").typeChars("hello world");
  el("textSend").click();
  await queue.idle();
  await new Promise((r) => setTimeout(r, 0)); // explanation is async
  assert.deepEqual(decodeKeycodes(transport.urls), ["h", "e", "l"]);
  assert.equal(el("textStatus").dataset.state, "error");
  assert.equal(el("keyboardBadge").textContent, "!");
  const text = el("recoveryText").textContent;
  assert.match(text, /Not sent: “llo world”/);
  assert.match(text, /“l” may or may not have reached the TV/);
  // Explicit retry of the remaining portion.
  el("recoveryRestore").click();
  assert.equal(el("textEntry").value, "llo world");
  el("textSend").click();
  await queue.idle();
  assert.equal(keycodesToText(decodeKeycodes(transport.urls)), "helllo world");
});

test("auto mode clears committed words while the panel is open", async () => {
  const { el, panel, received } = setup({ textMode: "auto" });
  panel.open();
  el("textEntry").typeChars("hello wo");
  panel.controller.commitCompletedWords();
  assert.equal(el("textEntry").value, "wo");
  assert.equal(await received(), "hello ");
});
