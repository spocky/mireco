// Text entry controller: decides *when* text in the entry field is final
// enough to send to the TV.
//
// Characters that reached the TV can't be taken back (the GiTV API has no
// verified delete-character key), so mirroring the field character by
// character breaks as soon as a phone keyboard autocompletes or autocorrects:
// "hel" would already be on the TV when the keyboard turns it into "hello".
//
// Two modes:
//
// "auto"    (buffered words) The word being typed stays local and editable.
//           Once the field contains a completed word followed by a space or
//           line break, and the keyboard has been quiet for `settleMs` with no
//           IME composition active, everything up to and including the last
//           delimiter is committed and removed from the field. The unfinished
//           word stays. Send commits the rest.
// "compose" Nothing leaves the field until Send; then the whole draft goes.
//
// `commit(text)` hands text to the dispatcher. The committed part is removed
// from the field only if `commit` accepted it, so rejected or unsupported text
// is never lost.

export const DEFAULT_SETTLE_MS = 700;
// How long Send waits for an active IME composition to end before sending
// what is visible in the field.
export const COMPOSITION_FLUSH_WAIT_MS = 350;

const DELIMITER = /[ \n]/;

/** Index just past the last delimiter, or 0 when there's no completed word. */
export function completedPrefixLength(value) {
  for (let i = value.length - 1; i >= 0; i--) {
    if (DELIMITER.test(value[i])) return i + 1;
  }
  return 0;
}

export class TextInputController {
  #field;
  #commit;
  #timers;
  #settleTimer = null;
  #flushTimer = null;
  #composing = false;
  #flushRequested = false;
  #handlers = {};
  #listeners = new Set();

  /**
   * @param {object} options
   * @param {HTMLTextAreaElement|HTMLInputElement} options.field
   * @param {(text: string) => {accepted: boolean, reason?: string}} options.commit
   * @param {"auto"|"compose"} [options.mode]
   * @param {number} [options.settleMs]
   * @param {{setTimeout: Function, clearTimeout: Function}} [options.timers]
   */
  constructor({ field, commit, mode = "auto", settleMs = DEFAULT_SETTLE_MS, timers = globalThis }) {
    this.#field = field;
    this.#commit = commit;
    this.#timers = timers;
    this.mode = mode;
    this.settleMs = settleMs;
    this.#handlers = {
      compositionstart: () => this.#onCompositionStart(),
      compositionend: () => this.#onCompositionEnd(),
      beforeinput: (e) => this.#onBeforeInput(e),
      input: (e) => this.#onInput(e),
      blur: () => this.#onBlur(),
    };
    for (const [type, handler] of Object.entries(this.#handlers)) {
      field.addEventListener(type, handler);
    }
  }

  destroy() {
    for (const [type, handler] of Object.entries(this.#handlers)) {
      this.#field.removeEventListener(type, handler);
    }
    this.#clearSettle();
    this.#clearFlushTimer();
    this.#listeners.clear();
  }

  /** Events: {type: "state"}, {type: "committed", text},
   *  {type: "rejected", text, reason}, {type: "edit-committed-attempt"} */
  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(event) {
    for (const listener of this.#listeners) listener(event);
  }

  get composing() {
    return this.#composing;
  }

  get flushPending() {
    return this.#flushRequested;
  }

  get draft() {
    return this.#field.value;
  }

  setMode(mode) {
    if (mode !== "auto" && mode !== "compose") throw new Error(`Unknown mode ${mode}`);
    this.mode = mode;
    // Switching never sends anything by itself; in auto mode completed words
    // already in the draft go out after the next edit or on Send.
    this.#clearSettle();
    this.#emit({ type: "state" });
  }

  /** Send button: commit everything in the field, including the last word. */
  flush() {
    this.#clearSettle();
    if (this.#composing) {
      // Let the keyboard finish (and possibly autocorrect) the word first.
      if (!this.#flushRequested) {
        this.#flushRequested = true;
        this.#flushTimer = this.#timers.setTimeout(() => {
          this.#flushTimer = null;
          // The composition didn't end on its own; the user explicitly asked
          // to send what they can see.
          this.#composing = false;
          this.#doFlush();
        }, COMPOSITION_FLUSH_WAIT_MS);
        this.#emit({ type: "state" });
      }
      return "deferred";
    }
    return this.#doFlush();
  }

