// Turns committed text into queued key-event commands.

import { controllerUrl, keyEventParams } from "./commands.js";
import { encodeText } from "./text-encoding.js";

// Upper bound per Send / per committed segment, so an accidental huge paste
// doesn't turn into thousands of requests.
export const MAX_TEXT_LENGTH = 300;

function listUnsupported(unsupported) {
  const unique = [...new Map(unsupported.map((u) => [u.char, u.description])).values()];
  const shown = unique.slice(0, 3).join(", ");
  return unique.length > 3 ? `${shown} and ${unique.length - 3} more` : shown;
}

/**
 * @param {object} deps
 * @param {import("./command-queue.js").CommandQueue} deps.queue
 * @param {() => ({ok: true, host: string, addressSpace: string} | {ok: false, error: string})} deps.getDevice
 * @param {() => boolean} [deps.getAllowNonAscii]
 * @returns {(text: string) => {accepted: boolean, code?: string, reason?: string, count?: number}}
 */
export function createTextSender({ queue, getDevice, getAllowNonAscii = () => false }) {
  return function commit(text) {
    const device = getDevice();
    if (!device.ok) return { accepted: false, code: "no-device", reason: device.error };

    const { tokens, unsupported } = encodeText(text, { allowNonAscii: getAllowNonAscii() });
    if (unsupported.length) {
      return {
        accepted: false,
        code: "unsupported",
        reason: `Can't type ${listUnsupported(unsupported)} on the TV. Remove ${unsupported.length === 1 ? "it" : "them"} to continue; this text hasn't been sent.`,
      };
    }
    if (tokens.length > MAX_TEXT_LENGTH) {
      return {
        accepted: false,
        code: "too-long",
        reason: `That's ${tokens.length} characters; send at most ${MAX_TEXT_LENGTH} at a time.`,
      };
    }
    const commands = tokens.map((token) => ({
      kind: "text",
      url: controllerUrl(device.host, keyEventParams(token.keycode)),
      addressSpace: device.addressSpace,
      token,
    }));
    if (!queue.enqueueAll(commands)) {
      return { accepted: false, code: "full", reason: "Still sending earlier text. Wait a moment, then press Send." };
    }
    return { accepted: true, count: commands.length };
  };
}
