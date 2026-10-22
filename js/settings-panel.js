// Settings screen: TV connection, shortcut buttons (with the app picker),
// home button, appearance and typing. Edits go into a draft and are only
// stored on Save; Cancel discards them (including a previewed theme).

import { parseDeviceAddress } from "./address.js";
import { renderIcon } from "./app-icons.js";
import {
  APPS, GLYPHS, INPUTS, describeButton, findApp, findInput, formatIconSetting,
  isValidPackageName, normalizeIconText, parseIconSetting, searchApps,
} from "./apps.js";
import { DEFAULTS } from "./settings.js";
import { applyTheme, CLASSIC_THEME } from "./themes.js";

const SLOTS = [1, 2, 3, 4];
const SLOT_PLACES = { 1: "top left", 2: "bottom left", 3: "top right", 4: "bottom right" };
const LAUNCHERS = APPS.filter((a) => a.category === "launcher");

/** "#333" and "#333333" are the same color (jscolor expands short forms). */
export function normalizeColor(value) {
  const v = String(value ?? "").trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : v;
}

/** Keys whose values differ between two settings objects. */
export function changedKeys(current, saved) {
  return Object.keys(current).filter((key) => {
    const a = current[key];
    const b = saved[key];
    if (key === "bgColor" || key === "btColor") return normalizeColor(a) !== normalizeColor(b);
    return String(a) !== String(b);
  });
}

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {{all: () => object, get: (k: string) => any}} deps.settings
 * @param {() => void} deps.onOpen  before opening (e.g. close the keyboard)
 * @param {() => void} deps.onClose after closing (re-applies saved settings)
 * @param {(patch: object) => boolean} deps.onSave stores the patch; false if storage failed
 * @param {(parsed: object) => Promise<{tone: string, message: string}>} deps.testConnection
 * @param {() => void} deps.refreshConnectionInfo
 */
