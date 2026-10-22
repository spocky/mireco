import { test } from "node:test";
import assert from "node:assert/strict";

import { parseDeviceAddress, DEVICE_PORT } from "../js/address.js";
import {
  buildDeviceUrl, controllerUrl, customButtonParams, encodeQueryComponent, homeParams,
  keyEventParams, probeUrl, REMOTE_KEYS,
} from "../js/commands.js";
import {
  createFetchTransport, describePageContext, explainFailure, localNetworkAccessApplies, queryLocalNetworkPermission,
  TransportError,
} from "../js/transport.js";

// ---------- URL generation ----------

test("existing remote keys map to the original keyevent endpoints", () => {
  for (const key of ["power", "up", "down", "left", "right", "enter", "home", "back", "menu", "volumeup", "volumedown"]) {
    assert.ok(REMOTE_KEYS.includes(key));
    assert.equal(
      controllerUrl("192.168.1.20", keyEventParams(key)),
      `http://192.168.1.20:6095/controller?action=keyevent&keycode=${key}`,
    );
  }
});

test("custom buttons: app packages and HDMI sources", () => {
  assert.equal(
    controllerUrl("10.0.0.5", customButtonParams("com.google.android.youtube.tv")),
    "http://10.0.0.5:6095/controller?action=startapp&type=packagename&packagename=com.google.android.youtube.tv",
  );
  assert.equal(
    controllerUrl("10.0.0.5", customButtonParams("HDMI1")),
    "http://10.0.0.5:6095/controller?action=changesource&source=hdmi1",
  );
  assert.deepEqual(customButtonParams("hdmi2"), { action: "changesource", source: "hdmi2" });
  assert.equal(customButtonParams(""), null);
  assert.equal(customButtonParams("   "), null);
});

test("home button uses the custom launcher when configured", () => {
  assert.deepEqual(homeParams(""), { action: "keyevent", keycode: "home" });
  assert.deepEqual(homeParams("com.my.launcher"), { action: "startapp", type: "packagename", packagename: "com.my.launcher" });
});

test("probe uses the read-only volume endpoint", () => {
  assert.equal(probeUrl("192.168.1.2"), "http://192.168.1.2:6095/general?action=getVolum");
});

test("every parameter is percent-encoded", () => {
  const cases = {
    " ": "%20", "+": "%2B", "&": "%26", "?": "%3F", "#": "%23", "%": "%25", "=": "%3D",
    "/": "%2F", "!": "%21", "'": "%27", "(": "%28", ")": "%29", "*": "%2A", "\"": "%22", "é": "%C3%A9",
  };
  for (const [char, encoded] of Object.entries(cases)) {
    assert.equal(encodeQueryComponent(char), encoded, char);
    const url = controllerUrl("192.168.1.20", keyEventParams(char));
    assert.ok(url.endsWith(`keycode=${encoded}`), url);
    // Round trip: the device decodes exactly the original character.
    assert.equal(new URL(url).searchParams.get("keycode"), char);
  }
  // Keys are encoded too, and a package name can't inject extra parameters.
  const url = buildDeviceUrl("192.168.1.20", "controller", { "a b": "x&action=power" });
  assert.equal(url, "http://192.168.1.20:6095/controller?a%20b=x%26action%3Dpower");
  assert.equal(new URL(url).searchParams.get("action"), null);
});

// ---------- Address validation ----------

test("accepts private, link-local, loopback and .local addresses", () => {
  assert.deepEqual(parseDeviceAddress("192.168.1.20"), { ok: true, host: "192.168.1.20", addressSpace: "local" });
  assert.deepEqual(parseDeviceAddress(" 10.0.0.7 "), { ok: true, host: "10.0.0.7", addressSpace: "local" });
  assert.equal(parseDeviceAddress("172.16.0.1").addressSpace, "local");
  assert.equal(parseDeviceAddress("172.31.255.254").addressSpace, "local");
  assert.equal(parseDeviceAddress("169.254.3.4").addressSpace, "local");
  assert.deepEqual(parseDeviceAddress("127.0.0.1"), { ok: true, host: "127.0.0.1", addressSpace: "loopback" });
  assert.deepEqual(parseDeviceAddress("localhost"), { ok: true, host: "localhost", addressSpace: "loopback" });
  assert.deepEqual(parseDeviceAddress("MiTV.local"), { ok: true, host: "mitv.local", addressSpace: "local" });
});

