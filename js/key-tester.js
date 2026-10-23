// Key tester: a hidden diagnostic in the keyboard panel that sends any key
// name as `keyevent&keycode=<name>`, so you can find out which undocumented
// keys a particular TV/box understands (delete, wake-up, mute, inputs...).
//
// Unlike typed text, the name is sent verbatim as one request (multi-character
// names allowed, always URL-encoded). The TV never confirms a key, so the log
// only shows whether a response came back; watch the screen for the effect.

import { controllerUrl, keyEventParams } from "./commands.js";

// Guesses worth trying; none of these are documented for GiTV.
export const TESTER_SUGGESTIONS = Object.freeze([
  "wakeup", "sleep", "mute", "volumemute", "del", "delete", "backspace", "source", "input",
  "settings", "search", "info", "playpause", "play", "pause", "stop", "channelup", "channeldown",
  "KEYCODE_WAKEUP", "KEYCODE_DEL", "224", "67",
]);
export const MAX_TESTER_KEY = 64;
const MAX_LOG = 12;

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {import("./command-queue.js").CommandQueue} deps.queue
 * @param {() => any} deps.getDevice
 * @param {(error: any) => Promise<string>} deps.explainError
 * @param {() => void} [deps.vibrate]
 */
export function createKeyTester({ doc, queue, getDevice, explainError, vibrate }) {
  const $ = (id) => doc.getElementById(id);
  const input = $("testerKey");
  const sendButton = $("testerSend");
  const chips = $("testerChips");
  const log = $("testerLog");
  const entries = new Map(); // testId -> <li>
  let nextId = 1;

  function time() {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function addEntry(key, result, state) {
    const li = doc.createElement("li");
    li.dataset.state = state;
    const when = doc.createElement("span");
    when.className = "when";
    when.textContent = time();
    const code = doc.createElement("code");
    code.textContent = key;
    const res = doc.createElement("span");
    res.className = "result";
    res.textContent = result;
    li.append(when, code, res);
    log.prepend(li);
    while (log.children.length > MAX_LOG) log.lastElementChild.remove();
    return li;
  }

  function update(li, result, state) {
    li.dataset.state = state;
    li.querySelector(".result").textContent = result;
  }

  /** Sends one key name. Returns false if nothing was queued. */
  function send(rawKey) {
    const key = String(rawKey ?? "").trim().slice(0, MAX_TESTER_KEY);
    if (!key) {
      input.focus();
      return false;
    }
    const device = getDevice();
    if (!device.ok) {
      addEntry(key, "Set the TV's IP address in Settings first", "failed");
      return false;
    }
    const testId = nextId++;
    const queued = queue.enqueue({
      kind: "tester",
      url: controllerUrl(device.host, keyEventParams(key)),
      addressSpace: device.addressSpace,
      label: key,
      testId,
    });
    if (!queued) {
      addEntry(key, "Too many commands waiting", "failed");
      return false;
    }
    vibrate?.();
    entries.set(testId, addEntry(key, "Queued…", "pending"));
    return true;
  }

  queue.subscribe((event) => {
    const li = event.command && entries.get(event.command.testId);
    if (!li) return;
    if (event.type === "dispatch") {
      update(li, "Sending…", "pending");
    } else if (event.type === "sent") {
      update(li, "TV answered · check the screen", "sent");
      entries.delete(event.command.testId);
    } else if (event.type === "failed") {
      update(li, "Failed", "failed");
      entries.delete(event.command.testId);
      explainError(event.error).then((message) => {
        li.querySelector(".result").textContent = `Failed: ${message}`;
      });
    }
  });

  sendButton.addEventListener("click", () => {
    if (send(input.value)) input.select?.();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (send(input.value)) input.select?.();
    }
  });
  // Keep the soft keyboard open while sending.
  sendButton.addEventListener("pointerdown", (e) => {
    if (doc.activeElement === input) e.preventDefault();
  });

  chips.replaceChildren(...TESTER_SUGGESTIONS.map((key) => {
    const chip = doc.createElement("button");
    chip.type = "button";
    chip.textContent = key;
    chip.addEventListener("click", () => {
      input.value = key;
      send(key);
    });
    return chip;
  }));

  return { send, focus: () => input.focus({ preventScroll: true }), input };
}
