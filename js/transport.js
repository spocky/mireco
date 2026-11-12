// Device transport: sends one GET request to the GiTV HTTP API.
//
// Requests go straight from the browser to the TV; there is no proxy.
//
// The TV doesn't send CORS headers, so requests use `mode: "no-cors"`. The
// response is opaque: a resolved fetch only means an HTTP response came back
// from DEVICE:6095. It does NOT prove the TV executed the command, and the UI
// never claims it did.
//
// HTTPS pages (GitHub Pages) reaching an http:// LAN device depend on Chrome's
// Local Network Access (LNA, Chrome/Edge 142+): after the user grants the
// "local-network" permission, Chrome exempts requests to private IP literals
// and .local names from mixed-content blocking. `targetAddressSpace` declares
// the expected address space explicitly; browsers without LNA ignore it.
// See https://developer.chrome.com/blog/local-network-access

export const DEFAULT_TIMEOUT_MS = 4000;

export class TransportError extends Error {
  /** @param {"timeout"|"network"|"http"|"cancelled"} kind */
  constructor(kind, message, options) {
    super(message, options);
    this.name = "TransportError";
    this.kind = kind;
  }
}

function rejectOnAbort(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @param {boolean} [options.declareAddressSpace] pass `targetAddressSpace`
 *   (only meaningful, and only sent, for HTTPS pages)
 */
export function createFetchTransport({
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  declareAddressSpace = globalThis.location?.protocol === "https:",
} = {}) {
  return {
    /**
     * @param {string} url
     * @param {{addressSpace?: "local"|"loopback", signal?: AbortSignal}} [options]
     * @returns {Promise<{opaque: boolean}>} resolves when an HTTP response arrived
     */
    async send(url, { addressSpace, signal } = {}) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const forwardAbort = () => controller.abort();
      signal?.addEventListener("abort", forwardAbort, { once: true });
      if (signal?.aborted) controller.abort();

      const init = {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      };
      if (declareAddressSpace && addressSpace) init.targetAddressSpace = addressSpace;

      try {
        // Race the abort as well, in case a fetch implementation ignores it.
        const response = await Promise.race([fetchImpl(url, init), rejectOnAbort(controller.signal)]);
        const opaque = !response || response.type === "opaque";
        if (!opaque && !response.ok) {
          throw new TransportError("http", `Device answered HTTP ${response.status}`);
        }
        return { opaque };
      } catch (err) {
        if (err instanceof TransportError) throw err;
        if (timedOut) throw new TransportError("timeout", `No response within ${timeoutMs / 1000}s`, { cause: err });
        if (signal?.aborted) throw new TransportError("cancelled", "Request cancelled", { cause: err });
        throw new TransportError("network", err?.message || "Network request failed", { cause: err });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", forwardAbort);
      }
    },
  };
}

const PRIVATE_HOST = /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$|^localhost$|^\[?::1\]?$/;

/**
 * Classifies how the page itself is served, which decides what the browser
 * allows when talking to an http:// device on the LAN.
 *
 * @returns {{kind: "https-public"|"https-private"|"http-loopback"|"http-private"|"http-public"|"file"|"other",
 *            summary: string}}
 */
export function describePageContext({ protocol, hostname }) {
  const host = String(hostname || "").toLowerCase();
  const isLoopback = host === "localhost" || host.startsWith("127.") || host === "[::1]" || host === "::1";
  const isPrivate = PRIVATE_HOST.test(host);
  if (protocol === "https:") {
    return isPrivate
      ? {
        kind: "https-private",
        summary: "HTTPS page on your local network (development preview). Mixed-content and Local Network Access rules apply, but Chrome may treat this origin as local rather than public, so it doesn't fully reproduce GitHub Pages.",
      }
      : {
        kind: "https-public",
        summary: "HTTPS page. Requests to the TV need a browser with Local Network Access support (Chrome or Edge 142+), which asks once for permission to reach devices on your local network.",
      };
  }
  if (protocol === "http:") {
    if (isLoopback) {
      return { kind: "http-loopback", summary: "Served from localhost over HTTP. No mixed-content blocking; Chrome doesn't apply Local Network Access checks from localhost." };
    }
    if (isPrivate) {
      return { kind: "http-private", summary: "Served over HTTP from your local network. No mixed-content blocking and no Local Network Access prompt (local → local)." };
    }
    return {
      kind: "http-public",
      summary: "Served over plain HTTP from the internet. Current Chrome blocks insecure public sites from reaching local devices. Use the HTTPS (GitHub Pages) version or a local server.",
    };
  }
  if (protocol === "file:") {
    return { kind: "file", summary: "Opened as a local file. ES modules don't load from file://; use `npm run preview`." };
  }
  return { kind: "other", summary: "Unrecognised page origin." };
}

