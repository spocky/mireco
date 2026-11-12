import { test } from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_DOCK_ORDER, DOCK_KEYS, moveItem, neighborSlot, parseDockOrder, swapSlots } from "../js/arrange.js";
import { createSettingsStore } from "../js/settings.js";

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

test("dock order parsing accepts permutations only", () => {
  assert.deepEqual(parseDockOrder("back,home,menu"), ["back", "home", "menu"]);
  assert.deepEqual(parseDockOrder(" menu , back,home"), ["menu", "back", "home"]);
  for (const bad of ["", "home,back", "home,home,menu", "home,back,menu,home", "home,back,power", null, undefined]) {
    assert.deepEqual(parseDockOrder(bad), [...DOCK_KEYS], String(bad));
  }
  assert.equal(DEFAULT_DOCK_ORDER, "home,back,menu");
});

test("moveItem moves one item and shifts the rest", () => {
  assert.deepEqual(moveItem(["home", "back", "menu"], 0, 2), ["back", "menu", "home"]);
  assert.deepEqual(moveItem(["home", "back", "menu"], 2, 0), ["menu", "home", "back"]);
  assert.deepEqual(moveItem(["home", "back", "menu"], 1, 1), ["home", "back", "menu"]);
  assert.deepEqual(moveItem(["home", "back", "menu"], 0, 5), ["home", "back", "menu"], "out of range is a no-op");
  const original = ["a", "b"];
  moveItem(original, 0, 1);
  assert.deepEqual(original, ["a", "b"], "doesn't mutate");
});

test("swapSlots swaps package and icon together", () => {
  const slots = {
    1: { value: "com.netflix.ninja", icon: "" },
    2: { value: "", icon: "" },
    3: { value: "com.example.app", icon: "text:EX" },
    4: { value: "HDMI1", icon: "" },
  };
  const out = swapSlots(slots, 3, 2);
  assert.deepEqual(out[2], { value: "com.example.app", icon: "text:EX" });
  assert.deepEqual(out[3], { value: "", icon: "" });
  assert.deepEqual(out[1], slots[1]);
  assert.deepEqual(slots[3], { value: "com.example.app", icon: "text:EX" }, "doesn't mutate");
});

test("arrow keys find the neighbouring shortcut place (1 2 left, 3 4 right)", () => {
  assert.equal(neighborSlot(1, "ArrowRight"), 3);
  assert.equal(neighborSlot(1, "ArrowDown"), 2);
  assert.equal(neighborSlot(4, "ArrowLeft"), 2);
  assert.equal(neighborSlot(4, "ArrowUp"), 3);
  assert.equal(neighborSlot(1, "ArrowLeft"), null);
  assert.equal(neighborSlot(2, "ArrowDown"), null);
  assert.equal(neighborSlot(3, "Enter"), null);
});

test("dock order is stored, validated and defaults to home, back, menu", () => {
  const storage = memoryStorage();
  const store = createSettingsStore({ storage, doc: null });
  assert.equal(store.load().dockOrder, "home,back,menu");
  store.update({ dockOrder: "menu,home,back" });
  assert.equal(createSettingsStore({ storage, doc: null }).load().dockOrder, "menu,home,back");
  store.update({ dockOrder: "home,home,home" });
  assert.equal(store.get("dockOrder"), "home,back,menu");
  storage.setItem("mireco.dockOrder", "junk");
  assert.equal(createSettingsStore({ storage, doc: null }).load().dockOrder, "home,back,menu");
});
