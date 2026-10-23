// Keyboard bottom sheet: wires the text entry field, the input controller,
// the command queue and the panel's status/recovery UI together.

import { createKeyTester } from "./key-tester.js";
import { TextInputController, completedPrefixLength } from "./text-input.js";
import { createTextSender } from "./text-sender.js";
import { tokensToText } from "./text-encoding.js";

const MODE_HINTS = {
  auto: "Auto words: each word is sent after you finish it with a space or Enter, so suggestions and autocorrect can still change it. Press Send for the last word. Words already sent can't be corrected.",
  compose: "Compose & Send: nothing is sent while you type or edit. Press Send to type the whole text on the TV.",
  tester: "Key tester: sends exactly the key name you enter (keyevent&keycode=…), to find keys your TV understands beyond the documented ones. The TV doesn't confirm keys, so watch the screen. Tap the title 8 times to hide this mode again.",
};

// Hidden key tester: tap the panel title this many times, each tap within
// TAP_WINDOW_MS of the previous one (a pause starts the count again).
export const UNLOCK_TAPS = 8;
export const TAP_WINDOW_MS = 1000;

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {import("./command-queue.js").CommandQueue} deps.queue
 * @param {() => any} deps.getDevice
 * @param {{get: (k: string) => any, update: (patch: object) => boolean}} deps.settings
 * @param {(error: any) => Promise<string>} deps.explainError
 * @param {() => void} deps.vibrate
 * @param {() => void} deps.onOpen   called before the panel opens (e.g. close settings)
 * @param {(message: string) => void} deps.onNeedsDevice
 * @param {() => number} [deps.now] clock for the unlock gesture (tests)
 */