/**
 * Reads the Local Network Access permission without triggering a prompt.
 * Only Chromium implements these permission names; elsewhere `query` throws.
 *
 * @returns {Promise<{state: "granted"|"prompt"|"denied"|"unsupported", status: PermissionStatus|null}>}
 */
export async function queryLocalNetworkPermission(addressSpace, permissions = globalThis.navigator?.permissions) {
  const name = addressSpace === "loopback" ? "loopback-network" : "local-network";
  if (!permissions?.query) return { state: "unsupported", status: null };
  try {
    const status = await permissions.query({ name });
    return { state: status.state, status };
  } catch {
    return { state: "unsupported", status: null };
  }
}

/**
 * Whether Chrome's Local Network Access checks apply to a request from this
 * page to the device: only when it goes from a less private address space to
 * a more private one (public → local/loopback, local → loopback).
 */
export function localNetworkAccessApplies(pageKind, addressSpace) {
  if (pageKind === "https-public" || pageKind === "http-public") return true;
  if (pageKind === "https-private" || pageKind === "http-private") return addressSpace === "loopback";
  return false;
}

/** A user-facing explanation for a failed request. */
export function explainFailure({ error, pageKind, permissionState, host, addressSpace = "local" }) {
  const target = `${host}:6095`;
  // A permission state is irrelevant (and misleading) when LNA doesn't apply.
  if (!localNetworkAccessApplies(pageKind, addressSpace)) permissionState = "not-applicable";
  switch (error?.kind) {
    case "timeout":
      return `No response from ${target}. The TV may be off or asleep, or the IP address may be wrong. The command may or may not have reached the TV.`;
    case "http":
      return `${target} answered with an error (${error.message}).`;
    case "cancelled":
      return "Cancelled before it was sent.";
  }
  if (pageKind === "http-public") {
    // Insecure public pages can't be granted the permission at all.
    return `Couldn't reach ${target}. Current Chrome and Edge block insecure (http://) public pages from reaching devices on your network. Open MiReCo over HTTPS (GitHub Pages) or from a local server.`;
  }
  if (permissionState === "denied") {
    return "Local network access is blocked for this site. In Chrome, tap the icon left of the address, open Permissions (or Site settings) and allow \"Local network access\", then reload.";
  }
  if (pageKind === "https-private" && permissionState === "not-applicable") {
    return `The browser blocked or couldn't complete the request to http://${target}. From an HTTPS development page this may be mixed-content blocking (a LAN HTTPS origin doesn't go through the same Local Network Access flow as GitHub Pages), or the TV may be unreachable. Check the IP address and that the TV is on.`;
  }
  if (pageKind === "https-public" && permissionState === "unsupported") {
    return `The browser blocked the request to http://${target}. HTTPS pages can only reach an http:// TV in browsers with Local Network Access support (current Chrome or Edge on Android/desktop). Use one of those, or open MiReCo's HTTP version from your own network (on iPhone, Safari and Firefox this is the only option; see README → HTTP version).`;
  }
  if (permissionState === "prompt") {
    return `Couldn't reach ${target}. If the browser asks to access devices on your local network, choose Allow. Otherwise check the IP address and that the phone and TV are on the same Wi-Fi.`;
  }
  return `Couldn't reach ${target}. Check the IP address, that the TV is on, and that this device is on the same network.`;
}
