// First-run device setup: prefill, live validation, OK gating and dismissal.

import test from "node:test";
import assert from "node:assert/strict";

import { createDeviceSetup, IP_PREFIX } from "../js/device-setup.js";
import { FakeDocument, FakeElement, FakeField } from "./helpers/fakes.mjs";

function setup({ initialValue } = {}) {
  const doc = new FakeDocument();
  const dialog = doc.add(new FakeElement(doc, "deviceSetup", "div"));
  const input = doc.add(new FakeField(doc, "setupIP"));
  const error = doc.add(new FakeElement(doc, "setupIPError", "p"));
  const okButton = doc.add(new FakeElement(doc, "setupOK", "button"));
  const laterButton = doc.add(new FakeElement(doc, "setupLater", "button"));
  const background = [doc.add(new FakeElement(doc, "topbar", "header"))];
  dialog.hidden = true;
  error.hidden = true;
  const submitted = [];
  const control = createDeviceSetup({
    dialog,
    input,
    error,
    okButton,
    laterButton,
    background,
    initialValue,
    onSubmit: (parsed) => submitted.push(parsed),
  });
  const type = (value) => {
    input.value = value;
    input.dispatchEvent(new Event("input"));
  };
  const key = (target, name) => {
    const event = new Event("keydown", { bubbles: true, cancelable: true });
    event.key = name;
    target.dispatchEvent(event);
    return event;
  };
  return { control, dialog, input, error, okButton, laterButton, background, submitted, type, key };
}

test("opening prefills 192.168.1. and keeps OK disabled until the address is complete", () => {
  const { control, dialog, input, okButton, background } = setup();
  control.open();
  assert.equal(dialog.hidden, false);
  assert.equal(input.value, IP_PREFIX);
  assert.equal(okButton.disabled, true);
  assert.equal(background[0].inert, true);
  assert.equal(dialog.ownerDocument.activeElement, input, "the field is ready to type into");
});

test("OK enables as soon as the typed address is valid", () => {
  const { control, okButton, type } = setup();
  control.open();
  type("192.168.1.");
  assert.equal(okButton.disabled, true, "a trailing dot is not valid yet");
  type("192.168.1.20");
  assert.equal(okButton.disabled, false);
  type("192.168.1.300");
  assert.equal(okButton.disabled, true);
  type("8.8.8.8");
  assert.equal(okButton.disabled, true, "public addresses are refused");
});

test("OK stores the normalised address, closes and un-inerts the page", () => {
  const { control, dialog, okButton, background, submitted, type } = setup();
  control.open();
  type("http://192.168.1.20:6095/");
  okButton.dispatchEvent(new Event("click"));
  assert.deepEqual(submitted, [{ ok: true, host: "192.168.1.20", addressSpace: "local" }]);
  assert.equal(dialog.hidden, true);
  assert.equal(background[0].inert, false);
  assert.equal(control.isOpen, false);
});

test("a prefilled but invalid value cannot be submitted, even with Enter", () => {
  const { control, dialog, input, error, okButton, submitted, key } = setup();
  control.open();
  const event = key(input, "Enter");
  assert.equal(event.defaultPrevented, true);
  assert.equal(submitted.length, 0);
  assert.equal(dialog.hidden, false);
  assert.equal(okButton.disabled, true);
  assert.equal(error.hidden, false);
  assert.match(error.textContent, /isn't a valid IPv4 address/);
});

test("typing a valid address clears the error left by a failed submit", () => {
  const { control, input, error, okButton, key, type } = setup();
  control.open();
  key(input, "Enter");
  assert.equal(error.hidden, false);
  type("192.168.1.20");
  assert.equal(error.hidden, true);
  assert.equal(okButton.disabled, false);
});

test("'Set up later' closes without saving", () => {
  const { control, dialog, laterButton, background, submitted } = setup();
  control.open();
  laterButton.dispatchEvent(new Event("click"));
  assert.equal(dialog.hidden, true);
  assert.equal(background[0].inert, false);
  assert.equal(submitted.length, 0);
});

test("Escape closes without saving", () => {
  const { control, dialog, submitted, key } = setup();
  control.open();
  key(dialog, "Escape");
  assert.equal(dialog.hidden, true);
  assert.equal(submitted.length, 0);
});

test("reopening resets the field to the prefill", () => {
  const { control, input } = setup();
  control.open();
  input.value = "10.0.0.7";
  control.close();
  control.open();
  assert.equal(input.value, IP_PREFIX);
});

test("an existing stored value is prefilled instead of the default prefix", () => {
  const { control, input, okButton, submitted, type } = setup({ initialValue: "10.0.0.7" });
  control.open();
  assert.equal(input.value, "10.0.0.7");
  assert.equal(okButton.disabled, false);
  type("10.0.0.8");
  control.submit();
  assert.equal(submitted[0].host, "10.0.0.8");
});
