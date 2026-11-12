// Typing with Android key names / numbers instead of raw characters.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CommandQueue } from "../js/command-queue.js";
import { createKeyboardPanel } from "../js/keyboard-panel.js";
import { createSettingsStore } from "../js/settings.js";
import { androidKeycode, deleteKeycode, encodeText, tokensToText } from "../js/text-encoding.js";
import { createTextSender } from "../js/text-sender.js";
import { createMockTransport, createPanelDom, decodeKeycodes } from "./helpers/fakes.mjs";

const codes = (text, keyFormat) => encodeText(text, { keyFormat }).tokens.map((t) => t.keycode);

test("lowercase letters, digits and space use Android key names or numbers", () => {
  assert.deepEqual(codes("ab z", "name"), ["KEYCODE_A", "KEYCODE_B", "KEYCODE_SPACE", "KEYCODE_Z"]);
  assert.deepEqual(codes("ab z", "number"), ["29", "30", "62", "54"]);
  assert.deepEqual(codes("0129", "number"), ["7", "8", "9", "16"]);
  assert.deepEqual(codes("0", "name"), ["KEYCODE_0"]);
});

test("capitals and shifted symbols are Shift followed by the key", () => {
  assert.deepEqual(codes("Hi!", "name"), ["KEYCODE_SHIFT_LEFT", "KEYCODE_H", "KEYCODE_I", "KEYCODE_SHIFT_LEFT", "KEYCODE_1"]);
  assert.deepEqual(codes("A?", "number"), ["59", "29", "59", "76"]);
  const { tokens } = encodeText("Hi!", { keyFormat: "name" });
  assert.equal(tokens[0].modifier, true);
  assert.equal(tokensToText(tokens), "Hi!", "Shift adds no text, so unsent text restores correctly");
});

test("every printable ASCII character has a key in the Android formats", () => {
  let all = "";
  for (let c = 0x20; c <= 0x7e; c++) all += String.fromCharCode(c);
  for (const format of ["name", "number"]) {
    const { tokens, unsupported } = encodeText(all, { keyFormat: format });
    assert.deepEqual(unsupported, [], format);
    assert.equal(tokensToText(tokens), all);
    for (const t of tokens) {
      if (format === "number") assert.match(t.keycode, /^\d+$/);
      else assert.match(t.keycode, /^KEYCODE_[A-Z0-9_]+$/);
    }
  }
});

test("punctuation maps to the right Android keys", () => {
  const map = { ".": "PERIOD", ",": "COMMA", "-": "MINUS", "@": "AT", "/": "SLASH", "#": "POUND", "*": "STAR", "+": "PLUS", "(": "NUMPAD_LEFT_PAREN" };
  for (const [char, key] of Object.entries(map)) assert.deepEqual(codes(char, "name"), [`KEYCODE_${key}`], char);
  assert.deepEqual(codes("._", "number"), ["56", "59", "69"]);
});

test("line breaks stay the named enter key in every format", () => {
  for (const format of ["char", "name", "number"]) assert.deepEqual(codes("a\nb", format).filter((k) => k === "enter"), ["enter"], format);
});

test("non-ASCII is unsupported in the Android formats even when allowed", () => {
  const { unsupported } = encodeText("café", { keyFormat: "name", allowNonAscii: true });
  assert.deepEqual(unsupported.map((u) => u.char), ["é"]);
  assert.deepEqual(encodeText("café", { keyFormat: "char", allowNonAscii: true }).unsupported, []);
});

test("the char format is unchanged", () => {
  assert.deepEqual(codes("Hi a!", "char"), ["H", "i", " ", "a", "!"]);
  assert.deepEqual(codes("Hi a!"), ["H", "i", " ", "a", "!"]);
});

test("delete key per format", () => {
  assert.equal(deleteKeycode("char"), null);
  assert.equal(deleteKeycode("name"), "KEYCODE_DEL");
  assert.equal(deleteKeycode("number"), "67");
  assert.equal(androidKeycode("SPACE", "number"), "62");
});

test("the text sender uses the configured format", async () => {
  const transport = createMockTransport();
  const queue = new CommandQueue({ send: transport.send, intervalMs: 0 });
  let format = "number";
  const send = createTextSender({ queue, getDevice: () => ({ ok: true, host: "10.0.0.2", addressSpace: "local" }), getKeyFormat: () => format });
  assert.equal(send("ok").accepted, true);
  format = "name";
  send("Z");
  await queue.idle();
  assert.deepEqual(decodeKeycodes(transport.urls), ["43", "39", "KEYCODE_SHIFT_LEFT", "KEYCODE_Z"]);
});

test("the key format setting is stored and validated", () => {
  const map = new Map();
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
  const store = createSettingsStore({ storage, doc: null });
  assert.equal(store.load().textKeyFormat, "char");
  store.update({ textKeyFormat: "number" });
  assert.equal(createSettingsStore({ storage, doc: null }).load().textKeyFormat, "number");
  store.update({ textKeyFormat: "morse" });
  assert.equal(store.get("textKeyFormat"), "char");
});

// ---------- keyboard panel: Delete button and backspace forwarding ----------

function panelSetup({ textMode = "auto", textKeyFormat = "name" } = {}) {
  const doc = createPanelDom();
  const transport = createMockTransport();
  const queue = new CommandQueue({ send: transport.send, intervalMs: 0 });
  const store = { textMode, allowNonAscii: false, textKeyFormat };
  const panel = createKeyboardPanel({
    doc,
    queue,
    getDevice: () => ({ ok: true, host: "192.168.1.20", addressSpace: "local" }),
    settings: { get: (k) => store[k], update: (p) => Object.assign(store, p) },
    explainError: async () => "x",
    vibrate: () => {},
  });
  const el = (id) => doc.getElementById(id);
  const sent = async () => {
    await queue.idle();
    return decodeKeycodes(transport.urls);
  };
  return { el, panel, store, sent };
}

test("Delete button appears only for the Android formats and sends the delete key", async () => {
  const charPanel = panelSetup({ textKeyFormat: "char" });
  assert.equal(charPanel.el("textDelete").hidden, true);

  const { el, panel, sent } = panelSetup({ textKeyFormat: "number" });
  panel.open();
  assert.equal(el("textDelete").hidden, false);
  el("textDelete").click();
  el("textDelete").click();
  assert.deepEqual(await sent(), ["67", "67"]);
});

test("Auto words: backspace in an empty field deletes on the TV, once per keystroke", async () => {
  const { el, panel, sent } = panelSetup({ textMode: "auto", textKeyFormat: "name" });
  panel.open();
  const field = el("textEntry");
  // Android keyboards: a Backspace key event, then (in some browsers) a beforeinput.
  field.dispatchEvent(Object.assign(new Event("keydown"), { key: "Backspace" }));
  field.backspace();
  await new Promise((r) => setTimeout(r, 5));
  field.backspace(); // second keystroke
  assert.deepEqual(await sent(), ["KEYCODE_DEL", "KEYCODE_DEL"]);
});

test("Compose & Send and the char format keep the warning instead of deleting", async () => {
  const compose = panelSetup({ textMode: "compose", textKeyFormat: "name" });
  compose.panel.open();
  compose.el("textEntry").backspace();
  assert.deepEqual(await compose.sent(), []);
  assert.match(compose.el("textStatus").textContent, /can't be deleted/);

  const chars = panelSetup({ textMode: "auto", textKeyFormat: "char" });
  chars.panel.open();
  chars.el("textEntry").backspace();
  assert.deepEqual(await chars.sent(), []);
  assert.match(chars.el("textStatus").textContent, /Android key format/);
});
