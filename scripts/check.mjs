#!/usr/bin/env node
// Syntax-checks every JavaScript file (node --check). No dependencies.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const files = ["js", "scripts", "tests"].filter((dir) => existsSync(join(ROOT, dir))).flatMap((dir) =>
  readdirSync(join(ROOT, dir), { recursive: true })
    .filter((f) => /\.(m?js)$/.test(f))
    .map((f) => join(ROOT, dir, f)),
);

let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (r.status !== 0) {
    failed++;
    console.error(`✖ ${relative(ROOT, file)}\n${r.stderr}`);
  }
}
console.log(`${files.length - failed}/${files.length} files passed syntax check`);
process.exit(failed ? 1 : 0);
