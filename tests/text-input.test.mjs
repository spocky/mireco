// Keyboard input scenarios: the field is driven with event sequences similar
// to what Gboard / SwiftKey / Samsung Keyboard produce, and the decoded
// keycodes captured by a mock transport are compared with what the TV should
// have received.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CommandQueue } from "../js/command-queue.js";
import { TextInputController, completedPrefixLength, DEFAULT_SETTLE_MS, COMPOSITION_FLUSH_WAIT_MS } from "../js/text-input.js";
import { createTextSender } from "../js/text-sender.js";
import {
  createClock, createMockTransport, decodeKeycodes, FakeDocument, FakeField, keycodesToText,
} from "./helpers/fakes.mjs";

const DEVICE = { ok: true, host: "192.168.1.20", addressSpace: "local" };
const SETTLE = DEFAULT_SETTLE_MS;

function setup({ mode = "auto", allowNonAscii = false, failWhen, delayMs = 0, maxPending, device = DEVICE } = {}) {
  const clock = createClock();
  const doc = new FakeDocument();
  const field = doc.add(new FakeField(doc));
  field.focus();
  const transport = createMockTransport({ failWhen, delayMs });
  const queue = new CommandQueue({ send: transport.send, intervalMs: 0, ...(maxPending ? { maxPending } : {}) });
  const sender = createTextSender({ queue, getDevice: () => device, getAllowNonAscii: () => allowNonAscii });
  const commits = [];
  const commit = (text) => {
    const result = sender(text);
    commits.push({ text, accepted: result.accepted });
    return result;
  };
  const controller = new TextInputController({ field, commit, mode, timers: clock });
  const events = [];
  controller.subscribe((e) => events.push(e));
  const received = async () => {
    await queue.idle();
    return keycodesToText(decodeKeycodes(transport.urls));
  };
  return { clock, field, queue, controller, commits, events, received, transport };
}

// ---------- the two key scenarios ----------

test("h → he → hel → hello (autocomplete) → 'hello ' sends exactly 'hello '", async () => {
  const { clock, field, commits, received } = setup();
  field.composeWord("hel"); // compositionupdate h, he, hel
  clock.advance(5000); // a long pause mid-word sends nothing
  assert.deepEqual(commits, []);
  field.compositionUpdate("hello"); // suggestion picked
  field.compositionEnd();
  field.insertText(" "); // keyboard adds the space
  assert.deepEqual(commits, [], "nothing is sent before the input settles");
  clock.advance(SETTLE);
  assert.equal(await received(), "hello ");
  assert.equal(field.value, "");
});

test("same scenario without IME composition (insertReplacementText)", async () => {
  const { clock, field, received } = setup();
  field.typeChars("hel");
  clock.advance(2000);
  field.replaceRange(0, 3, "hello");
  field.typeChars(" ");
  clock.advance(SETTLE);
  assert.equal(await received(), "hello "); // not "helhello "
});

test("'hello wor' → 'hello world' (autocomplete) → Send gives exactly 'hello world'", async () => {
  const { field, controller, received } = setup();
  field.typeChars("hello ");
  field.composeWord("wor");
  field.compositionUpdate("world");
  field.compositionEnd();
  assert.equal(controller.flush(), "sent");
  assert.equal(await received(), "hello world");
  assert.equal(field.value, "");
});

test("'hello ' committed after a pause, then 'wor' → 'world' + Send", async () => {
  const { clock, field, controller, received } = setup();
  field.typeChars("hello ");
  clock.advance(SETTLE);
  assert.equal(field.value, "");
  field.typeChars("wor");
  field.replaceRange(0, 3, "world");
  controller.flush();
  assert.equal(await received(), "hello world");
});

// ---------- insertion variants ----------

test("individual characters", async () => {
  const { clock, field, received } = setup();
  field.typeChars("abc d");
  clock.advance(SETTLE);
  assert.equal(await received(), "abc ");
  assert.equal(field.value, "d");
});

test("multi-character insertion (swipe / voice)", async () => {
  const { clock, field, received } = setup();
  field.insertText("hello");
  field.insertText(" ");
  field.insertText("there my friend");
  clock.advance(SETTLE);
  assert.equal(await received(), "hello there my ");
  assert.equal(field.value, "friend");
});

