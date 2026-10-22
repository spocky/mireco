// Test doubles: a manual clock, a minimal DOM, a text field that simulates
// what Android keyboards do to an <input>/<textarea>, and a mock transport.

export function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms = 0) {
      const id = nextId++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    /** Advance time, running due timers in order. */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
    get pending() {
      return timers.size;
    },
  };
}

function makeEvent(type, props = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [k, v] of Object.entries(props)) Object.defineProperty(event, k, { value: v });
  return event;
}

export class FakeElement extends EventTarget {
  constructor(doc, id, tag = "div") {
    super();
    this.ownerDocument = doc;
    this.id = id;
    this.tagName = tag.toUpperCase();
    this.hidden = false;
    this.disabled = false;
    this.textContent = "";
    this.dataset = {};
    this.attributes = new Map();
    this.children = [];
    this.inert = false;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  focus() {
    const prev = this.ownerDocument.activeElement;
    if (prev && prev !== this) prev.dispatchEvent(makeEvent("blur", { bubbles: false }));
    this.ownerDocument.activeElement = this;
  }
  blur() {
    if (this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
      this.dispatchEvent(makeEvent("blur", { bubbles: false }));
    }
  }
  click() {
    if (this.disabled) return;
    this.dispatchEvent(makeEvent("click"));
  }
  querySelectorAll(selector) {
    const m = /^input\[name="(\w+)"\]$/.exec(selector);
    return this.children.filter((c) => m && c.name === m[1]);
  }
}

/**
 * Simulates a text field plus the event sequences a phone keyboard produces.
 * Setting `value` moves the caret to the end, like a real browser.
 */
export class FakeField extends FakeElement {
  #value = "";
  constructor(doc, id = "textEntry") {
    super(doc, id, "textarea");
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }
  get value() {
    return this.#value;
  }
  set value(v) {
    this.#value = String(v);
    this.selectionStart = this.selectionEnd = this.#value.length;
  }
  setSelectionRange(start, end) {
    this.selectionStart = Math.min(start, this.#value.length);
    this.selectionEnd = Math.min(end, this.#value.length);
  }
  #replace(start, end, text) {
    this.#value = this.#value.slice(0, start) + text + this.#value.slice(end);
    this.selectionStart = this.selectionEnd = start + text.length;
  }
  #input(inputType, data, extra = {}) {
    const before = makeEvent("beforeinput", { inputType, data, ...extra });
    this.dispatchEvent(before);
    return !before.defaultPrevented;
  }

  /** Plain key presses / single insertText events, one per character. */
  typeChars(text) {
    for (const ch of text) this.insertText(ch);
  }
  /** One insertText event that may contain several characters (swipe, voice). */
  insertText(text, inputType = "insertText") {
    if (!this.#input(inputType, text)) return;
    this.#replace(this.selectionStart, this.selectionEnd, text);
    this.dispatchEvent(makeEvent("input", { inputType, data: text, isComposing: false }));
  }
  paste(text) {
    this.insertText(text, "insertFromPaste");
  }
  /**
   * Replace [start, end) with text, e.g. a suggestion or autocorrection.
   * Like a real editor, a caret after the replaced range keeps its position
   * relative to the text that follows.
   */
  replaceRange(start, end, text, inputType = "insertReplacementText") {
    if (!this.#input(inputType, text)) return;
    const caret = this.selectionEnd;
    this.#replace(start, end, text);
    if (caret > end) this.selectionStart = this.selectionEnd = caret + text.length - (end - start);
    this.dispatchEvent(makeEvent("input", { inputType, data: text, isComposing: false }));
  }
  backspace() {
    if (!this.#input("deleteContentBackward", null)) return;
    const { selectionStart: s, selectionEnd: e } = this;
    if (s !== e) this.#replace(s, e, "");
    else if (s > 0) this.#replace(s - 1, s, "");
    this.dispatchEvent(makeEvent("input", { inputType: "deleteContentBackward", data: null, isComposing: false }));
  }

  // IME composition (Gboard composes the word under the caret).
  #compStart = null;
  #compText = "";
  compositionStart() {
    this.#compStart = this.selectionStart;
    this.#compText = "";
    this.dispatchEvent(makeEvent("compositionstart", { data: "" }));
  }
  compositionUpdate(text) {
    this.dispatchEvent(makeEvent("compositionupdate", { data: text }));
    this.#input("insertCompositionText", text, { isComposing: true });
    this.#replace(this.#compStart, this.#compStart + this.#compText.length, text);
    this.#compText = text;
    this.dispatchEvent(makeEvent("input", { inputType: "insertCompositionText", data: text, isComposing: true }));
  }
  /** End the composition, optionally committing different (corrected) text. */
  compositionEnd(text) {
    if (text !== undefined && text !== this.#compText) this.compositionUpdate(text);
    this.dispatchEvent(makeEvent("compositionend", { data: text ?? "" }));
    this.#compStart = null;
  }
  /** Compose a word letter by letter: "h", "he", "hel"… */
  composeWord(word) {
    this.compositionStart();
    for (let i = 1; i <= word.length; i++) this.compositionUpdate(word.slice(0, i));
  }
}

export class FakeDocument {
  constructor() {
    this.activeElement = null;
    this.elements = new Map();
  }
  add(el) {
    this.elements.set(el.id, el);
    return el;
  }
  getElementById(id) {
    return this.elements.get(id) ?? null;
  }
}

/** Builds the elements keyboard-panel.js expects. */
export function createPanelDom() {
  const doc = new FakeDocument();
  const ids = [
    "keyboardPanel", "keyboardButton", "keyboardBadge", "modeHint", "textStatus", "textSend",
    "textClear", "textStop", "recovery", "recoveryText", "recoveryRestore", "recoveryDiscard", "keyboardClose",
  ];
  for (const id of ids) doc.add(new FakeElement(doc, id, id.startsWith("text") || id.startsWith("recoveryR") ? "button" : "div"));
  doc.add(new FakeField(doc, "textEntry"));
  doc.getElementById("keyboardPanel").hidden = true;
  doc.getElementById("recovery").hidden = true;
  const panel = doc.getElementById("keyboardPanel");
  for (const value of ["auto", "compose"]) {
    const radio = new FakeElement(doc, "mode-" + value, "input");
    radio.name = "textMode";
    radio.value = value;
    radio.checked = value === "auto";
    panel.children.push(radio);
  }
  return doc;
}

/** Decodes the keycodes of captured key-event URLs into the text the TV got. */
export function decodeKeycodes(urls) {
  return urls
    .map((u) => new URL(u))
    .filter((u) => u.searchParams.get("action") === "keyevent")
    .map((u) => u.searchParams.get("keycode"));
}

export function keycodesToText(keycodes) {
  return keycodes.map((k) => (k === "enter" ? "\n" : k)).join("");
}

/** A transport whose requests are recorded; optionally fail selected ones. */
export function createMockTransport({ failWhen = () => false, delayMs = 0 } = {}) {
  const urls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  return {
    urls,
    get maxInFlight() {
      return maxInFlight;
    },
    async send(command) {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      try {
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        urls.push(command.url);
        if (failWhen(command, urls.length - 1)) {
          throw Object.assign(new Error("Failed to fetch"), { kind: "network" });
        }
        return { opaque: true };
      } finally {
        inFlight--;
      }
    },
  };
}
