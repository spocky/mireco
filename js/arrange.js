// Arrange mode: rearrange the bottom-bar buttons and the shortcut buttons on
// the remote by dragging them (touch, pen or mouse) or with arrow keys.
//
// Long-press a bottom-bar or shortcut button (or use Settings → "Arrange on
// the remote") to start. While arranging, nothing is sent to the TV; buttons
// wiggle, a bar offers Done/Cancel, and empty shortcut positions appear as
// placeholders that can be dropped onto.
//
// Bottom bar: dragging moves a button to the drop position (order changes).
// Shortcuts: they sit in fixed places (two left, two right of the volume
// keys), so dropping one on another swaps the two.
//
// Built on Pointer Events because HTML5 drag-and-drop doesn't work with touch.

export const DOCK_KEYS = Object.freeze(["home", "back", "menu"]);
export const DEFAULT_DOCK_ORDER = DOCK_KEYS.join(",");
export const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP = 10; // px the finger may move before a long-press is abandoned
const DRAG_THRESHOLD = 6; // px before a press in arrange mode becomes a drag
const SLOT_PLACES = { 1: "top left", 2: "bottom left", 3: "top right", 4: "bottom right" };
// Shortcut positions on the remote: [column, row].
const SLOT_GRID = { 1: [0, 0], 2: [0, 1], 3: [1, 0], 4: [1, 1] };

/** "back,home,menu" → ["back","home","menu"]; anything invalid → default order. */
export function parseDockOrder(value) {
  const keys = String(value ?? "").split(",").map((k) => k.trim());
  const valid = keys.length === DOCK_KEYS.length && DOCK_KEYS.every((k) => keys.includes(k));
  return valid ? keys : [...DOCK_KEYS];
}

/** Moves the item at `from` to index `to` (other items shift). Returns a new array. */
export function moveItem(list, from, to) {
  const out = [...list];
  if (from < 0 || from >= out.length || to < 0 || to >= out.length || from === to) return out;
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item);
  return out;
}

/** Swaps two shortcut slots (1-based). `slots` is {1: {value, icon}, ...}. */
export function swapSlots(slots, a, b) {
  const out = { ...slots };
  [out[a], out[b]] = [slots[b], slots[a]];
  return out;
}

/** The shortcut position next to `slot` in an arrow-key direction, or null. */
export function neighborSlot(slot, direction) {
  const [col, row] = SLOT_GRID[slot];
  const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[direction];
  if (!delta) return null;
  const target = [col + delta[0], row + delta[1]];
  const found = Object.entries(SLOT_GRID).find(([, [c, r]]) => c === target[0] && r === target[1]);
  return found ? Number(found[0]) : null;
}

/**
 * @param {object} deps
 * @param {Document} deps.doc
 * @param {{all: () => object}} deps.settings
 * @param {(values: object, options: {arranging: boolean}) => void} deps.renderRemote
 * @param {(patch: object) => void} deps.onApply   stores the new layout
 * @param {() => void} [deps.onEnter]  e.g. close the keyboard panel and settings
 * @param {(ms?: number) => void} [deps.vibrate]
 * @param {(slot: number) => string} [deps.describeSlot] name for announcements
 */
