import { test } from "node:test";
import assert from "node:assert/strict";

import { CommandQueue } from "../js/command-queue.js";
import { createMockTransport } from "./helpers/fakes.mjs";

const cmd = (kind, label) => ({ kind, url: `http://192.168.1.20:6095/controller?action=keyevent&keycode=${encodeURIComponent(label)}`, label, token: kind === "text" ? { char: label, keycode: label } : undefined });

test("dispatches in FIFO order, one request at a time", async () => {
  const transport = createMockTransport({ delayMs: 3 });
  const queue = new CommandQueue({ send: transport.send, intervalMs: 0 });
  const labels = "abcdefghij".split("");
  labels.forEach((l) => queue.enqueue(cmd("text", l)));
  await queue.idle();
  assert.deepEqual(transport.urls.map((u) => new URL(u).searchParams.get("keycode")), labels);
  assert.equal(transport.maxInFlight, 1);
});

test("keeps the configured gap between requests", async () => {
  const times = [];
  const queue = new CommandQueue({ send: async () => times.push(Date.now()), intervalMs: 40 });
  queue.enqueueAll([cmd("text", "a"), cmd("text", "b"), cmd("text", "c")]);
  await queue.idle();
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 35, `gap ${times[i] - times[i - 1]}ms`);
});

test("remote buttons pressed during text are queued after it", async () => {
  const transport = createMockTransport({ delayMs: 2 });
  const queue = new CommandQueue({ send: transport.send, intervalMs: 0 });
  queue.enqueueAll([cmd("text", "h"), cmd("text", "i")]);
  queue.enqueue(cmd("remote", "enter"));
  await queue.idle();
  assert.deepEqual(transport.urls.map((u) => new URL(u).searchParams.get("keycode")), ["h", "i", "enter"]);
});

test("a failed request is never retried and doesn't block the queue", async () => {
  let calls = 0;
  const events = [];
  const queue = new CommandQueue({
    intervalMs: 0,
    send: async (c) => {
      calls++;
      if (c.label === "up") throw new TypeError("Failed to fetch");
    },
  });
  queue.subscribe((e) => events.push(e.type));
  queue.enqueue(cmd("remote", "up"));
  queue.enqueue(cmd("remote", "down"));
  await queue.idle();
  assert.equal(calls, 2); // "up" once (no retry), then "down"
  assert.ok(events.includes("failed"));
  assert.ok(events.includes("sent"));
});

test("a send() that never settles is cut off by the watchdog", async () => {
  const sent = [];
  const queue = new CommandQueue({
    intervalMs: 0,
    watchdogMs: 30,
    send: (c) => (c.label === "hang" ? new Promise(() => {}) : (sent.push(c.label), Promise.resolve())),
  });
  let failed;
  queue.subscribe((e) => e.type === "failed" && (failed = e));
  queue.enqueue(cmd("remote", "hang"));
  queue.enqueue(cmd("remote", "next"));
  await queue.idle();
  assert.equal(failed.command.label, "hang");
  assert.deepEqual(sent, ["next"]);
});

test("a failed text key cancels the remaining text but not remote commands", async () => {
  const transport = createMockTransport({ failWhen: (c) => c.label === "l" });
  const queue = new CommandQueue({ send: transport.send, intervalMs: 0 });
  let failed;
  queue.subscribe((e) => e.type === "failed" && (failed = e));
  queue.enqueueAll("hello".split("").map((ch) => cmd("text", ch)));
  queue.enqueue(cmd("remote", "back"));
  await queue.idle();
  assert.equal(failed.command.label, "l");
  assert.deepEqual(failed.cancelled.map((c) => c.label), ["l", "o"]);
  const sent = transport.urls.map((u) => new URL(u).searchParams.get("keycode"));
  assert.deepEqual(sent, ["h", "e", "l", "back"]); // first "l" failed, nothing resent
});

test("cancelPending removes commands that haven't been dispatched", async () => {
  const transport = createMockTransport({ delayMs: 5 });
  const queue = new CommandQueue({ send: transport.send, intervalMs: 0 });
  queue.enqueueAll("abcdef".split("").map((ch) => cmd("text", ch)));
  await new Promise((r) => setTimeout(r, 1));
  const cancelled = queue.cancelPending((c) => c.kind === "text");
  await queue.idle();
  assert.ok(cancelled.length >= 4);
  assert.equal(transport.urls.length + cancelled.length, 6);
  const sent = transport.urls.map((u) => new URL(u).searchParams.get("keycode")).join("");
  assert.equal(sent + cancelled.map((c) => c.label).join(""), "abcdef");
});

test("queue size is bounded and batches are all-or-nothing", () => {
  const queue = new CommandQueue({ send: () => new Promise(() => {}), maxPending: 5, intervalMs: 0, watchdogMs: 20 });
  assert.equal(queue.enqueueAll([1, 2, 3].map((n) => cmd("text", String(n)))), true);
  // One is in flight now; 2 pending, 3 free.
  assert.equal(queue.enqueueAll([4, 5, 6, 7].map((n) => cmd("text", String(n)))), false);
  assert.equal(queue.pendingCount, 2);
  assert.equal(queue.enqueueAll([4, 5, 6].map((n) => cmd("text", String(n)))), true);
  assert.equal(queue.enqueue(cmd("remote", "up")), false);
  queue.cancelPending();
});