test("normalises pasted URLs and the default port", () => {
  assert.equal(parseDeviceAddress("http://192.168.1.20:6095/controller?x=1").host, "192.168.1.20");
  assert.equal(parseDeviceAddress(`192.168.1.20:${DEVICE_PORT}`).host, "192.168.1.20");
  assert.equal(parseDeviceAddress("192.168.1.20:8080").ok, false);
});

test("rejects public, malformed and IPv6 addresses", () => {
  for (const bad of ["", "8.8.8.8", "172.32.0.1", "192.169.1.1", "100.64.0.1", "0.0.0.0", "256.1.1.1",
    "192.168.1", "192.168.01.2", "example.com", "evil.com/192.168.1.1", "[fe80::1]", "fd00::1", "192.168.1.1@evil.com"]) {
    const r = parseDeviceAddress(bad);
    assert.equal(r.ok, false, bad);
    assert.ok(r.error.length > 0);
  }
});

// ---------- fetch transport ----------

function recordingFetch(impl = async () => ({ type: "opaque", ok: false, status: 0 })) {
  const calls = [];
  const fetchImpl = (url, init) => {
    calls.push({ url, init });
    return impl(url, init);
  };
  return { calls, fetchImpl };
}

test("uses a no-cors, uncached, credential-less GET", async () => {
  const { calls, fetchImpl } = recordingFetch();
  const transport = createFetchTransport({ fetchImpl, declareAddressSpace: true });
  const result = await transport.send("http://192.168.1.20:6095/controller?action=keyevent&keycode=up", { addressSpace: "local" });
  assert.deepEqual(result, { opaque: true });
  const { init } = calls[0];
  assert.equal(init.method, "GET");
  assert.equal(init.mode, "no-cors");
  assert.equal(init.cache, "no-store");
  assert.equal(init.credentials, "omit");
  assert.equal(init.referrerPolicy, "no-referrer");
  assert.equal(init.targetAddressSpace, "local");
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.headers, undefined, "no custom headers (would force a preflight)");
});

test("targetAddressSpace is only declared for HTTPS pages", async () => {
  const { calls, fetchImpl } = recordingFetch();
  await createFetchTransport({ fetchImpl, declareAddressSpace: false }).send("http://x", { addressSpace: "local" });
  assert.equal("targetAddressSpace" in calls[0].init, false);
});

