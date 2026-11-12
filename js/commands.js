// GiTV HTTP API command definitions and URL construction.
//
//   http://DEVICE_IP:6095/controller?action=keyevent&keycode=up
//   http://DEVICE_IP:6095/controller?action=startapp&type=packagename&packagename=...
//   http://DEVICE_IP:6095/controller?action=changesource&source=hdmi1
//   http://DEVICE_IP:6095/general?action=getVolum   (read-only, used as a probe)

import { DEVICE_PORT } from "./address.js";

// Key names understood by the GiTV "keyevent" action (see README).
export const REMOTE_KEYS = Object.freeze([
  "power", "up", "down", "left", "right", "enter",
  "home", "back", "menu", "volumeup", "volumedown",
]);

// Strict RFC 3986 encoding: encodeURIComponent leaves !'()* untouched.
export function encodeQueryComponent(value) {
  return encodeURIComponent(String(value)).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
}

function hostForUrl(host) {
  return host.includes(":") ? `[${host}]` : host;
}

/**
 * Builds a device URL. Every key and value is percent-encoded individually
 * (spaces become %20, "+" becomes %2B) so no raw character can leak into the
 * query string.
 */
export function buildDeviceUrl(host, path, params) {
  const query = Object.entries(params)
    .map(([k, v]) => `${encodeQueryComponent(k)}=${encodeQueryComponent(v)}`)
    .join("&");
  return `http://${hostForUrl(host)}:${DEVICE_PORT}/${path}?${query}`;
}

export function keyEventParams(keycode) {
  return { action: "keyevent", keycode };
}

export function startAppParams(packageName) {
  return { action: "startapp", type: "packagename", packagename: packageName };
}

const SOURCES = ["hdmi1", "hdmi2", "hdmi3"]; // hdmi3 doesn't work on GiTV <= 1.3.97

/**
 * Parameters for a custom button: an HDMI source or an app package name.
 * Returns null when the button is not configured.
 */
export function customButtonParams(value) {
  const app = String(value ?? "").trim();
  if (!app) return null;
  const lower = app.toLowerCase();
  if (SOURCES.includes(lower)) return { action: "changesource", source: lower };
  return startAppParams(app);
}

/** Home key, or a custom launcher package when one is configured. */
export function homeParams(customLauncher) {
  const app = String(customLauncher ?? "").trim();
  return app ? startAppParams(app) : keyEventParams("home");
}

export function controllerUrl(host, params) {
  return buildDeviceUrl(host, "controller", params);
}

// Harmless read-only request used by "Test connection".
export function probeUrl(host) {
  return buildDeviceUrl(host, "general", { action: "getVolum" });
}
