#!/usr/bin/env node
// Export a standalone ARC-Bench ShallowCode submission package.
//
// The evaluator only recognizes the root `python main.py ...` entrypoint. The
// repo-root main.py already is that entrypoint, so it is copied verbatim; it
// drives `npx tsx index.ts` inside the package root. Everything the load-time
// import chain needs is included (index.ts, src/, prompts/ — prompt assets are
// resolved relative to src/ at runtime); dev-only trees (test/, docs/, data/,
// scripts/, baseline/) and machine-local state (node_modules, .git, .env,
// __pycache__, runs/, tmp/) are excluded.
//
// Usage: node scripts/package-main.mjs [output-dir]
// Default output: dist/shallowcode-main

import { cp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDir = resolve(process.argv[2] ?? join(repoRoot, "dist", "shallowcode-main"));

const INCLUDED_DIRS = ["src", "prompts"];
const INCLUDED_FILES = [
  "main.py",
  "index.ts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "requirements.txt",
];
const SKIP_DIR_NAMES = new Set(["node_modules", "__pycache__", ".git"]);

async function main() {
  await rm(outputDir, { recursive: true, force: true });
  for (const dir of INCLUDED_DIRS) {
    await cp(join(repoRoot, dir), join(outputDir, dir), {
      recursive: true,
      filter: (source) => !SKIP_DIR_NAMES.has(source.split(/[\\/]/).pop()),
    });
  }
  for (const file of INCLUDED_FILES) {
    await cp(join(repoRoot, file), join(outputDir, file));
  }
  console.log(`main package exported to ${outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