export function createKeyboardPanel({ doc, queue, getDevice, settings, explainError, vibrate, onOpen, onNeedsDevice, now = () => Date.now() }) {
  const $ = (id) => doc.getElementById(id);
  const panel = $("keyboardPanel");
  const openButton = $("keyboardButton");
  const badge = $("keyboardBadge");
  const field = $("textEntry");
  const hint = $("modeHint");
  const status = $("textStatus");
  const sendButton = $("textSend");
  const clearButton = $("textClear");
  const stopButton = $("textStop");
  const recovery = $("recovery");
  const recoveryText = $("recoveryText");
  const modeInputs = [...panel.querySelectorAll('input[name="textMode"]')];
  const title = $("keyboardTitle");
  const testerOption = $("testerModeOption");
  const segmented = panel.querySelector(".segmented");
  const tester = createKeyTester({ doc, queue, getDevice, explainError, vibrate });

  const commit = createTextSender({ queue, getDevice, getAllowNonAscii: () => settings.get("allowNonAscii") });
  const controller = new TextInputController({ field, commit, mode: settings.get("textMode") });

  let lastError = null; // {message, tone}
  let unsent = ""; // text recovered after a failure or Stop
  let sentSinceIdle = 0;
  let testerUnlocked = false;
  let testerMode = false; // never stored: the saved text mode stays auto/compose
  let taps = 0;
  let lastTap = -Infinity;

  function isOpen() {
    return !panel.hidden;
  }

  function open() {
    onOpen?.();
    panel.hidden = false;
    openButton.setAttribute("aria-expanded", "true");
    syncMode();
    render();
    // Focus inside the click handler so Android opens the soft keyboard.
    if (testerMode) {
      tester.focus();
      return;
    }
    field.focus({ preventScroll: true });
    const end = field.value.length;
    field.setSelectionRange(end, end);
  }

  function close({ restoreFocus = true } = {}) {
    if (!isOpen()) return;
    panel.hidden = true;
    openButton.setAttribute("aria-expanded", "false");
    if (restoreFocus) openButton.focus({ preventScroll: true });
    render();
  }

  function syncMode() {
    const mode = testerMode ? "tester" : controller.mode;
    for (const input of modeInputs) input.checked = input.value === mode;
    hint.textContent = MODE_HINTS[mode];
    panel.dataset.mode = mode;
    testerOption.hidden = !testerUnlocked;
    segmented.classList.toggle("has-tester", testerUnlocked);
  }

  function onTitleTap() {
    const t = now();
    taps = t - lastTap <= TAP_WINDOW_MS ? taps + 1 : 1;
    lastTap = t;
    if (taps < UNLOCK_TAPS) return;
    taps = 0;
    lastTap = -Infinity;
    testerUnlocked = !testerUnlocked;
    if (!testerUnlocked) testerMode = false;
    vibrate();
    syncMode();
    render();
  }

  function setError(message, tone = "error") {
    lastError = message ? { message, tone } : null;
    render();
  }

  function addUnsent(commands, why) {
    const text = tokensToText(commands.map((c) => c.token).filter(Boolean));
    if (!text) return;
    unsent += text;
    recoveryText.textContent = `${why} Not sent: “${unsent}”.`;
    recovery.hidden = false;
  }

  function render() {
    const pendingText = queue.countPending("text") + (queue.inFlight?.kind === "text" ? 1 : 0);
    const draft = field.value;

    let text;
    let state = "idle";
    if (lastError) {
      text = lastError.message;
      state = lastError.tone;
    } else if (controller.flushPending) {
      text = "Waiting for the keyboard to finish the word…";
    } else if (pendingText > 0) {
      text = `Sending… ${pendingText} key${pendingText === 1 ? "" : "s"} left`;
      state = "sending";
    } else if (draft) {
      if (controller.mode === "compose") text = "Draft not sent yet. Press Send.";
      else if (completedPrefixLength(draft) > 0) text = "Sending completed words when you pause…";
      else text = "Current word stays here until you type a space or press Send.";
    } else if (sentSinceIdle > 0) {
      text = `Done: ${sentSinceIdle} key${sentSinceIdle === 1 ? "" : "s"} sent. The TV doesn't confirm what it typed.`;
    } else {
      text = "Ready";
    }
    status.textContent = text;
    status.dataset.state = state;
    stopButton.hidden = queue.countPending("text") === 0;
    sendButton.disabled = draft.length === 0 || controller.flushPending;
    clearButton.disabled = draft.length === 0;

    // Badge on the keyboard button: pending keys, an error, or a kept draft.
    if (pendingText > 0) {
      badge.hidden = false;
      badge.textContent = String(pendingText);
      badge.dataset.tone = "";
    } else if (lastError?.tone === "error" || !recovery.hidden) {
      badge.hidden = false;
      badge.textContent = "!";
      badge.dataset.tone = "error";
    } else if (draft && !isOpen()) {
      badge.hidden = false;
      badge.textContent = "…";
      badge.dataset.tone = "";
    } else {
      badge.hidden = true;
    }
  }

  controller.subscribe((event) => {
    switch (event.type) {
      case "committed":
        lastError = null;
        break;
      case "rejected": {
        // Don't keep repeating the same message on every keystroke.
        if (lastError?.message !== event.reason) setError(event.reason, "error");
        if (/IP address|local address|IPv/i.test(event.reason || "")) onNeedsDevice?.(event.reason);
        break;
      }
      case "edit-committed-attempt":
        setError("Text already sent to the TV can't be deleted or corrected from here. Use Compose & Send to edit text before it is sent.", "warn");
        break;
    }
    render();
  });

  let wasIdle = true;
  queue.subscribe((event) => {
    if (event.type === "change") {
      // Reset the "Done" counter when new text starts after the queue was idle.
      const idle = !queue.busy && queue.pendingCount === 0;
      if (wasIdle && !idle && queue.countPending("text") > 0) sentSinceIdle = 0;
      wasIdle = idle;
    } else if (event.type === "sent" && event.command.kind === "text") {
      sentSinceIdle++;
    } else if (event.type === "failed" && event.command.kind === "text") {
      // The failed key plus everything cancelled after it becomes recoverable
      // text. It is never resent automatically.
      const { command, cancelled, error } = event;
      const failedChar = command.token?.char === "\n" ? "Enter" : `“${command.token?.char}”`;
      setError("Sending stopped after an error. See below.", "error");
      explainError(error).then((message) => {
        addUnsent([command, ...cancelled], `Sending stopped: ${message} ${failedChar} may or may not have reached the TV.`);
        render();
      });
    }
    render();
  });

  // --- DOM wiring (attached once) ---
  openButton.addEventListener("click", () => (isOpen() ? close() : open()));
  $("keyboardClose").addEventListener("click", () => close());
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && e.target === field) {
      e.preventDefault();
      sendButton.click();
    }
  });

  // Keep the soft keyboard open: don't let these buttons steal focus from the field.
  for (const button of [sendButton, clearButton, stopButton]) {
    button.addEventListener("pointerdown", (e) => {
      if (doc.activeElement === field) e.preventDefault();
    });
  }

  sendButton.addEventListener("click", () => {
    if (!field.value) return;
    vibrate();
    lastError = null;
    controller.flush();
    render();
  });

  clearButton.addEventListener("click", () => {
    controller.clearDraft();
    lastError = null;
    render();
    field.focus({ preventScroll: true });
  });

  stopButton.addEventListener("click", () => {
    const cancelled = queue.cancelPending((c) => c.kind === "text");
    addUnsent(cancelled, "Stopped. Keys already sent stay on the TV.");
    render();
  });

  $("recoveryRestore").addEventListener("click", () => {
    controller.restore(unsent);
    unsent = "";
    recovery.hidden = true;
    lastError = null;
    render();
    field.focus({ preventScroll: true });
  });

  $("recoveryDiscard").addEventListener("click", () => {
    unsent = "";
    recovery.hidden = true;
    lastError = null;
    render();
  });

  for (const input of modeInputs) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      if (input.value === "tester") {
        testerMode = true;
      } else {
        testerMode = false;
        controller.setMode(input.value);
        settings.update({ textMode: input.value });
      }
      lastError = null;
      syncMode();
      render();
      if (testerMode) tester.focus();
    });
  }

  title.addEventListener("click", onTitleTap);

  field.addEventListener("input", () => {
    // Editing clears a stale warning (but not an unsupported-character error,
    // which the next commit attempt re-evaluates).
    if (lastError?.tone === "warn") lastError = null;
    render();
  });

  syncMode();
  render();

  return {
    open,
    close,
    isOpen,
    render,
    controller,
    field,
    tester,
    get testerUnlocked() {
      return testerUnlocked;
    },
    get mode() {
      return testerMode ? "tester" : controller.mode;
    },
    /** Commands cancelled elsewhere (e.g. device changed) */
    reportCancelled(commands, why) {
      addUnsent(commands.filter((c) => c.kind === "text"), why);
      render();
    },
    hasUnsentWork: () => field.value.length > 0 || queue.countPending("text") > 0,
  };
}