export function createSettingsPanel({ doc, settings, onOpen, onClose, onSave, testConnection, refreshConnectionInfo }) {
  const $ = (id) => doc.getElementById(id);
  const panel = $("settings");
  const openButton = $("settingsButton");
  const deviceInput = $("deviceIP");
  const deviceError = $("deviceIPError");
  const connectionResult = $("connectionResult");
  const saveButton = $("settingsSave");
  const dirtyChip = $("settingsDirty");
  const slider = $("keyIntervalMs");
  const themeInputs = [...panel.querySelectorAll('input[name="theme"]')];
  const background = [".topbar", ".remote-area", "footer", "#keyboardPanel"].map((s) => doc.querySelector(s));
  const colorPickers = new Map();

  // Shortcut buttons and launcher being edited.
  let draft = { slots: {}, launcher: "" };

  // ---------- open / close ----------

  function isOpen() {
    return panel.classList.contains("open");
  }

  function open({ error } = {}) {
    onOpen?.();
    initColorPickers();
    const values = settings.all();
    draft = {
      slots: Object.fromEntries(SLOTS.map((n) => [n, { value: values["customPackage" + n], icon: values["customIcon" + n] }])),
      launcher: values.customLauncher,
    };
    deviceInput.value = values.deviceIP;
    $("bgColor").value = values.bgColor;
    $("btColor").value = values.btColor;
    for (const picker of colorPickers.values()) picker.importColor?.();
    $("enableVibrator").checked = values.enableVibrator;
    $("allowNonAscii").checked = values.allowNonAscii;
    slider.value = values.keyIntervalMs;
    for (const input of themeInputs) input.checked = input.value === values.theme;
    syncCustomColors(values.theme);
    setDeviceError(error);
    connectionResult.textContent = "";
    connectionResult.dataset.tone = "";
    renderSlots();
    renderSliderValue();
    panel.inert = false;
    panel.classList.add("open");
    openButton.setAttribute("aria-expanded", "true");
    background.forEach((el) => el && (el.inert = true));
    refreshConnectionInfo?.();
    updateDirty();
    // Only jump into the IP field (opening the soft keyboard) when it needs fixing.
    (error ? deviceInput : panel).focus({ preventScroll: true });
    panel.querySelector(".settings-scroll").scrollTop = 0;
  }

  function close() {
    if (!isOpen()) return;
    closePicker({ restoreFocus: false });
    for (const picker of colorPickers.values()) picker.hide?.();
    panel.classList.remove("open");
    panel.inert = true;
    openButton.setAttribute("aria-expanded", "false");
    background.forEach((el) => el && (el.inert = false));
    onClose?.();
    openButton.focus({ preventScroll: true });
  }

  function initColorPickers() {
    if (colorPickers.size || typeof globalThis.jscolor !== "function") return;
    for (const id of ["bgColor", "btColor"]) {
      try {
        colorPickers.set(id, new globalThis.jscolor($(id), { hash: true }));
      } catch (err) {
        console.warn("Color picker unavailable", err);
      }
    }
  }

  // ---------- draft → settings ----------

  function collect() {
    const ip = deviceInput.value.trim();
    const parsed = ip ? parseDeviceAddress(ip) : null;
    const patch = {
      deviceIP: parsed?.ok ? parsed.host : ip,
      customLauncher: draft.launcher,
      bgColor: $("bgColor").value.trim() || DEFAULTS.bgColor,
      btColor: $("btColor").value.trim() || DEFAULTS.btColor,
      enableVibrator: $("enableVibrator").checked,
      allowNonAscii: $("allowNonAscii").checked,
      keyIntervalMs: Number(slider.value),
      theme: themeInputs.find((i) => i.checked)?.value ?? settings.get("theme"),
    };
    for (const n of SLOTS) {
      patch["customPackage" + n] = draft.slots[n].value;
      patch["customIcon" + n] = draft.slots[n].value ? draft.slots[n].icon : "";
    }
    return { patch, parsed, ip };
  }

  function updateDirty() {
    const { patch } = collect();
    const dirty = changedKeys(patch, settings.all()).length > 0;
    dirtyChip.hidden = !dirty;
    saveButton.textContent = dirty ? "Save" : "Done";
  }

  function save() {
    const { patch, parsed, ip } = collect();
    if (ip && !parsed.ok) {
      setDeviceError(parsed.error);
      deviceInput.focus();
      deviceInput.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (changedKeys(patch, settings.all()).length === 0) {
      close();
      return;
    }
    const stored = onSave(patch);
    close();
    return stored;
  }

  // ---------- TV connection ----------

  function setDeviceError(message) {
    deviceError.textContent = message || "";
    deviceError.hidden = !message;
    deviceInput.setAttribute("aria-invalid", message ? "true" : "false");
  }

  async function runTest() {
    const parsed = parseDeviceAddress(deviceInput.value);
    if (!parsed.ok) {
      setDeviceError(parsed.error);
      return;
    }
    setDeviceError("");
    connectionResult.dataset.tone = "busy";
    connectionResult.textContent = `Contacting ${parsed.host}:6095…`;
    const { tone, message } = await testConnection(parsed);
    connectionResult.dataset.tone = tone;
    connectionResult.textContent = message;
  }

  // ---------- shortcut slots ----------

  function renderSlots() {
    for (const n of SLOTS) {
      const button = panel.querySelector(`.slot[data-slot="${n}"]`);
      const { value, icon } = draft.slots[n];
      const info = describeButton(value, icon);
      renderIcon(button.querySelector(".slot-tile"), info?.icon ?? null);
      button.classList.toggle("empty", !info);
      button.querySelector(".slot-name").textContent = info ? info.name : "Add app";
      button.querySelector(".slot-sub").textContent = info
        ? (info.kind === "input" ? "TV input" : info.value)
        : `Empty · ${SLOT_PLACES[n]}`;
      button.setAttribute("aria-label", `Shortcut ${n} (${SLOT_PLACES[n]}): ${info ? info.name : "empty, add an app"}`);
    }
    const launcher = draft.launcher ? describeButton(draft.launcher) : null;
    $("homeRowValue").textContent = launcher ? `Opens ${launcher.name}` : "TV home screen";
  }

  // ---------- app picker ----------

  const picker = $("appPicker");
  const pickerCard = picker.querySelector(".picker-card");
  const search = $("pickerSearch");
  const packageInput = $("pickerPackage");
  const textInput = $("pickerText");
  let target = null; // 1..4 or "home"
  let customIcon = ""; // icon setting for the "Other app" section
  let returnFocus = null;

  function pickerIsOpen() {
    return !picker.hidden;
  }

  function currentValue() {
    return target === "home" ? { value: draft.launcher, icon: "" } : draft.slots[target];
  }

  function optionButton({ label, sub, icon, selected, onPick }) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "app-option";
    button.setAttribute("aria-pressed", selected ? "true" : "false");
    const tile = doc.createElement("span");
    tile.className = "tile slot-tile";
    renderIcon(tile, icon);
    const name = doc.createElement("span");
    name.className = "app-option-name";
    name.textContent = label;
    button.append(tile, name);
    if (sub) button.title = sub;
    button.addEventListener("click", onPick);
    return button;
  }

  function choose(value, icon = "") {
    if (target === "home") draft.launcher = value;
    else draft.slots[target] = { value, icon: value ? icon : "" };
    renderSlots();
    updateDirty();
    closePicker();
  }

  function renderPickerLists() {
    const { value } = currentValue();
    const query = search.value;
    const home = target === "home";

    const homeList = $("pickerHome");
    homeList.replaceChildren();
    if (home) {
      homeList.append(optionButton({
        label: "TV home screen",
        icon: { type: "glyph", id: "home" },
        selected: !value,
        onPick: () => choose(""),
      }));
    }

    const apps = searchApps(query, home ? LAUNCHERS : APPS);
    const appsList = $("pickerApps");
    appsList.replaceChildren(...apps.map((app) => optionButton({
      label: app.name,
      sub: app.package,
      icon: { type: "brand", app },
      selected: app.package === value,
      onPick: () => choose(app.package),
    })));

    const inputs = home ? [] : searchApps(query, INPUTS);
    $("pickerInputs").replaceChildren(...inputs.map((input) => optionButton({
      label: input.name,
      icon: { type: "input", number: input.number },
      selected: findInput(value)?.value === input.value,
      onPick: () => choose(input.value),
    })));
    $("pickerInputsSection").hidden = home || inputs.length === 0;
    $("pickerNoResults").hidden = apps.length + inputs.length > 0;
  }

  function renderGlyphChoices() {
    const choices = [
      { setting: "", label: "Automatic", icon: { type: "text", text: "Auto" } },
      ...GLYPHS.map((g) => ({ setting: `glyph:${g.id}`, label: g.name, icon: { type: "glyph", id: g.id } })),
      { setting: "text:", label: "Letters", icon: { type: "text", text: "Aa" } },
    ];
    const isText = customIcon.startsWith("text:");
    $("pickerGlyphs").replaceChildren(...choices.map((choice) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "glyph-choice";
      button.setAttribute("role", "radio");
      const checked = choice.setting === "text:" ? isText : choice.setting === customIcon;
      button.setAttribute("aria-checked", checked ? "true" : "false");
      button.setAttribute("aria-label", choice.label);
      button.title = choice.label;
      const tile = doc.createElement("span");
      tile.className = "tile";
      renderIcon(tile, choice.icon);
      button.append(tile);
      button.addEventListener("click", () => {
        customIcon = choice.setting === "text:" ? formatIconSetting({ type: "text", text: textInput.value || "?" }) || "text:?" : choice.setting;
        $("pickerTextRow").hidden = choice.setting !== "text:";
        if (choice.setting === "text:") textInput.focus();
        renderGlyphChoices();
        renderPreview();
      });
      return button;
    }));
  }

  function renderPreview() {
    const pkg = packageInput.value.trim();
    const info = describeButton(pkg || "com.example.app", target === "home" ? "" : customIcon);
    renderIcon($("pickerPreview"), info.icon);
    $("pickerPreviewName").textContent = pkg ? info.name : "Enter a package name";
    packageInput.removeAttribute("aria-invalid");
    $("pickerPackageHint").classList.remove("field-error");
    $("pickerPackageHint").textContent = "Find it in the app's Play Store address (id=…) or in the TV's app info.";
    const known = findApp(pkg);
    if (known) $("pickerPackageHint").textContent = `That's ${known.name}; its icon is used unless you pick another.`;
  }

  function openPicker(slot, opener) {
    target = slot;
    returnFocus = opener;
    const home = slot === "home";
    $("pickerTitle").textContent = home ? "Home button" : `Shortcut ${slot} · ${SLOT_PLACES[slot]}`;
    $("pickerHomeSection").hidden = !home;
    $("pickerAppsTitle").textContent = home ? "Launchers" : "Popular apps";
    $("pickerIconSection").hidden = home;
    $("pickerFoot").hidden = home || !currentValue().value;
    search.value = "";
    const { value, icon } = currentValue();
    const custom = value && !findApp(value) && !findInput(value);
    packageInput.value = custom ? value : "";
    customIcon = custom ? icon : (home ? "" : icon);
    if (findApp(value) && !home) packageInput.value = "";
    const parsedIcon = parseIconSetting(customIcon);
    textInput.value = parsedIcon.type === "text" ? parsedIcon.text : "";
    $("pickerTextRow").hidden = parsedIcon.type !== "text";
    renderPickerLists();
    renderGlyphChoices();
    renderPreview();
    picker.hidden = false;
    panel.querySelectorAll(".settings-bar, .settings-scroll, .settings-actions").forEach((el) => (el.inert = true));
    picker.querySelector(".picker-scroll").scrollTop = 0;
    pickerCard.focus({ preventScroll: true });
  }

  function closePicker({ restoreFocus = true } = {}) {
    if (!pickerIsOpen()) return;
    picker.hidden = true;
    panel.querySelectorAll(".settings-bar, .settings-scroll, .settings-actions").forEach((el) => (el.inert = false));
    if (restoreFocus) returnFocus?.focus({ preventScroll: true });
  }

  function useCustom() {
    const pkg = packageInput.value.trim();
    const input = findInput(pkg);
    if (input && target !== "home") return choose(input.value);
    if (!isValidPackageName(pkg)) {
      packageInput.setAttribute("aria-invalid", "true");
      const hint = $("pickerPackageHint");
      hint.classList.add("field-error");
      hint.textContent = pkg
        ? `"${pkg}" isn't a package name. It looks like com.company.app (letters, digits, dots).`
        : "Enter the app's package name first, e.g. com.company.app.";
      packageInput.focus();
      return;
    }
    choose(pkg, target === "home" ? "" : customIcon);
  }

  // ---------- appearance / typing ----------

  function syncCustomColors(theme) {
    const classic = theme === CLASSIC_THEME;
    $("customColors").hidden = !classic;
    $("customColorsHint").hidden = classic;
  }

  function renderSliderValue() {
    $("keyIntervalValue").textContent = `${slider.value} ms`;
  }

  // ---------- wiring (once) ----------

  openButton.addEventListener("click", () => (isOpen() ? close() : open()));
  $("settingsClose").addEventListener("click", close);
  $("settingsCancel").addEventListener("click", close);
  saveButton.addEventListener("click", save);
  $("testConnection").addEventListener("click", runTest);
  deviceInput.addEventListener("input", () => setDeviceError(""));
  slider.addEventListener("input", renderSliderValue);

  for (const button of panel.querySelectorAll(".slot, #homeRow")) {
    button.addEventListener("click", () => openPicker(button.dataset.slot === "home" ? "home" : Number(button.dataset.slot), button));
  }
  $("pickerClose").addEventListener("click", () => closePicker());
  picker.addEventListener("click", (e) => {
    if (e.target === picker) closePicker(); // backdrop
  });
  search.addEventListener("input", renderPickerLists);
  packageInput.addEventListener("input", renderPreview);
  textInput.addEventListener("input", () => {
    customIcon = formatIconSetting({ type: "text", text: normalizeIconText(textInput.value) || "?" });
    renderPreview();
  });
  $("pickerUseCustom").addEventListener("click", useCustom);
  $("pickerRemove").addEventListener("click", () => choose(""));

  for (const input of themeInputs) {
    input.addEventListener("change", () => {
      if (!input.checked) return;
      // Live preview; Cancel restores the saved theme.
      const themeColor = applyTheme(doc.documentElement, input.value, {
        bgColor: $("bgColor").value || DEFAULTS.bgColor,
        btColor: $("btColor").value || DEFAULTS.btColor,
      });
      doc.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);
      syncCustomColors(input.value);
    });
  }

  // Any edit outside the picker may change the dirty state.
  panel.addEventListener("input", (e) => {
    if (!picker.contains(e.target)) updateDirty();
  });
  panel.addEventListener("change", (e) => {
    if (!picker.contains(e.target)) updateDirty();
  });

  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (pickerIsOpen()) closePicker();
      else close();
    } else if (e.key === "Enter" && e.target.matches("input[type=text]")) {
      e.preventDefault();
      if (e.target === packageInput || e.target === textInput) useCustom();
      else if (!pickerIsOpen()) save();
    }
  });

  return { open, close, isOpen, setDeviceError };
}
