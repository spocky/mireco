// Settings persistence.
//
// Settings used to live in cookies with path=/. On GitHub Pages that would
// send the TV's address to github.io with every request and share it with
// every other site under USER.github.io, so settings now live in localStorage
// under a "mireco." prefix. Existing cookies are migrated on first load and
// then removed. If storage is unavailable (private mode, blocked), settings
// still work for the current session.

export const DEFAULTS = Object.freeze({
  deviceIP: "",
  enableVibrator: true,
  customPackage1: "com.google.android.youtube.tv",
  customPackage2: "",
  customPackage3: "com.spocky.projengmenu",
  customPackage4: "",
  customLauncher: "",
  bgColor: "#333",
  btColor: "#fff",
  // New in this version:
  textMode: "auto", // "auto" (buffered words) | "compose" (Compose & Send)
  keyIntervalMs: 80, // gap between consecutive requests
  allowNonAscii: false, // experimental: send non-ASCII characters
});

const PREFIX = "mireco.";
// Settings that existed in the original cookie-based version.
const LEGACY_COOKIE_KEYS = [
  "deviceIP", "enableVibrator", "customPackage1", "customPackage2", "customPackage3",
  "customPackage4", "customLauncher", "bgColor", "btColor",
];

function coerce(key, raw) {
  const def = DEFAULTS[key];
  if (typeof def === "boolean") return raw === true || raw === "true";
  if (typeof def === "number") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : def;
  }
  return String(raw);
}

export function clampInterval(ms) {
  const n = Math.round(Number(ms));
  if (!Number.isFinite(n)) return DEFAULTS.keyIntervalMs;
  return Math.min(1000, Math.max(0, n));
}

function readLegacyCookies(cookieString) {
  const found = {};
  for (const part of String(cookieString || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (!LEGACY_COOKIE_KEYS.includes(name)) continue;
    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value);
    } catch {
      // keep raw value
    }
    found[name] = value;
  }
  return found;
}

/**
 * @param {object} [env]
 * @param {Storage|null} [env.storage]
 * @param {{cookie: string}|null} [env.doc] document-like object for cookie migration
 */
export function createSettingsStore({ storage = safeLocalStorage(), doc = globalThis.document ?? null } = {}) {
  const values = { ...DEFAULTS };
  let persistent = !!storage;

  function load() {
    let anyStored = false;
    if (storage) {
      try {
        for (const key of Object.keys(DEFAULTS)) {
          const raw = storage.getItem(PREFIX + key);
          if (raw !== null) {
            values[key] = coerce(key, raw);
            anyStored = true;
          }
        }
      } catch {
        persistent = false;
      }
    }
    if (!anyStored && doc) {
      const legacy = readLegacyCookies(doc.cookie);
      if (Object.keys(legacy).length) {
        for (const [key, raw] of Object.entries(legacy)) values[key] = coerce(key, raw);
        if (save()) {
          for (const key of Object.keys(legacy)) {
            doc.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
          }
        }
      }
    }
    values.keyIntervalMs = clampInterval(values.keyIntervalMs);
    if (values.textMode !== "compose") values.textMode = "auto";
    return { ...values };
  }

  function save() {
    if (!storage) return false;
    try {
      for (const [key, value] of Object.entries(values)) storage.setItem(PREFIX + key, String(value));
      persistent = true;
      return true;
    } catch {
      persistent = false;
      return false;
    }
  }

  return {
    load,
    get: (key) => values[key],
    all: () => ({ ...values }),
    /** Update values and persist. Returns false if they could not be stored. */
    update(patch) {
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in DEFAULTS)) continue;
        values[key] = coerce(key, value);
      }
      values.keyIntervalMs = clampInterval(values.keyIntervalMs);
      return save();
    },
    get persistent() {
      return persistent;
    },
  };
}

function safeLocalStorage() {
  try {
    const s = globalThis.localStorage;
    if (!s) return null;
    const probe = PREFIX + "probe";
    s.setItem(probe, "1");
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