  /** Put text back at the start of the draft (e.g. unsent text after an error). */
  restore(text) {
    if (!text) return;
    const field = this.#field;
    const { selectionStart, selectionEnd } = field;
    field.value = text + field.value;
    if (selectionStart != null) {
      field.setSelectionRange?.(selectionStart + text.length, selectionEnd + text.length);
    }
    this.#emit({ type: "state" });
  }

  clearDraft() {
    this.#clearSettle();
    this.#clearFlushTimer();
    this.#flushRequested = false;
    this.#field.value = "";
    this.#emit({ type: "state" });
  }

  #doFlush() {
    this.#clearFlushTimer();
    this.#flushRequested = false;
    const text = this.#field.value;
    if (!text) {
      this.#emit({ type: "state" });
      return "empty";
    }
    const ok = this.#commitPrefix(text.length);
    this.#emit({ type: "state" });
    return ok ? "sent" : "rejected";
  }

  #onCompositionStart() {
    this.#composing = true;
    this.#clearSettle();
    this.#emit({ type: "state" });
  }

  #onCompositionEnd() {
    this.#composing = false;
    if (this.#flushRequested) {
      // Run after the input event that follows compositionend in some browsers.
      this.#clearFlushTimer();
      this.#flushTimer = this.#timers.setTimeout(() => {
        this.#flushTimer = null;
        this.#doFlush();
      }, 0);
      return;
    }
    this.#scheduleSettle();
    this.#emit({ type: "state" });
  }

  #onBeforeInput(e) {
    // Backspace (or a word deletion) at the very start of the field targets
    // text that was already sent. It can't be undone on the TV from here.
    const field = this.#field;
    if (
      typeof e.inputType === "string" &&
      e.inputType.startsWith("delete") && e.inputType.endsWith("Backward") &&
      field.selectionStart === 0 && field.selectionEnd === 0
    ) {
      this.#emit({ type: "edit-committed-attempt" });
    }
  }

  #onInput(e) {
    if (e.isComposing) this.#composing = true;
    if (this.#flushRequested) return; // a flush is about to consume the field
    this.#scheduleSettle();
    this.#emit({ type: "state" });
  }

  #onBlur() {
    // Chrome ends the composition on blur; don't stay stuck if it didn't say so.
    if (this.#composing) {
      this.#composing = false;
      if (this.#flushRequested) {
        this.#clearFlushTimer();
        this.#doFlush();
        return;
      }
      this.#scheduleSettle();
    }
  }

  #scheduleSettle() {
    if (this.mode !== "auto") return;
    this.#clearSettle();
    this.#settleTimer = this.#timers.setTimeout(() => {
      this.#settleTimer = null;
      this.commitCompletedWords();
    }, this.settleMs);
  }

  /**
   * Auto mode: commit the completed words if it is safe to touch the field.
   * Returns "committed", "nothing", "deferred" or "rejected".
   */
  commitCompletedWords() {
    if (this.mode !== "auto") return "nothing";
    // Never touch the field while the keyboard is composing; it will be
    // rescheduled on compositionend.
    if (this.#composing) return "deferred";
    const field = this.#field;
    const prefix = completedPrefixLength(field.value);
    if (prefix === 0) return "nothing";
    // The user moved the caret back into the completed text to edit it.
    if (field.selectionStart < prefix || field.selectionEnd < prefix) return "deferred";
    return this.#commitPrefix(prefix) ? "committed" : "rejected";
  }

  #commitPrefix(length) {
    const field = this.#field;
    const value = field.value;
    const text = value.slice(0, length);
    const result = this.#commit(text);
    if (!result?.accepted) {
      this.#emit({ type: "rejected", text, reason: result?.reason });
      return false;
    }
    // Remove exactly the committed prefix and keep the caret where it was
    // relative to the remaining text.
    const { selectionStart, selectionEnd } = field;
    field.value = value.slice(length);
    if (selectionStart != null) {
      field.setSelectionRange?.(Math.max(0, selectionStart - length), Math.max(0, selectionEnd - length));
    }
    this.#emit({ type: "committed", text });
    this.#emit({ type: "state" });
    return true;
  }

  #clearSettle() {
    if (this.#settleTimer != null) this.#timers.clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
  }

  #clearFlushTimer() {
    if (this.#flushTimer != null) this.#timers.clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
  }
}
