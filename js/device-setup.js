// First-run setup: with no usable TV address stored, ask for one before the
// remote can send anything.
//
// "192.168.1." is prefilled because it is the most common home subnet, so
// usually only the last part has to be typed. OK stays disabled until the
// whole value parses as an address the remote could actually use, so the
// dialog can't store something that would be rejected later anyway.

import { parseDeviceAddress } from "./address.js";

export const IP_PREFIX = "192.168.1.";

/**
 * @param {object} deps
 * @param {HTMLElement} deps.dialog
 * @param {HTMLInputElement} deps.input
 * @param {HTMLElement} deps.error
 * @param {HTMLButtonElement} deps.okButton
 * @param {HTMLButtonElement} deps.laterButton
 * @param {(parsed: {host: string, addressSpace: "local"|"loopback"}) => void} deps.onSubmit
 * @param {string} [deps.initialValue]
 * @param {(HTMLElement|null)[]} [deps.background] made inert while the dialog is open
 */
export function createDeviceSetup({
  dialog,
  input,
  error,
  okButton,
  laterButton,
  onSubmit,
  initialValue = IP_PREFIX,
  background = [],
}) {
  let open = false;

  function setError(message) {
    error.textContent = message ?? "";
    error.hidden = !message;
    input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  /** Enables OK as soon as the value is usable; clears an old error once it is. */
  function validate() {
    const parsed = parseDeviceAddress(input.value);
    okButton.disabled = !parsed.ok;
    if (parsed.ok && !error.hidden) setError(null);
    return parsed;
  }

  function show() {
    if (open) return;
    open = true;
    input.value = initialValue;
    setError(null);
    validate();
    dialog.hidden = false;
    background.forEach((el) => el && (el.inert = true));
    input.focus({ preventScroll: true });
    input.setSelectionRange?.(input.value.length, input.value.length);
  }

  function close() {
    if (!open) return;
    open = false;
    dialog.hidden = true;
    background.forEach((el) => el && (el.inert = false));
    setError(null);
  }

  function submit() {
    const parsed = parseDeviceAddress(input.value);
    if (!parsed.ok) {
      okButton.disabled = true;
      setError(parsed.error);
      input.focus({ preventScroll: true });
      return;
    }
    close();
    onSubmit(parsed);
  }

  input.addEventListener("input", validate);
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    submit();
  });
  okButton.addEventListener("click", submit);
  laterButton.addEventListener("click", close);
  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    close();
  });

  return {
    open: show,
    close,
    submit,
    validate,
    get isOpen() {
      return open;
    },
  };
}
