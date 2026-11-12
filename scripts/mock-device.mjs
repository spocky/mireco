#!/usr/bin/env node
// Fake GiTV device for testing without a TV (development only).
//
//   npm run mock-device                 # listens on 0.0.0.0:6095
//   npm run mock-device -- --host 127.0.0.1
//
// Set MiReCo's device IP to this computer's LAN IP (or 127.0.0.1 when the
// page runs on the same computer). Every request is logged, and typed
// characters are shown as the text the TV would have received.
//
// Like the real device it sends no CORS headers, so the page only sees opaque
// responses, exactly as with the TV.

import { createServer } from "node:http";

let host = "0.0.0.0";
let delayMs = 0;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--host") host = args[++i];
  else if (args[i] === "--delay") delayMs = Number(args[++i]) || 0; // simulate a slow TV
}

let typed = "";
let shift = false;

// Android key codes the "name"/"number" text formats use (US layout).
const ANDROID_CHARS = { SPACE: [" ", " "], PERIOD: [".", ">"], COMMA: [",", "<"], MINUS: ["-", "_"], EQUALS: ["=", "+"],
  SLASH: ["/", "?"], AT: ["@", "@"], SEMICOLON: [";", ":"], APOSTROPHE: ["'", "\""], LEFT_BRACKET: ["[", "{"],
  RIGHT_BRACKET: ["]", "}"], BACKSLASH: ["\\", "|"], GRAVE: ["`", "~"], PLUS: ["+", "+"], POUND: ["#", "#"], STAR: ["*", "*"],
  NUMPAD_LEFT_PAREN: ["(", "("], NUMPAD_RIGHT_PAREN: [")", ")"] };
const SHIFTED_DIGITS = ")!@#$%^&*(";
const NUMBER_NAMES = { 59: "SHIFT_LEFT", 62: "SPACE", 67: "DEL", 17: "STAR", 18: "POUND", 55: "COMMA", 56: "PERIOD", 68: "GRAVE",
  69: "MINUS", 70: "EQUALS", 71: "LEFT_BRACKET", 72: "RIGHT_BRACKET", 73: "BACKSLASH", 74: "SEMICOLON", 75: "APOSTROPHE",
  76: "SLASH", 77: "AT", 81: "PLUS", 162: "NUMPAD_LEFT_PAREN", 163: "NUMPAD_RIGHT_PAREN" };

/** Applies an Android key (KEYCODE_X or its number) to the typed text; false if it isn't one. */
function applyAndroidKey(keycode) {
  let name = keycode.startsWith("KEYCODE_") ? keycode.slice(8) : null;
  if (/^\d+$/.test(keycode)) {
    const n = Number(keycode);
    if (n >= 7 && n <= 16) name = String(n - 7);
    else if (n >= 29 && n <= 54) name = String.fromCharCode(65 + n - 29);
    else name = NUMBER_NAMES[n] ?? null;
  }
  if (!name) return false;
  const shifted = shift;
  shift = name === "SHIFT_LEFT";
  if (name === "SHIFT_LEFT") return true;
  if (name === "DEL") typed = [...typed].slice(0, -1).join("");
  else if (/^[A-Z]$/.test(name)) typed += shifted ? name : name.toLowerCase();
  else if (/^\d$/.test(name)) typed += shifted ? SHIFTED_DIGITS[Number(name)] : name;
  else if (ANDROID_CHARS[name]) typed += ANDROID_CHARS[name][shifted ? 1 : 0];
  else return false;
  return true;
}
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://device");
  const action = url.searchParams.get("action");
  let note = "";
  if (url.pathname === "/controller" && action === "keyevent") {
    const keycode = url.searchParams.get("keycode") ?? "";
    if ([...keycode].length === 1) {
      typed += keycode;
      note = `char ${JSON.stringify(keycode)}  →  typed so far: ${JSON.stringify(typed)}`;
    } else if (applyAndroidKey(keycode)) {
      note = `android ${keycode}  →  typed so far: ${JSON.stringify(typed)}`;
    } else {
      if (keycode === "enter") typed += "⏎";
      note = `key ${keycode}`;
    }
  } else if (action === "startapp") {
    note = `start app ${url.searchParams.get("packagename")}`;
  } else if (action === "changesource") {
    note = `source ${url.searchParams.get("source")}`;
  } else {
    note = `${url.pathname} ${action ?? ""}`;
  }
  console.log(`${new Date().toLocaleTimeString()}  ${req.socket.remoteAddress}  ${note}`);
  setTimeout(() => {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end('{"status":0,"msg":"success"}');
  }, delayMs);
});

server.on("error", (err) => {
  console.error(`✖ ${err.code === "EADDRINUSE" ? "Port 6095 is already in use." : err.message}`);
  process.exit(1);
});
server.listen(6095, host, () => {
  console.log(`Mock GiTV device listening on http://${host}:6095  (Ctrl+C to stop, "r" + Enter resets text)`);
});
process.stdin.on("data", (d) => {
  if (String(d).trim() === "r") {
    typed = "";
    console.log("— typed text reset —");
  }
});
