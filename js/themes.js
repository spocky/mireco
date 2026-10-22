// Visual themes. The look itself lives in css/style.css under
// :root[data-theme="…"]; this module only lists them and applies one.
// js/theme-boot.js mirrors applyTheme() before first paint (keep in sync).

export const THEMES = Object.freeze([
  {
    id: "ember",
    name: "Ember",
    description: "Xiaomi orange on graphite, HyperOS-style squircles",
    themeColor: "#0e0e10",
  },
  {
    id: "leanback",
    name: "Leanback",
    description: "Android TV / Google TV dark Material look",
    themeColor: "#1b1c1f",
  },
  {
    id: "frost",
    name: "Frost",
    description: "Light frosted glass, like a white Mi remote",
    themeColor: "#eef0f4",
  },
  {
    id: "classic",
    name: "Classic",
    description: "The original MiReCo look, with your own colors",
    themeColor: null, // uses the custom background color
  },
]);

export const DEFAULT_THEME = "ember";
export const CLASSIC_THEME = "classic";

export function isTheme(id) {
  return THEMES.some((t) => t.id === id);
}

/**
 * Applies a theme to the document root. Custom colors are always set, but
 * only the Classic theme uses them.
 * @returns {string} the browser UI (theme-color) color for this theme
 */
export function applyTheme(root, themeId, { bgColor, btColor }) {
  const theme = THEMES.find((t) => t.id === themeId) ?? THEMES.find((t) => t.id === DEFAULT_THEME);
  root.dataset.theme = theme.id;
  root.style.setProperty("--main-color", btColor);
  root.style.setProperty("--main-bg-color", bgColor);
  return theme.themeColor ?? bgColor;
}