test("autocorrect in the same operation as the space", async () => {
  const { clock, field, received } = setup();
  field.composeWord("teh");
  field.compositionEnd("the"); // committed corrected
  field.insertText(" ");
  clock.advance(SETTLE);
  assert.equal(await received(), "the ");
});

test("autocorrect arriving shortly after the space is still applied", async () => {
  const { clock, field, received } = setup();
  field.typeChars("teh ");
  clock.advance(SETTLE / 2);
  field.replaceRange(0, 3, "the");
  clock.advance(SETTLE);
  assert.equal(await received(), "the ");
});

test("replacing the unfinished word is a local edit", async () => {
  const { field, controller, received } = setup();
  field.typeChars("helo");
  field.replaceRange(0, 4, "hello");
  field.replaceRange(0, 5, "help");
  controller.flush();
  assert.equal(await received(), "help");
});

test("backspace inside the unfinished word", async () => {
  const { clock, field, received } = setup();
  field.typeChars("helx");
  field.backspace();
  field.typeChars("lo ");
  clock.advance(SETTLE);
  assert.equal(await received(), "hello ");
});

test("pasting several words sends completed words and keeps the last one", async () => {
  const { clock, field, controller, received } = setup();
  field.paste("one two three");
  clock.advance(SETTLE);
  assert.equal(field.value, "three");
  controller.flush();
  assert.equal(await received(), "one two three");
});

test("rapid typing while earlier words are still being sent", async () => {
  const { clock, field, controller, queue, received } = setup({ delayMs: 3 });
  field.typeChars("first ");
  clock.advance(SETTLE);
  assert.ok(queue.pendingCount > 0, "first word still queued");
  field.typeChars("second ");
  clock.advance(SETTLE);
  field.typeChars("third");
  controller.flush();
  assert.equal(await received(), "first second third");
});

// ---------- composition ----------

test("nothing is committed or cleared while a composition is active", async () => {
  const { clock, field, commits, received } = setup();
  field.typeChars("a ");
  field.composeWord("b");
  clock.advance(5000);
  assert.deepEqual(commits, []);
  assert.equal(field.value, "a b");
  field.compositionEnd();
  clock.advance(SETTLE);
  assert.equal(await received(), "a ");
  assert.equal(field.value, "b");
  assert.equal(field.selectionStart, 1, "caret stays after the unfinished word");
});

test("Send during composition waits for compositionend", async () => {
  const { clock, field, controller, commits, received } = setup();
  field.composeWord("wor");
  assert.equal(controller.flush(), "deferred");
  assert.deepEqual(commits, []);
  field.compositionUpdate("world");
  field.compositionEnd();
  clock.advance(0);
  assert.equal(await received(), "world");
});

test("Send during a composition that never ends sends the visible text after a short wait", async () => {
  const { clock, field, controller, received } = setup();
  field.composeWord("abc");
  controller.flush();
  clock.advance(COMPOSITION_FLUSH_WAIT_MS);
  assert.equal(await received(), "abc");
  assert.equal(field.value, "");
});

// ---------- whitespace, punctuation, line breaks ----------

test("multiple spaces are preserved", async () => {
  const { clock, field, received } = setup();
  field.typeChars("a   b");
  clock.advance(SETTLE);
  assert.equal(await received(), "a   ");
});

test("punctuation", async () => {
  const { clock, field, received } = setup();
  field.typeChars("Hi, you! 50% & more? #1 ");
  clock.advance(SETTLE);
  assert.equal(await received(), "Hi, you! 50% & more? #1 ");
});

test("line breaks become the enter key", async () => {
  const { clock, field, transport, received } = setup();
  field.typeChars("ok");
  field.insertText("\n", "insertLineBreak");
  clock.advance(SETTLE);
  assert.equal(await received(), "ok\n");
  assert.deepEqual(decodeKeycodes(transport.urls), ["o", "k", "enter"]);
});

// ---------- Send button ----------

test("empty input sends nothing", async () => {
  const { controller, transport } = setup();
  assert.equal(controller.flush(), "empty");
  assert.equal(transport.urls.length, 0);
});

test("repeated Send clicks don't duplicate text", async () => {
  const { field, controller, received } = setup({ mode: "compose" });
  field.typeChars("abc");
  controller.flush();
  controller.flush();
  controller.flush();
  assert.equal(await received(), "abc");
});

// ---------- modes ----------