export function createArrangeMode({ doc, settings, renderRemote, onApply, onEnter, vibrate, describeSlot = (n) => `Shortcut ${n}` }) {
  const win = doc.defaultView;
  const $ = (id) => doc.getElementById(id);
  const bar = $("arrangeBar");
  const status = $("arrangeStatus");
  const items = [...doc.querySelectorAll("[data-arrange]")];
  const dimmed = [".topbar", ".remote", ".vol"].map((s) => doc.querySelector(s));

  let active = false;
  let draft = null; // {slots: {1..4: {value, icon}}, dock: [...]}
  let longPress = null; // {item, pointerId, x, y, timer}
  let drag = null; // {item, group, pointerId, x, y, dragging, target}
  let suppressNextClick = false; // the click produced by releasing a long-press

  function draftFromSettings() {
    const values = settings.all();
    return {
      slots: Object.fromEntries([1, 2, 3, 4].map((n) => [n, { value: values["customPackage" + n], icon: values["customIcon" + n] }])),
      dock: parseDockOrder(values.dockOrder),
    };
  }

  function draftValues() {
    const values = { dockOrder: draft.dock.join(",") };
    for (const n of [1, 2, 3, 4]) {
      values["customPackage" + n] = draft.slots[n].value;
      values["customIcon" + n] = draft.slots[n].value ? draft.slots[n].icon : "";
    }
    return values;
  }

  function render() {
    renderRemote(active ? { ...settings.all(), ...draftValues() } : settings.all(), { arranging: active });
  }

  function announce(message) {
    status.textContent = message;
  }

  function enter() {
    if (active) return;
    onEnter?.();
    draft = draftFromSettings();
    active = true;
    doc.body.classList.add("arranging");
    dimmed.forEach((el) => el && (el.inert = true));
    bar.hidden = false;
    for (const item of items) item.setAttribute("aria-roledescription", "movable button");
    render();
    vibrate?.(30);
    announce("Arrange mode. Drag buttons, or focus one and use the arrow keys. Press Done to keep the layout.");
    $("arrangeDone").focus({ preventScroll: true });
  }

  function exit(save) {
    if (!active) return;
    cancelDrag();
    if (save) onApply(draftValues());
    active = false;
    draft = null;
    doc.body.classList.remove("arranging");
    dimmed.forEach((el) => el && (el.inert = false));
    bar.hidden = true;
    for (const item of items) item.removeAttribute("aria-roledescription");
    render();
    announce(save ? "Layout saved." : "Changes discarded.");
  }

  // ---------- moves ----------

  function moveDock(key, to) {
    const from = draft.dock.indexOf(key);
    if (to < 0 || to >= draft.dock.length || from === to) return false;
    draft.dock = moveItem(draft.dock, from, to);
    render();
    announce(`${key[0].toUpperCase()}${key.slice(1)} moved to position ${to + 1} of ${draft.dock.length}.`);
    return true;
  }

  function swap(a, b) {
    if (!b || a === b) return false;
    draft.slots = swapSlots(draft.slots, a, b);
    render();
    announce(`Moved to ${SLOT_PLACES[b]}: ${describeSlot(b, draft.slots[b])}.`);
    return true;
  }

  function drop(item, target) {
    if (item.dataset.arrange === "dock") {
      return moveDock(item.dataset.dock, draft.dock.indexOf(target.dataset.dock));
    }
    return swap(Number(item.dataset.app), Number(target.dataset.app));
  }

  // ---------- long-press to start ----------

  function startLongPress(e, item) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelLongPress();
    longPress = {
      item,
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      timer: win.setTimeout(() => {
        const { pointerId, x, y } = longPress;
        longPress = null;
        // The click that follows releasing this press must not reach the TV.
        suppressNextClick = true;
        enter();
        // Keep the finger down and drag straight away, like a phone home screen.
        drag = { item, group: item.dataset.arrange, pointerId, x, y, dragging: false, target: null };
      }, LONG_PRESS_MS),
    };
  }

  function cancelLongPress() {
    if (longPress) win.clearTimeout(longPress.timer);
    longPress = null;
  }

  // ---------- dragging ----------

  function findTarget(x, y, group, item) {
    for (const el of doc.elementsFromPoint(x, y)) {
      const candidate = el.closest?.(`[data-arrange="${group}"]`);
      if (candidate && candidate !== item) return candidate;
    }
    return null;
  }

  function setTarget(target) {
    if (drag.target === target) return;
    drag.target?.classList.remove("drop-target");
    drag.target = target;
    target?.classList.add("drop-target");
  }

  function cancelDrag() {
    if (!drag) return;
    drag.item.classList.remove("dragging");
    drag.item.style.removeProperty("transform");
    drag.target?.classList.remove("drop-target");
    drag = null;
  }

  function onPointerDown(e) {
    const item = e.currentTarget;
    if (!active) {
      startLongPress(e, item);
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    cancelDrag();
    drag = { item, group: item.dataset.arrange, pointerId: e.pointerId, x: e.clientX, y: e.clientY, dragging: false, target: null };
  }

  function onPointerMove(e) {
    if (longPress && e.pointerId === longPress.pointerId) {
      if (Math.hypot(e.clientX - longPress.x, e.clientY - longPress.y) > LONG_PRESS_SLOP) cancelLongPress();
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.dragging) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.dragging = true;
      drag.item.classList.add("dragging");
    }
    e.preventDefault();
    drag.item.style.transform = `translate(${dx}px, ${dy}px)`;
    setTarget(findTarget(e.clientX, e.clientY, drag.group, drag.item));
  }

  function onPointerUp(e) {
    if (longPress && e.pointerId === longPress.pointerId) cancelLongPress();
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { item, target, dragging } = drag;
    cancelDrag();
    if (dragging && target && drop(item, target)) {
      vibrate?.(15);
      // Focus follows the moved button (moved DOM nodes lose focus).
      const focusEl = item.dataset.arrange === "dock" ? item : target;
      focusEl.focus({ preventScroll: true });
    }
  }

  function onPointerCancel(e) {
    if (longPress && e.pointerId === longPress.pointerId) cancelLongPress();
    if (drag && e.pointerId === drag.pointerId) cancelDrag();
  }

  // ---------- keyboard ----------

  function onKeyDown(e) {
    if (!active) return;
    const item = e.currentTarget;
    let moved = false;
    if (item.dataset.arrange === "dock") {
      const step = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
      if (step) {
        moved = moveDock(item.dataset.dock, draft.dock.indexOf(item.dataset.dock) + step);
        item.focus({ preventScroll: true }); // re-ordering the DOM drops focus
      }
    } else {
      const slot = Number(item.dataset.app);
      const target = neighborSlot(slot, e.key);
      if (target) {
        moved = swap(slot, target);
        doc.querySelector(`[data-arrange="slot"][data-app="${target}"]`)?.focus({ preventScroll: true });
      }
    }
    if (moved || e.key.startsWith("Arrow")) e.preventDefault();
  }

  // ---------- wiring (once) ----------

  for (const item of items) {
    item.addEventListener("pointerdown", onPointerDown);
    item.addEventListener("keydown", onKeyDown);
    item.addEventListener("contextmenu", (e) => e.preventDefault()); // long-press menu
  }
  // A new press starts a new gesture: only the release of the long-press itself is swallowed.
  doc.addEventListener("pointerdown", () => (suppressNextClick = false), { capture: true });
  doc.addEventListener("pointermove", onPointerMove, { passive: false });
  doc.addEventListener("pointerup", onPointerUp);
  doc.addEventListener("pointercancel", onPointerCancel);
  doc.addEventListener("keydown", (e) => {
    if (active && e.key === "Escape") {
      e.preventDefault();
      exit(false);
    }
  });
  $("arrangeDone").addEventListener("click", () => exit(true));
  $("arrangeCancel").addEventListener("click", () => exit(false));

  return {
    enter,
    exit,
    get active() {
      return active;
    },
    /** True while arranging, or for the click produced by the long-press that started it. */
    shouldSuppressClick() {
      const suppress = active || suppressNextClick;
      suppressNextClick = false;
      return suppress;
    },
    // Exposed for tests.
    moveDock: (key, to) => active && moveDock(key, to),
    swap: (a, b) => active && swap(a, b),
  };
}
