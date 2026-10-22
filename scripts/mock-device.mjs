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
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://device");
  const action = url.searchParams.get("action");
  let note = "";
  if (url.pathname === "/controller" && action === "keyevent") {
    const keycode = url.searchParams.get("keycode") ?? "";
    if ([...keycode].length === 1) {
      typed += keycode;
      note = `char ${JSON.stringify(keycode)}  →  typed so far: ${JSON.stringify(typed)}`;
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