test("Compose & Send keeps everything local until Send", async () => {
  const { clock, field, controller, commits, received } = setup({ mode: "compose" });
  field.typeChars("helo wrld and more ");
  clock.advance(10000);
  assert.deepEqual(commits, []);
  // Edit in the middle of the draft.
  field.setSelectionRange(3, 3);
  field.insertText("l");
  field.setSelectionRange(7, 7);
  field.insertText("o");
  assert.equal(field.value, "hello world and more ");
  controller.flush();
  assert.equal(await received(), "hello world and more ");
  assert.equal(field.value, "");
});

test("Compose & Send with line breaks and autocomplete", async () => {
  const { field, controller, received } = setup({ mode: "compose" });
  field.typeChars("line1\nli");
  field.replaceRange(6, 8, "line2");
  controller.flush();
  assert.equal(await received(), "line1\nline2");
});

test("switching modes never sends by itself", async () => {
  const { clock, field, controller, commits, received } = setup({ mode: "compose" });
  field.typeChars("hello world ");
  controller.setMode("auto");
  clock.advance(10000);
  assert.deepEqual(commits, []);
  field.typeChars("x"); // next edit in auto mode
  clock.advance(SETTLE);
  assert.equal(field.value, "x");
  controller.setMode("compose");
  field.typeChars(" y ");
  clock.advance(10000);
  assert.equal(await received(), "hello world ");
  assert.equal(field.value, "x y ");
});

test("auto mode defers while the caret is inside completed text", async () => {
  const { clock, field, controller, commits, received } = setup();
  field.typeChars("helo world");
  field.setSelectionRange(3, 3);
  field.insertText("l");
  clock.advance(SETTLE);
  assert.deepEqual(commits, [], "user is editing a completed word");
  controller.flush();
  assert.equal(await received(), "hello world");
});

test("committed text is cleared but the unfinished word is kept", async () => {
  const { clock, field } = setup();
  field.typeChars("hello wo");
  clock.advance(SETTLE);
  assert.equal(field.value, "wo");
  assert.equal(field.selectionStart, 2);
});

// ---------- text that can't be accepted ----------

test("unsupported characters keep the text in the field", async () => {
  const { clock, field, events, transport } = setup();
  field.typeChars("café ");
  clock.advance(SETTLE);
  assert.equal(field.value, "café ");
  assert.equal(transport.urls.length, 0);
  const rejected = events.find((e) => e.type === "rejected");
  assert.match(rejected.reason, /é/);
});

test("non-ASCII is sent when explicitly allowed", async () => {
  const { clock, field, received } = setup({ allowNonAscii: true });
  field.typeChars("café ");
  clock.advance(SETTLE);
  assert.equal(await received(), "café ");
});

test("text the queue can't accept stays in the field", async () => {
  const { field, controller, transport } = setup({ mode: "compose", maxPending: 3 });
  field.typeChars("too long");
  assert.equal(controller.flush(), "rejected");
  assert.equal(field.value, "too long");
  assert.equal(transport.urls.length, 0);
});

test("without a configured device nothing is cleared", () => {
  const { field, controller } = setup({ mode: "compose", device: { ok: false, error: "Enter your TV's IP address" } });
  field.typeChars("hi");
  assert.equal(controller.flush(), "rejected");
  assert.equal(field.value, "hi");
});

test("backspace on already-sent text is reported, not transmitted", async () => {
  const { clock, field, events, received } = setup();
  field.typeChars("hi ");
  clock.advance(SETTLE);
  field.backspace();
  clock.advance(SETTLE);
  assert.ok(events.some((e) => e.type === "edit-committed-attempt"));
  assert.equal(await received(), "hi ");
});

test("completedPrefixLength", () => {
  assert.equal(completedPrefixLength(""), 0);
  assert.equal(completedPrefixLength("word"), 0);
  assert.equal(completedPrefixLength("a b"), 2);
  assert.equal(completedPrefixLength("a b "), 4);
  assert.equal(completedPrefixLength("a\nb"), 2);
});

test("destroy() removes listeners and timers", () => {
  const { clock, field, controller, commits } = setup();
  field.typeChars("a ");
  controller.destroy();
  clock.advance(SETTLE);
  field.typeChars("b ");
  clock.advance(SETTLE);
  assert.deepEqual(commits, []);
  assert.equal(clock.pending, 0);
});