test("rejected fetch becomes a network TransportError", async () => {
  const transport = createFetchTransport({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
  await assert.rejects(transport.send("http://192.168.1.20:6095/x"), (err) => {
    assert.ok(err instanceof TransportError);
    assert.equal(err.kind, "network");
    assert.ok(err.cause instanceof TypeError);
    return true;
  });
});

test("times out a request that never answers and aborts it", async () => {
  let signal;
  const transport = createFetchTransport({
    timeoutMs: 30,
    fetchImpl: (url, init) => {
      signal = init.signal;
      return new Promise(() => {}); // ignores abort on purpose
    },
  });
  const started = Date.now();
  await assert.rejects(transport.send("http://192.168.1.20:6095/x"), { kind: "timeout" });
  assert.ok(Date.now() - started < 1000);
  assert.equal(signal.aborted, true);
});

test("a readable non-OK response is reported as an HTTP error", async () => {
  const transport = createFetchTransport({ fetchImpl: async () => ({ type: "basic", ok: false, status: 500 }) });
  await assert.rejects(transport.send("http://127.0.0.1:6095/x"), { kind: "http" });
});

test("an opaque response is not treated as proof of execution", async () => {
  const transport = createFetchTransport({ fetchImpl: async () => ({ type: "opaque", ok: false, status: 0 }) });
  const result = await transport.send("http://192.168.1.20:6095/x");
  assert.deepEqual(result, { opaque: true }); // only "a response arrived"
});

// ---------- page context, permission, explanations ----------

test("classifies page origins", () => {
  assert.equal(describePageContext({ protocol: "https:", hostname: "me.github.io" }).kind, "https-public");
  assert.equal(describePageContext({ protocol: "https:", hostname: "192.168.1.50" }).kind, "https-private");
  assert.equal(describePageContext({ protocol: "http:", hostname: "localhost" }).kind, "http-loopback");
  assert.equal(describePageContext({ protocol: "http:", hostname: "127.0.0.1" }).kind, "http-loopback");
  assert.equal(describePageContext({ protocol: "http:", hostname: "192.168.1.50" }).kind, "http-private");
  assert.equal(describePageContext({ protocol: "http:", hostname: "mireco.hopto.org" }).kind, "http-public");
  assert.equal(describePageContext({ protocol: "file:", hostname: "" }).kind, "file");
});

test("queries the local-network / loopback-network permission names", async () => {
  const names = [];
  const permissions = { query: async ({ name }) => (names.push(name), { state: "prompt" }) };
  assert.equal((await queryLocalNetworkPermission("local", permissions)).state, "prompt");
  assert.equal((await queryLocalNetworkPermission("loopback", permissions)).state, "prompt");
  assert.deepEqual(names, ["local-network", "loopback-network"]);
});

test("unsupported permission APIs are reported as unsupported", async () => {
  assert.equal((await queryLocalNetworkPermission("local", undefined)).state, "unsupported");
  const throwing = { query: async () => { throw new TypeError("bad name"); } };
  assert.equal((await queryLocalNetworkPermission("local", throwing)).state, "unsupported");
});

test("failure explanations distinguish the likely causes", () => {
  const net = { kind: "network" };
  const host = "192.168.1.20";
  assert.match(explainFailure({ error: { kind: "timeout" }, pageKind: "https-public", permissionState: "granted", host }), /may or may not/);
  assert.match(explainFailure({ error: net, pageKind: "https-public", permissionState: "denied", host }), /blocked for this site/);
  assert.match(explainFailure({ error: net, pageKind: "https-public", permissionState: "unsupported", host }), /Local Network Access support/);
  assert.match(explainFailure({ error: net, pageKind: "http-public", permissionState: "denied", host }), /insecure \(http:\/\/\) public pages/);
  assert.match(explainFailure({ error: net, pageKind: "https-public", permissionState: "prompt", host }), /choose Allow/);
  assert.match(explainFailure({ error: net, pageKind: "http-private", permissionState: "unsupported", host }), /Check the IP address/);
  assert.match(explainFailure({ error: net, pageKind: "https-private", permissionState: "granted", host }), /mixed-content/);
});

test("a permission state is ignored when Local Network Access doesn't apply", () => {
  const net = { kind: "network" };
  // localhost page → loopback mock device: LNA isn't involved, so "denied" must not be blamed.
  const msg = explainFailure({ error: net, pageKind: "http-loopback", permissionState: "denied", host: "127.0.0.1", addressSpace: "loopback" });
  assert.doesNotMatch(msg, /blocked for this site/);
  assert.match(msg, /Check the IP address/);
  // LAN page → loopback target does cross into a more private space.
  assert.match(explainFailure({ error: net, pageKind: "http-private", permissionState: "denied", host: "127.0.0.1", addressSpace: "loopback" }), /blocked for this site/);
});

test("localNetworkAccessApplies follows the address-space lattice", () => {
  assert.equal(localNetworkAccessApplies("https-public", "local"), true);
  assert.equal(localNetworkAccessApplies("https-public", "loopback"), true);
  assert.equal(localNetworkAccessApplies("http-private", "local"), false);
  assert.equal(localNetworkAccessApplies("https-private", "loopback"), true);
  assert.equal(localNetworkAccessApplies("http-loopback", "local"), false);
});
