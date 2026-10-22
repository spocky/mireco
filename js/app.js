// MiReCo UI controller: remote buttons, settings, status and wiring of the
// transport, command queue and keyboard panel.

import { parseDeviceAddress } from "./address.js";
import { controllerUrl, customButtonParams, homeParams, keyEventParams, probeUrl } from "./commands.js";
import { CommandQueue } from "./command-queue.js";
import { createKeyboardPanel } from "./keyboard-panel.js";
import { createSettingsStore, DEFAULTS } from "./settings.js";
import { applyTheme, CLASSIC_THEME } from "./themes.js";
import {
  createFetchTransport,
  describePageContext,
  explainFailure,
  localNetworkAccessApplies,
  queryLocalNetworkPermission,
} from "./transport.js";

const $ = (id) => document.getElementById(id);

const settings = createSettingsStore();
settings.load();
applyHashDeviceIP();

let device = parseDeviceAddress(settings.get("deviceIP"));
const pageContext = describePageContext(location);
const transport = createFetchTransport();
const queue = new CommandQueue({
  send: (command) => transport.send(command.url, { addressSpace: command.addressSpace }),
  intervalMs: settings.get("keyIntervalMs"),
});

// ---------- Local Network Access permission ----------

let permission = { state: "unsupported", status: null };

async function refreshPermission(addressSpace = device.ok ? device.addressSpace : "local") {
  const result = await queryLocalNetworkPermission(addressSpace);
  if (permission.status && permission.status !== result.status) permission.status.onchange = null;
  permission = result;
  if (result.status) {
    result.status.onchange = () => {
      permission.state = result.status.state;
      renderConnectionInfo();
    };
  }
  renderConnectionInfo();
  return permission.state;
}

async function explainError(error) {
  const permissionState = await refreshPermission();
  return explainFailure({
    error,
    pageKind: pageContext.kind,
    permissionState,
    host: device.ok ? device.host : "the TV",
    addressSpace: device.ok ? device.addressSpace : "local",
  });
}

// ---------- Status pill (deduplicated) ----------

const statusPill = $("statusPill");
let statusTimer = null;

function showStatus(message, tone = "info", ms = 6000) {
  statusPill.textContent = message;
  statusPill.dataset.tone = tone;
  statusPill.hidden = false;
  clearTimeout(statusTimer);
  statusTimer = setTimeout(hideStatus, ms);
}

function hideStatus() {
  statusPill.hidden = true;
  statusPill.textContent = "";
}

// ---------- Remote buttons ----------

function vibrate() {
  if (!settings.get("enableVibrator")) return;
  try {
    navigator.vibrate?.(50);
  } catch {
    // not supported (iOS)
  }
}

function sendRemote(params, label) {
  if (!device.ok) {
    openSettings({ error: device.error });
    return;
  }
  vibrate();
  const accepted = queue.enqueue({
    kind: "remote",
    url: controllerUrl(device.host, params),
    addressSpace: device.addressSpace,
    label,
  });
  if (!accepted) showStatus("Too many commands waiting. Wait a moment or stop the text being sent.", "warn");
}

let lastRemoteError = "";
queue.subscribe((event) => {
  if (event.type === "failed" && event.command.kind === "remote") {
    explainError(event.error).then((message) => {
      // Same error again: just keep it visible instead of re-announcing it.
      if (message === lastRemoteError && !statusPill.hidden) {
        clearTimeout(statusTimer);
        statusTimer = setTimeout(hideStatus, 10000);
        return;
      }
      lastRemoteError = message;
      showStatus(message, "error", 10000);
    });
  } else if (event.type === "sent" && lastRemoteError) {
    // A later request got an HTTP response, so the earlier error is stale.
    lastRemoteError = "";
    if (statusPill.dataset.tone === "error") hideStatus();
  }
});

document.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-key], button[data-app], button[data-action]");
  if (!button || button.closest("#settings")) return;
  if (button.dataset.key) {
    sendRemote(keyEventParams(button.dataset.key), button.dataset.key);
  } else if (button.dataset.app) {
    const params = customButtonParams(settings.get("customPackage" + button.dataset.app));
    if (params) sendRemote(params, "custom " + button.dataset.app);
  } else if (button.dataset.action === "home") {
    sendRemote(homeParams(settings.get("customLauncher")), "home");
  }
});

// While typing, pressing a remote button shouldn't close the soft keyboard.
document.addEventListener("pointerdown", (e) => {
  if (document.activeElement === keyboard.field && e.target.closest(".remote, .buttons, footer")) {
    e.preventDefault();
  }
});

// ---------- Keyboard panel ----------

