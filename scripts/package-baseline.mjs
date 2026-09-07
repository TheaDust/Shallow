#!/usr/bin/env node
// Export a standalone ARC-Bench baseline submission package.
//
// The evaluator only recognizes the root `python main.py ...` entrypoint, so the
// exported package's root main.py is replaced with a shim that delegates to
// baseline/main.py. Everything the baseline import chain needs at load time is
// included (src/, prompts/ — prompt.ts reads prompt assets at module load);
// dev-only trees (test/, docs/, data/) and machine-local state (node_modules,
// .git, .env, __pycache__, runs/, tmp/) are excluded.
//
// Usage: node scripts/package-baseline.mjs [output-dir]
// Default output: dist/shallowcode-baseline

import { cp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const outputDir = resolve(process.argv[2] ?? join(repoRoot, "dist", "shallowcode-baseline"));

const INCLUDED_DIRS = ["baseline", "src", "prompts"];
const INCLUDED_FILES = ["package.json", "package-lock.json", "tsconfig.json", "requirements.txt"];
const SKIP_DIR_NAMES = new Set(["node_modules", "__pycache__", ".git"]);

const ROOT_MAIN_PY = `#!/usr/bin/env python3
"""ARC-Bench baseline adapter entrypoint.

Evaluator-facing contract (https://github.com/octos-org/arc-adapter):

    python main.py <requirement_path> [--output-dir DIR] [--type web] [--web-port N]

Delegates to the baseline adapter implementation under baseline/; this package
drives raw OpenCode per ROOT subtree without the ShallowCode orchestration.
"""

import sys

from baseline.main import main

if __name__ == "__main__":
    sys.exit(main())
`;

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
  await writeFile(join(outputDir, "main.py"), ROOT_MAIN_PY, "utf8");
  console.log(`baseline package exported to ${outputDir}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
