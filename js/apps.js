// Shortcut button catalog: popular TV apps, HDMI inputs, launchers and the
// generic icons offered for custom apps. No DOM here (see app-icons.js).
//
// App icons are simple brand-colored tiles drawn for MiReCo, not official
// logos. Package names are the usual Android TV ones; regional or firmware
// builds can differ, so users can always enter a package by hand.

// Each `svg` is drawn on a 24×24 grid in `fg` (currentColor) on `bg`.
const text = (label, size = 9, y = 15.2, weight = 800) =>
  `<text x="12" y="${y}" text-anchor="middle" font-family="system-ui,Segoe UI,Roboto,sans-serif" font-size="${size}" font-weight="${weight}" fill="currentColor">${label}</text>`;
const PLAY = '<path d="M9.4 7.2v9.6l7.8-4.8z" fill="currentColor"/>';

export const APPS = Object.freeze([
  { id: "youtube", name: "YouTube", package: "com.google.android.youtube.tv", category: "video", bg: "#ff0000", fg: "#fff", svg: PLAY },
  { id: "youtube-kids", name: "YouTube Kids", package: "com.google.android.youtube.tvkids", category: "video", bg: "#ff4e45", fg: "#fff", svg: text("kids", 8.5) },
  { id: "youtube-music", name: "YouTube Music", package: "com.google.android.youtube.tvmusic", category: "music", bg: "#ff0000", fg: "#fff", svg: '<circle cx="12" cy="12" r="7.2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.4 8.9v6.2l5-3.1z" fill="currentColor"/>' },
  { id: "smarttube", name: "SmartTube", package: "com.teamsmart.videomanager.tv", category: "video", bg: "#c4302b", fg: "#fff", svg: '<rect x="4" y="6.5" width="16" height="11" rx="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10.5 9.4v5.2l4.3-2.6z" fill="currentColor"/>' },
  { id: "netflix", name: "Netflix", package: "com.netflix.ninja", category: "video", bg: "#000", fg: "#e50914", svg: text("N", 15, 17.3, 900) },
  { id: "prime-video", name: "Prime Video", package: "com.amazon.amazonvideo.livingroom", category: "video", bg: "#00a8e1", fg: "#fff", svg: text("prime", 7.2, 12.6) + '<path d="M7.3 15.2c3 1.7 6.4 1.7 9.4 0" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M15.4 14.4l1.6.5-.5 1.6" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>' },
  { id: "disney-plus", name: "Disney+", package: "com.disney.disneyplus", category: "video", bg: "#0e2f73", fg: "#fff", svg: text("D+", 10.5, 15.8) },
  { id: "max", name: "Max", package: "com.wbd.stream", category: "video", bg: "#002be7", fg: "#fff", svg: text("max", 9) },
  { id: "apple-tv", name: "Apple TV", package: "com.apple.atve.androidtv.appletv", category: "video", bg: "#000", fg: "#fff", svg: text("tv", 11, 15.8) },
  { id: "paramount-plus", name: "Paramount+", package: "com.cbs.ott", category: "video", bg: "#0064ff", fg: "#fff", svg: text("P+", 10.5, 15.8) },
  { id: "crunchyroll", name: "Crunchyroll", package: "com.crunchyroll.crunchyroid", category: "video", bg: "#f47521", fg: "#fff", svg: text("CR", 9.5, 15.5) },
  { id: "dazn", name: "DAZN", package: "com.dazn", category: "video", bg: "#0c161c", fg: "#f8fc00", svg: text("DAZN", 6.6, 14.4) },
  { id: "pluto-tv", name: "Pluto TV", package: "tv.pluto.android", category: "video", bg: "#121212", fg: "#fff200", svg: text("pluto", 7.4, 14.6) },
  { id: "twitch", name: "Twitch", package: "tv.twitch.android.app", category: "video", bg: "#9146ff", fg: "#fff", svg: '<path d="M6.5 5h12v8.6L15.6 16.5h-3l-2.2 2.2H8.6v-2.2H6.5z" fill="currentColor"/><path d="M11 8.4v3.8M14.6 8.4v3.8" stroke="#9146ff" stroke-width="1.6"/>' },
  { id: "plex", name: "Plex", package: "com.plexapp.android", category: "video", bg: "#1f1f1f", fg: "#e5a00d", svg: '<path d="M8.6 5h4.2l5 7-5 7H8.6l5-7z" fill="currentColor"/>' },
  { id: "kodi", name: "Kodi", package: "org.xbmc.kodi", category: "video", bg: "#17b2e7", fg: "#fff", svg: text("kodi", 8.4) },
  { id: "vlc", name: "VLC", package: "org.videolan.vlc", category: "video", bg: "#ff8800", fg: "#fff", svg: '<path d="M12 4.4l5.6 14.4H6.4z" fill="currentColor"/><path d="M9.2 11.4h5.6M8 14.9h8" stroke="#ff8800" stroke-width="1.5"/>' },
  { id: "spotify", name: "Spotify", package: "com.spotify.tv.android", category: "music", bg: "#1db954", fg: "#000", svg: '<g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6.6 9.4c3.7-1.2 7.6-.9 10.9 1"/><path d="M7.3 12.4c3-.9 6.1-.6 8.7.9"/><path d="M8 15.2c2.3-.6 4.6-.4 6.6.7"/></g>' },
  { id: "play-store", name: "Play Store", package: "com.android.vending", category: "store", bg: "#fff", fg: "#01875f", svg: '<path d="M8 5.2v13.6L19.3 12z" fill="currentColor"/>' },
  { id: "projectivy", name: "Projectivy Launcher", package: "com.spocky.projengmenu", category: "launcher", bg: "#24303a", fg: "#fff", svg: '<g fill="currentColor"><rect x="5" y="5" width="6" height="6" rx="1.5"/><rect x="13" y="5" width="6" height="6" rx="1.5"/><rect x="5" y="13" width="6" height="6" rx="1.5"/><rect x="13" y="13" width="6" height="6" rx="3" opacity=".6"/></g>' },
  { id: "flauncher", name: "FLauncher", package: "me.efesser.flauncher", category: "launcher", bg: "#3b2f63", fg: "#fff", svg: text("F", 13, 16.8, 900) },
]);

