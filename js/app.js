// MiReCo UI controller: remote buttons, settings, status and wiring of the
// transport, command queue and keyboard panel.

import { parseDeviceAddress } from "./address.js";
import { renderIcon } from "./app-icons.js";
import { describeButton } from "./apps.js";
import { controllerUrl, customButtonParams, homeParams, keyEventParams, probeUrl } from "./commands.js";
import { CommandQueue } from "./command-queue.js";
import { createKeyboardPanel } from "./keyboard-panel.js";
import { createSettingsPanel } from "./settings-panel.js";
import { createSettingsStore } from "./settings.js";
import { applyTheme } from "./themes.js";
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
    settingsPanel.open({ error: device.error });
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
  onOpen: () => settingsPanel.close(),
  onNeedsDevice: (message) => showStatus(message + " Open Settings to set it.", "warn"),
});

window.addEventListener("beforeunload", (e) => {
  if (keyboard.hasUnsentWork()) e.preventDefault();
});

// ---------- Settings ----------

const settingsPanel = createSettingsPanel({
  doc: document,
  settings,
  onOpen: () => {
    keyboard.close({ restoreFocus: false });
    refreshPermission();
  },
  onClose: () => updateUI(), // also drops an unsaved theme preview
  onSave: saveSettings,
  testConnection,
  refreshConnectionInfo: renderConnectionInfo,
});

function saveSettings(patch) {
  const previousHost = device.ok ? device.host : "";
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
  if (!stored) showStatus("This browser blocked storage; settings will be lost when the page closes.", "warn");
  return stored;
}

async function testConnection(parsed) {
  try {
    await transport.send(probeUrl(parsed.host), { addressSpace: parsed.addressSpace });
    refreshPermission(parsed.addressSpace);
    return {
      tone: "ok",
      message: `Something answered at ${parsed.host}:6095, so the browser can reach it. The TV doesn't confirm individual commands, so check the screen when you press a button.`,
    };
  } catch (error) {
    const permissionState = await refreshPermission(parsed.addressSpace);
    return {
      tone: "error",
      message: explainFailure({ error, pageKind: pageContext.kind, permissionState, host: parsed.host, addressSpace: parsed.addressSpace }),
    };
  }
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

// ---------- Appearance ----------

function updateUI() {
  for (let i = 1; i <= 4; i++) {
    const info = describeButton(settings.get("customPackage" + i), settings.get("customIcon" + i));
    const button = $("customButton" + i);
    button.parentNode.style.display = info ? "flex" : "none";
    if (info) renderIcon(button, info.icon);
    button.setAttribute("aria-label", info ? info.action : `Shortcut ${i}`);
  }
  const themeColor = applyTheme(document.documentElement, settings.get("theme"), {
    bgColor: settings.get("bgColor"),
    btColor: settings.get("btColor"),
  });
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);
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
