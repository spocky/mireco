#!/usr/bin/env node
// Builds a deployable copy of the site (no dependencies, no transpiling):
//
//   node scripts/build.mjs [--out dist]
//
// Copies only the files the web app needs (no scripts, tests, docs or package
// files), then checks that every asset referenced by index.html, the web
// manifest, browserconfig.xml and every JS module import is present.
//
// The result is plain static files that work from any web server and any
// sub-path, over HTTP or HTTPS. Its main use is the HTTP version for browsers
// without Local Network Access (iOS, Safari, Firefox); see README.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const MARKER = ".mireco-build";

export const SITE_FILES = [
  "index.html", "site.webmanifest", "browserconfig.xml", "jscolor.js", "LICENSE",
  "favicon.ico", "favicon-16x16.png", "favicon-32x32.png", "apple-touch-icon.png",
  "android-chrome-192x192.png", "android-chrome-256x256.png", "mstile-150x150.png", "safari-pinned-tab.svg",
];
export const SITE_DIRS = ["css", "js"];

/** Local paths referenced by the site's entry files, relative to the site root. */
export function referencedAssets(dir) {
  const refs = new Set();
  const html = readFileSync(join(dir, "index.html"), "utf8");
  for (const [, ref] of html.matchAll(/\b(?:href|src)="([^"#][^"]*)"/g)) {
    if (!/^[a-z]+:/i.test(ref)) refs.add(ref.split(/[?#]/)[0]);
  }
  const manifest = JSON.parse(readFileSync(join(dir, "site.webmanifest"), "utf8"));
  for (const icon of manifest.icons ?? []) refs.add(icon.src);
  const browserconfig = readFileSync(join(dir, "browserconfig.xml"), "utf8");
  for (const [, ref] of browserconfig.matchAll(/src="([^"]+)"/g)) refs.add(ref);
  // Static module imports, followed recursively from the JS folder.
  const jsDir = join(dir, "js");
  for (const file of readdirSync(jsDir).filter((f) => f.endsWith(".js"))) {
    for (const [, spec] of readFileSync(join(jsDir, file), "utf8").matchAll(/^\s*import\s[^"']*["'](\.[^"']+)["']/gm)) {
      refs.add(relative(dir, resolve(jsDir, spec)).split(sep).join("/"));
    }
  }
  return [...refs].sort();
}

function gitDescription(root) {
  try {
    return execFileSync("git", ["-C", root, "describe", "--always", "--dirty"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * @returns {{out: string, files: number}}
 * @throws if `out` is unsafe to clear or an asset is missing
 */
export function buildSite({ root = ROOT, out = join(root, "dist") } = {}) {
  out = resolve(out);
  // Never wipe the repository, one of its parents, or a folder we didn't create.
  if (out === root || root.startsWith(out + sep) || out === resolve(sep)) {
    throw new Error(`Refusing to build into ${out}`);
  }
  if (existsSync(out) && readdirSync(out).length > 0) {
    if (!existsSync(join(out, MARKER))) {
      throw new Error(`${out} isn't empty and wasn't created by this build; choose another --out or empty it yourself.`);
    }
    rmSync(out, { recursive: true, force: true });
  }
  mkdirSync(out, { recursive: true });

  let files = 0;
  for (const file of SITE_FILES) {
    cpSync(join(root, file), join(out, file));
    files++;
  }
  for (const dir of SITE_DIRS) {
    cpSync(join(root, dir), join(out, dir), { recursive: true });
    files += readdirSync(join(out, dir), { recursive: true }).length;
  }
  writeFileSync(join(out, MARKER), `MiReCo build ${gitDescription(root)} ${new Date().toISOString()}\n`);

  const missing = referencedAssets(out).filter((ref) => !existsSync(join(out, ref)));
  if (missing.length) throw new Error(`Build is missing referenced files: ${missing.join(", ")}`);
  return { out, files };
}

function main() {
  const args = process.argv.slice(2);
  let out = join(ROOT, "dist");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--out" && args[i + 1]) out = resolve(args[++i]);
    else {
      console.error("Usage: node scripts/build.mjs [--out DIR]");
      process.exit(1);
    }
  }
  try {
    const result = buildSite({ out });
    const shown = relative(process.cwd(), result.out) || ".";
    console.log(`✔ Built ${result.files} files into ${result.out}\n`);
    console.log("Serve it over plain HTTP on your network, for example:");
    console.log("  npm run serve:http                      (this computer, port 8080)");
    console.log("  docker compose up -d --build            (Docker / NAS, port 8080)");
    console.log(`  python3 -m http.server 8080 -d ${shown}   (any machine with Python)`);
    console.log("\nSee README → \"HTTP version (iPhone, Safari, Firefox)\".");
  } catch (err) {
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