const keyboard = createKeyboardPanel({
  doc: document,
  queue,
  getDevice: () => device,
  settings,
  explainError,
  vibrate,
  onOpen: () => closeSettings(),
  onNeedsDevice: (message) => showStatus(message + " Open Settings to set it.", "warn"),
});

window.addEventListener("beforeunload", (e) => {
  if (keyboard.hasUnsentWork()) e.preventDefault();
});

// ---------- Settings overlay ----------

const settingsPanel = $("settings");
const settingsButton = $("settingsButton");
const deviceInput = $("deviceIP");
const deviceError = $("deviceIPError");
const connectionResult = $("connectionResult");
const background = [document.querySelector(".topbar"), document.querySelector(".remote-area"), document.querySelector("footer"), $("keyboardPanel")];
const TEXT_FIELDS = ["deviceIP", "customPackage1", "customPackage2", "customPackage3", "customPackage4", "customLauncher", "bgColor", "btColor"];
const colorPickers = new Map();

function initColorPickers() {
  if (colorPickers.size || typeof window.jscolor !== "function") return;
  for (const id of ["bgColor", "btColor"]) {
    try {
      colorPickers.set(id, new window.jscolor($(id), { hash: true }));
    } catch (err) {
      console.warn("Color picker unavailable", err);
    }
  }
}

function isSettingsOpen() {
  return settingsPanel.classList.contains("open");
}

function setDeviceError(message) {
  deviceError.textContent = message || "";
  deviceError.hidden = !message;
  deviceInput.setAttribute("aria-invalid", message ? "true" : "false");
}

function openSettings({ error } = {}) {
  keyboard.close({ restoreFocus: false });
  initColorPickers();
  const values = settings.all();
  for (const id of TEXT_FIELDS) $(id).value = values[id];
  for (const picker of colorPickers.values()) picker.importColor?.();
  $("enableVibrator").checked = values.enableVibrator;
  $("allowNonAscii").checked = values.allowNonAscii;
  $("keyIntervalMs").value = values.keyIntervalMs;
  for (const input of themeInputs) input.checked = input.value === values.theme;
  syncCustomColors(values.theme);
  setDeviceError(error);
  connectionResult.textContent = "";
  connectionResult.dataset.tone = "";
  settingsPanel.inert = false;
  settingsPanel.classList.add("open");
  settingsButton.setAttribute("aria-expanded", "true");
  background.forEach((el) => (el.inert = true));
  refreshPermission();
  // Only jump into the IP field (opening the soft keyboard) when it needs fixing.
  (error ? deviceInput : settingsPanel).focus({ preventScroll: true });
}

function closeSettings() {
  if (!isSettingsOpen()) return;
  for (const picker of colorPickers.values()) picker.hide?.();
  settingsPanel.classList.remove("open");
  settingsPanel.inert = true;
  settingsButton.setAttribute("aria-expanded", "false");
  background.forEach((el) => (el.inert = false));
  updateUI(); // drops an unsaved theme preview
  settingsButton.focus({ preventScroll: true });
}

// ---------- Themes ----------

const themeInputs = [...document.querySelectorAll('input[name="theme"]')];

function selectedTheme() {
  return themeInputs.find((input) => input.checked)?.value ?? settings.get("theme");
}

// Custom colors only drive the Classic theme.
function syncCustomColors(theme) {
  const classic = theme === CLASSIC_THEME;
  $("customColors").hidden = !classic;
  $("customColorsHint").hidden = classic;
  $("customColorsHint").textContent = "Choose Classic to use your own background and button colors.";
}

for (const input of themeInputs) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    // Live preview; Cancel restores the saved theme.
    const themeColor = applyTheme(document.documentElement, input.value, {
      bgColor: $("bgColor").value || DEFAULTS.bgColor,
      btColor: $("btColor").value || DEFAULTS.btColor,
    });
    setThemeColor(themeColor);
    syncCustomColors(input.value);
  });
}

function setThemeColor(color) {
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
}

function saveSettings() {
  const ip = deviceInput.value.trim();
  const parsed = ip ? parseDeviceAddress(ip) : { ok: false, empty: true };
  if (ip && !parsed.ok) {
    setDeviceError(parsed.error);
    deviceInput.focus();
    return;
  }
  const previousHost = device.ok ? device.host : "";
  const patch = { deviceIP: parsed.ok ? parsed.host : "" };
  for (const id of TEXT_FIELDS.slice(1)) patch[id] = $(id).value.trim();
  patch.bgColor ||= DEFAULTS.bgColor;
  patch.btColor ||= DEFAULTS.btColor;
  patch.enableVibrator = $("enableVibrator").checked;
  patch.allowNonAscii = $("allowNonAscii").checked;
  patch.keyIntervalMs = $("keyIntervalMs").value;
  patch.theme = selectedTheme();
  const stored = settings.update(patch);

  device = parseDeviceAddress(settings.get("deviceIP"));
  queue.intervalMs = settings.get("keyIntervalMs");
  if ((device.ok ? device.host : "") !== previousHost) {
    // Commands queued for the old address must not go to the new one.
    const cancelled = queue.cancelPending();
    if (cancelled.length) {
      keyboard.reportCancelled(cancelled, "The device address changed, so queued keys were cancelled.");
      showStatus(`Device changed: ${cancelled.length} queued command(s) cancelled.`, "warn");
    }
  }
  closeSettings(); // also applies the saved settings to the UI
  if (!stored) showStatus("This browser blocked storage; settings will be lost when the page closes.", "warn");
}

