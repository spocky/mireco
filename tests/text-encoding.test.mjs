import { test } from "node:test";
import assert from "node:assert/strict";

import { encodeText, tokensToText } from "../js/text-encoding.js";

const keycodes = (text, opts) => encodeText(text, opts).tokens.map((t) => t.keycode);

test("preserves order and case", () => {
  assert.deepEqual(keycodes("Hello"), ["H", "e", "l", "l", "o"]);
});

test("spaces are kept, including consecutive ones", () => {
  assert.deepEqual(keycodes("a  b "), ["a", " ", " ", "b", " "]);
});

test("punctuation and reserved URL characters are literal characters", () => {
  assert.deepEqual(keycodes("a&b+c?d#e%f.,!"), ["a", "&", "b", "+", "c", "?", "d", "#", "e", "%", "f", ".", ",", "!"]);
});

test("line breaks map to the enter key; CRLF counts once", () => {
  const { tokens } = encodeText("a\r\nb\nc\rd");
  assert.deepEqual(tokens.map((t) => t.keycode), ["a", "enter", "b", "enter", "c", "enter", "d"]);
  assert.equal(tokens[1].special, true);
});

test("words that look like key names are typed letter by letter", () => {
  assert.deepEqual(keycodes("enter back home"), [..."enter back home"]);
  assert.ok(encodeText("back").tokens.every((t) => !t.special));
});

test("empty text produces no commands", () => {
  assert.deepEqual(encodeText(""), { tokens: [], unsupported: [] });
});

test("unsupported characters are reported, never dropped or substituted", () => {
  const { tokens, unsupported } = encodeText("ok 👍 café\t!");
  assert.deepEqual(unsupported.map((u) => u.char), ["👍", "é", "\t"]);
  assert.equal(unsupported[0].index, 3);
  assert.match(unsupported[0].description, /U\+1F44D/);
  assert.equal(unsupported[2].description, "tab");
  assert.equal(tokens.map((t) => t.char).join(""), "ok  caf!"); // callers must not send when unsupported.length > 0
});

test("emoji are treated as one code point, not two surrogate halves", () => {
  const { unsupported } = encodeText("😀");
  assert.equal(unsupported.length, 1);
  assert.equal(unsupported[0].char, "😀");
});

test("experimental non-ASCII mode allows BMP letters but not emoji or combining marks", () => {
  assert.deepEqual(keycodes("ñandú", { allowNonAscii: true }), ["ñ", "a", "n", "d", "ú"]);
  // NFC composes e + U+0301 into a single é.
  assert.deepEqual(keycodes("é", { allowNonAscii: true }), ["é"]);
  assert.equal(encodeText("😀", { allowNonAscii: true }).unsupported.length, 1);
  assert.equal(encodeText("a‍b", { allowNonAscii: true }).unsupported.length, 1); // zero-width joiner
  assert.equal(encodeText("कि", { allowNonAscii: true }).unsupported.length, 1); // Devanagari vowel sign (combining)
});

test("tokensToText rebuilds the original text", () => {
  const text = "Hi there!\nNext line";
  assert.equal(tokensToText(encodeText(text).tokens), text);
});