export const INPUTS = Object.freeze([
  { id: "hdmi1", name: "HDMI 1", value: "HDMI1", number: "1" },
  { id: "hdmi2", name: "HDMI 2", value: "HDMI2", number: "2" },
  { id: "hdmi3", name: "HDMI 3", value: "HDMI3", number: "3" }, // not supported by GiTV <= 1.3.97
]);

// Generic icons for custom apps (symbols in index.html's sprite: #i-<id>).
export const GLYPHS = Object.freeze([
  { id: "apps", name: "App" },
  { id: "movie", name: "Movies" },
  { id: "live", name: "Live TV" },
  { id: "music", name: "Music" },
  { id: "game", name: "Games" },
  { id: "web", name: "Web" },
  { id: "star", name: "Favorite" },
  { id: "tune", name: "Settings" },
]);

export const MAX_TEXT_ICON = 3;

const PACKAGE_NAME = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** Android application id: at least two dot-separated segments. */
export function isValidPackageName(value) {
  return PACKAGE_NAME.test(String(value ?? "").trim());
}

export function findApp(packageName) {
  const pkg = String(packageName ?? "").trim();
  return APPS.find((a) => a.package === pkg) ?? null;
}

export function findInput(value) {
  const v = String(value ?? "").trim().toUpperCase();
  return INPUTS.find((i) => i.value === v) ?? null;
}

/** Keep at most MAX_TEXT_ICON visible characters (code points). */
export function normalizeIconText(value) {
  return [...String(value ?? "").trim()].slice(0, MAX_TEXT_ICON).join("");
}

/**
 * Icon setting format (stored as customIconN):
 *   ""            automatic (the app's tile if known, otherwise a generic icon)
 *   "glyph:movie" one of GLYPHS
 *   "text:AB"     up to three characters
 */
export function parseIconSetting(setting) {
  const s = String(setting ?? "");
  if (s.startsWith("glyph:")) {
    const id = s.slice(6);
    if (GLYPHS.some((g) => g.id === id)) return { type: "glyph", id };
  } else if (s.startsWith("text:")) {
    const value = normalizeIconText(s.slice(5));
    if (value) return { type: "text", text: value };
  }
  return { type: "auto" };
}

export function formatIconSetting(icon) {
  if (icon?.type === "glyph") return `glyph:${icon.id}`;
  if (icon?.type === "text" && normalizeIconText(icon.text)) return `text:${normalizeIconText(icon.text)}`;
  return "";
}

function shortName(packageName) {
  const last = packageName.split(".").filter(Boolean).at(-1) ?? packageName;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

/**
 * What a custom button shows and does.
 * @returns {null | {kind: "app"|"input"|"custom", name: string, action: string, value: string,
 *   app?: object, icon: {type: "brand", app: object} | {type: "glyph", id: string} |
 *   {type: "text", text: string} | {type: "input", number: string}}}
 */
export function describeButton(value, iconSetting = "") {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const input = findInput(v);
  if (input) {
    return { kind: "input", name: input.name, action: `Switch to ${input.name}`, value: input.value, icon: { type: "input", number: input.number } };
  }
  const app = findApp(v);
  const chosen = parseIconSetting(iconSetting);
  let icon;
  if (chosen.type !== "auto") icon = chosen;
  else if (app) icon = { type: "brand", app };
  else icon = { type: "glyph", id: "apps" };
  const name = app ? app.name : shortName(v);
  return { kind: app ? "app" : "custom", name, action: `Open ${name}`, value: v, app, icon };
}

/** Case-insensitive search over app names and package names. */
export function searchApps(query, list = APPS) {
  const q = String(query ?? "").trim().toLowerCase();
  if (!q) return [...list];
  return list.filter((a) => a.name.toLowerCase().includes(q) || (a.package ?? a.value ?? "").toLowerCase().includes(q));
}
