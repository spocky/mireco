// Text → GiTV key events.
//
// The GiTV "keyevent" action accepts a key name ("enter", "back", ...) and,
// on some firmware, a single character. Literal text is always sent one key
// per request, so a typed word such as "enter" becomes e,n,t,e,r and can never
// be confused with the multi-letter key names.
//
// Firmware differs in how (or whether) it accepts letters, so the key format
// is selectable:
//   "char"   the character itself (keycode=a), as documented for GiTV 1.3.97;
//   "name"   Android key names (keycode=KEYCODE_A);
//   "number" Android key code numbers (keycode=29).
// The Android formats press physical-keyboard keys: capitals and shifted
// symbols are sent as Shift followed by the key, which only gives a capital if
// the TV honours that Shift press.
//
// Characters without a key in the chosen format are rejected (never silently
// dropped or substituted). Non-ASCII characters can only be tried in "char"
// format, and only when the user opts in.

export const KEY_FORMATS = Object.freeze(["char", "name", "number"]);
export const DEFAULT_KEY_FORMAT = "char";

// Special characters that map to a GiTV key name rather than a literal.
export const SPECIAL_TEXT_KEYS = Object.freeze({
  "\n": "enter",
});

// Android KeyEvent codes (android.view.KeyEvent).
const ANDROID_KEYS = {
  SHIFT_LEFT: 59, SPACE: 62, DEL: 67,
  STAR: 17, POUND: 18, COMMA: 55, PERIOD: 56, GRAVE: 68, MINUS: 69, EQUALS: 70,
  LEFT_BRACKET: 71, RIGHT_BRACKET: 72, BACKSLASH: 73, SEMICOLON: 74, APOSTROPHE: 75,
  SLASH: 76, AT: 77, PLUS: 81, NUMPAD_LEFT_PAREN: 162, NUMPAD_RIGHT_PAREN: 163,
};
for (let i = 0; i < 10; i++) ANDROID_KEYS[String(i)] = 7 + i; // KEYCODE_0..9
for (let i = 0; i < 26; i++) ANDROID_KEYS[String.fromCharCode(65 + i)] = 29 + i; // KEYCODE_A..Z

// Printable ASCII → [Android key, needs Shift] for a US layout.
const ANDROID_CHARS = { " ": ["SPACE", false] };
for (let i = 0; i < 26; i++) {
  const upper = String.fromCharCode(65 + i);
  ANDROID_CHARS[upper.toLowerCase()] = [upper, false];
  ANDROID_CHARS[upper] = [upper, true];
}
for (let i = 0; i < 10; i++) ANDROID_CHARS[String(i)] = [String(i), false];
Object.assign(ANDROID_CHARS, {
  ".": ["PERIOD", false], ",": ["COMMA", false], "-": ["MINUS", false], "=": ["EQUALS", false],
  "/": ["SLASH", false], "@": ["AT", false], ";": ["SEMICOLON", false], "'": ["APOSTROPHE", false],
  "[": ["LEFT_BRACKET", false], "]": ["RIGHT_BRACKET", false], "\\": ["BACKSLASH", false],
  "`": ["GRAVE", false], "+": ["PLUS", false], "#": ["POUND", false], "*": ["STAR", false],
  "(": ["NUMPAD_LEFT_PAREN", false], ")": ["NUMPAD_RIGHT_PAREN", false],
  "!": ["1", true], "$": ["4", true], "%": ["5", true], "^": ["6", true], "&": ["7", true],
  "_": ["MINUS", true], "{": ["LEFT_BRACKET", true], "}": ["RIGHT_BRACKET", true],
  "|": ["BACKSLASH", true], ":": ["SEMICOLON", true], "\"": ["APOSTROPHE", true],
  "<": ["COMMA", true], ">": ["PERIOD", true], "?": ["SLASH", true], "~": ["GRAVE", true],
});

/** The keycode parameter for an Android key in a format ("name" or "number"). */
export function androidKeycode(key, format) {
  return format === "number" ? String(ANDROID_KEYS[key]) : `KEYCODE_${key}`;
}

/** The key that deletes the character before the cursor, or null in "char" format. */
export function deleteKeycode(format) {
  return format === "name" || format === "number" ? androidKeycode("DEL", format) : null;
}

export function isKeyFormat(value) {
  return KEY_FORMATS.includes(value);
}

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
 * Converts text into an ordered list of key tokens, one per request.
 *
 * A Shift press is its own token with `char: ""` and `modifier: true`, so
 * tokensToText() still rebuilds the original text.
 *
 * @param {string} text
 * @param {{allowNonAscii?: boolean, keyFormat?: "char"|"name"|"number"}} [options]
 * @returns {{tokens: {char: string, keycode: string, special: boolean, modifier?: boolean}[],
 *            unsupported: {char: string, index: number, description: string}[]}}
 *   `index` is the UTF-16 offset in the normalised text.
 */
export function encodeText(text, { allowNonAscii = false, keyFormat = DEFAULT_KEY_FORMAT } = {}) {
  const android = keyFormat === "name" || keyFormat === "number";
  // Line endings → "\n"; NFC so "e" + combining acute becomes a single "é".
  const normalized = String(text).replace(/\r\n?/g, "\n").normalize("NFC");
  const tokens = [];
  const unsupported = [];
  let index = 0;
  for (const char of normalized) { // iterates code points, not UTF-16 units
    if (Object.hasOwn(SPECIAL_TEXT_KEYS, char)) {
      tokens.push({ char, keycode: SPECIAL_TEXT_KEYS[char], special: true });
    } else if (android && Object.hasOwn(ANDROID_CHARS, char)) {
      const [key, shift] = ANDROID_CHARS[char];
      if (shift) tokens.push({ char: "", keycode: androidKeycode("SHIFT_LEFT", keyFormat), special: true, modifier: true });
      tokens.push({ char, keycode: androidKeycode(key, keyFormat), special: false });
    } else if (!android && PRINTABLE_ASCII.test(char)) {
      tokens.push({ char, keycode: char, special: false });
    } else if (!android && allowNonAscii && char.codePointAt(0) <= 0xffff && EXTENDED_CHAR.test(char)) {
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