async function testConnection() {
  const parsed = parseDeviceAddress(deviceInput.value);
  if (!parsed.ok) {
    setDeviceError(parsed.error);
    return;
  }
  setDeviceError("");
  connectionResult.dataset.tone = "";
  connectionResult.textContent = `Contacting ${parsed.host}:6095…`;
  try {
    await transport.send(probeUrl(parsed.host), { addressSpace: parsed.addressSpace });
    connectionResult.dataset.tone = "ok";
    connectionResult.textContent = `Something answered at ${parsed.host}:6095, so the browser can reach it. The TV doesn't confirm individual commands, so check the screen when you press a button.`;
  } catch (error) {
    const permissionState = await refreshPermission(parsed.addressSpace);
    connectionResult.dataset.tone = "error";
    connectionResult.textContent = explainFailure({
      error,
      pageKind: pageContext.kind,
      permissionState,
      host: parsed.host,
      addressSpace: parsed.addressSpace,
    });
  }
  refreshPermission(parsed.addressSpace);
}

function renderConnectionInfo() {
  $("pageContext").textContent = pageContext.summary;
  if (!localNetworkAccessApplies(pageContext.kind, device.ok ? device.addressSpace : "local")) {
    $("permissionInfo").textContent = "The Local Network Access permission doesn't apply to requests from this page to the TV.";
    return;
  }
  const https = pageContext.kind.startsWith("https");
  const text = {
    granted: "Local network access: allowed for this site.",
    prompt: "Local network access: not decided yet. Press Test connection and choose Allow when the browser asks.",
    denied: "Local network access: blocked for this site. Allow it in the browser's site settings, then reload.",
    unsupported: https
      ? "This browser doesn't report a Local Network Access permission. Without it (Firefox, Safari, older Chrome), an HTTPS page usually can't reach an http:// TV. Use current Chrome or Edge, or a local server."
      : "This browser doesn't support Local Network Access permissions.",
  }[permission.state] || "";
  $("permissionInfo").textContent = text;
}

settingsButton.addEventListener("click", () => (isSettingsOpen() ? closeSettings() : openSettings()));
$("settingsCancel").addEventListener("click", closeSettings);
$("settingsSave").addEventListener("click", saveSettings);
$("testConnection").addEventListener("click", testConnection);
deviceInput.addEventListener("input", () => setDeviceError(""));
settingsPanel.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSettings();
  else if (e.key === "Enter" && e.target.matches("input[type=text], input[type=number]")) saveSettings();
});

// ---------- Appearance ----------

function updateUI() {
  for (let i = 1; i <= 4; i++) {
    const value = settings.get("customPackage" + i);
    const button = $("customButton" + i);
    button.parentNode.style.display = value ? "flex" : "none";
    button.setAttribute("aria-label", value ? `Custom button ${i}: ${value}` : `Custom button ${i}`);
  }
  setThemeColor(applyTheme(document.documentElement, settings.get("theme"), {
    bgColor: settings.get("bgColor"),
    btColor: settings.get("btColor"),
  }));
  keyboard.render();
}

// Support "index.html#192.168.1.20" links, as the original version did.
function applyHashDeviceIP() {
  if (location.hash.length < 2) return;
  let hash = location.hash.slice(1);
  try {
    hash = decodeURIComponent(hash);
  } catch {
    // use it as is; parseDeviceAddress rejects anything invalid
  }
  const parsed = parseDeviceAddress(hash);
  if (parsed.ok) settings.update({ deviceIP: parsed.host });
  history.replaceState(null, "", location.pathname + location.search);
}

// Soft keyboard fallback for browsers that overlay it on the page instead of
// resizing (interactive-widget=resizes-content handles Chrome on Android).
if (window.visualViewport) {
  const vv = window.visualViewport;
  const update = () => {
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--kb-offset", `${Math.round(offset)}px`);
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
}

updateUI();
renderConnectionInfo();
refreshPermission();
if (pageContext.kind === "http-public") showStatus(pageContext.summary, "warn", 12000);
