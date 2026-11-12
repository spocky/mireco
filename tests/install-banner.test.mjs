import test from "node:test";
import assert from "node:assert/strict";
import { createInstallBanner } from "../js/install-banner.js";

function setup({ standalone = false, ios = false } = {}) {
  const win = new EventTarget();
  const displayMode = new EventTarget();
  displayMode.matches = standalone;
  win.matchMedia = () => displayMode;
  win.navigator = { standalone: ios };
  const banner = { hidden: false };
  const button = new EventTarget();
  const hint = { textContent: "Add this page to your home screen from the browser menu to use it like an app." };
  createInstallBanner({ banner, button, hint, win });
  return { win, displayMode, banner, button, hint };
}

function offer(win, prompt = async () => ({ outcome: "dismissed" })) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  event.prompt = prompt;
  win.dispatchEvent(event);
  return event;
}

test("manual instructions remain visible without browser install support", () => {
  const { banner, button, hint } = setup();
  assert.equal(banner.hidden, false);
  assert.equal(button.hidden, true);
  assert.match(hint.textContent, /browser menu/);
});

test("install button uses each prompt only once, including rapid clicks", async () => {
  const { win, button, banner } = setup();
  let calls = 0;
  const event = offer(win, async () => { calls++; return { outcome: "dismissed" }; });
  assert.equal(event.defaultPrevented, true);
  assert.equal(button.hidden, false);
  button.dispatchEvent(new Event("click"));
  button.dispatchEvent(new Event("click"));
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(button.hidden, true);
  assert.equal(banner.hidden, false);
  offer(win);
  assert.equal(button.hidden, false);
});

test("failed prompts preserve manual instructions without an unhandled rejection", async () => {
  const { win, button, hint } = setup();
  offer(win, async () => { throw new Error("Unavailable"); });
  button.dispatchEvent(new Event("click"));
  await Promise.resolve();
  assert.equal(button.hidden, true);
  assert.match(hint.textContent, /Installation could not be opened.*browser menu/);
});

test("installing from any browser UI hides the banner and clears the prompt", () => {
  const { win, button, banner } = setup();
  offer(win);
  win.dispatchEvent(new Event("appinstalled"));
  assert.equal(banner.hidden, true);
  assert.equal(button.hidden, true);
  offer(win);
  assert.equal(button.hidden, true);
});

test("standalone display modes and iOS installed apps hide installation UI", () => {
  for (const options of [{ standalone: true }, { ios: true }]) {
    const { banner, button } = setup(options);
    assert.equal(banner.hidden, true);
    assert.equal(button.hidden, true);
  }
});

test("switching to standalone clears an available prompt", () => {
  const { win, displayMode, banner, button } = setup();
  offer(win);
  displayMode.matches = true;
  displayMode.dispatchEvent(new Event("change"));
  assert.equal(banner.hidden, true);
  assert.equal(button.hidden, true);
});
