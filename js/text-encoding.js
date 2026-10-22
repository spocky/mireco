// Text → GiTV key events.
//
// The GiTV "keyevent" action accepts either a key name ("enter", "back", ...)
// or a single character. Literal text is always sent one code point per
// request, so a typed word such as "enter" becomes e,n,t,e,r and can never be
// confused with the multi-letter key names.
//
// What is known to work is printable ASCII. Everything else is uncertain on
// GiTV firmware and is rejected (never silently dropped or substituted) unless
// the user opts in to the experimental non-ASCII mode.

// Special characters that map to a GiTV key name rather than a literal.
export const SPECIAL_TEXT_KEYS = Object.freeze({
  "\n": "enter",
});

const PRINTABLE_ASCII = /^[\x20-\x7e]$/;
// Letters, numbers, punctuation and symbols from the BMP. Emoji and
// other astral characters, controls, combining marks and format characters
// (ZWJ, variation selectors, ...) stay unsupported even in experimental mode.
const EXTENDED_CHAR = /^[\p{L}\p{N}\p{P}\p{S} ]$/u;

function describe(char) {
  const cp = char.codePointAt(0);
  const hex = "U+" + cp.toString(16).toUpperCase().padStart(4, "0");
  if (char === "\t") return "tab";
  if (cp < 0x20 || cp === 0x7f) return `control character ${hex}`;
  return `"${char}" (${hex})`;
}

/**
 * Converts text into an ordered list of key tokens.
 *
 * @param {string} text
 * @param {{allowNonAscii?: boolean}} [options]
 * @returns {{tokens: {char: string, keycode: string, special: boolean}[],
 *            unsupported: {char: string, index: number, description: string}[]}}
 *   `index` is the UTF-16 offset in the normalised text.
 */
export function encodeText(text, { allowNonAscii = false } = {}) {
  // Line endings → "\n"; NFC so "e" + combining acute becomes a single "é".
  const normalized = String(text).replace(/\r\n?/g, "\n").normalize("NFC");
  const tokens = [];
  const unsupported = [];
  let index = 0;
  for (const char of normalized) { // iterates code points, not UTF-16 units
    if (Object.hasOwn(SPECIAL_TEXT_KEYS, char)) {
      tokens.push({ char, keycode: SPECIAL_TEXT_KEYS[char], special: true });
    } else if (PRINTABLE_ASCII.test(char)) {
      tokens.push({ char, keycode: char, special: false });
    } else if (allowNonAscii && char.codePointAt(0) <= 0xffff && EXTENDED_CHAR.test(char)) {
      tokens.push({ char, keycode: char, special: false });
    } else {
      unsupported.push({ char, index, description: describe(char) });
    }
    index += char.length;
  }
  return { tokens, unsupported };
}

/** Rebuilds the text represented by tokens (used to restore unsent text). */
export function tokensToText(tokens) {
  return tokens.map((t) => t.char).join("");
}
