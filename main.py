#!/usr/bin/env python3
"""ARC-Bench adapter entrypoint for ShallowCode.

Contract (see https://github.com/octos-org/arc-adapter):

    python main.py <requirement_path> [--output-dir DIR] [--type web] [--web-port N]

- requirement_path: argv[1] or env ARCBENCH_TASK_DIR
- output dir:       --output-dir or env ARCBENCH_TEMPLATE_DIR; when both are
                    absent the TS entry defaults to <system tmp>/shallowcode-local/main
- model channel:    OPENAI_API_KEY / OPENAI_BASE_URL / MODEL (injected by the platform,
                    optionally merged from a local .env by the TS pipeline)

The Python layer only resolves paths and drives the Node pipeline
(`npx tsx index.ts`); it never touches port 3000 during generation.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ARC_EVAL_PORT = 3000
DEFAULT_OUTPUT_SUBDIR = "shallowcode-local/main"


def npm_cmd() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def npx_cmd() -> str:
    return "npx.cmd" if os.name == "nt" else "npx"


def log(message: str) -> None:
    print(f"[shallowcode] {message}", file=sys.stderr, flush=True)


def run(command: list[str], cwd: Path) -> None:
    log(f"run: {' '.join(command)} (cwd={cwd})")
    completed = subprocess.run(command, cwd=str(cwd), check=False)
    if completed.returncode != 0:
        raise RuntimeError(
            f"command failed with exit code {completed.returncode}: {' '.join(command)}"
        )


def try_run(command: list[str], cwd: Path) -> bool:
    log(f"run (best effort): {' '.join(command)} (cwd={cwd})")
    completed = subprocess.run(command, cwd=str(cwd), check=False)
    return completed.returncode == 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ShallowCode ARC-Bench adapter")
    parser.add_argument(
        "requirement_path",
        nargs="?",
        default=(os.environ.get("ARCBENCH_TASK_DIR") or "").strip() or None,
        help="requirement tree directory (defaults to ARCBENCH_TASK_DIR)",
    )
    parser.add_argument(
        "--output-dir",
        default=(os.environ.get("ARCBENCH_TEMPLATE_DIR") or "").strip() or None,
        help="delivery directory (defaults to ARCBENCH_TEMPLATE_DIR)",
    )
    parser.add_argument("--type", default="web", help="task type (accepted, unused)")
    parser.add_argument(
        "--web-port",
        default=(os.environ.get("ARCBENCH_WEB_PORT") or str(ARC_EVAL_PORT)).strip(),
        help="port the platform uses to reach the site at evaluation time",
    )
    return parser.parse_args()


def ensure_node_runtime(root: Path) -> None:
    if not (root / "node_modules").exists():
        try:
            run([npm_cmd(), "ci"], root)
        except RuntimeError:
            log("npm ci failed, falling back to npm install")
            run([npm_cmd(), "install", "--no-audit", "--no-fund"], root)
    else:
        log("node_modules present, skipping npm ci")
    if not try_run([npx_cmd(), "playwright", "install", "chromium"], root):
        log("playwright install failed; continuing (browsers may already exist)")


def check_template(output_dir: Path) -> bool:
    frontend_ok = (output_dir / "frontend").is_dir()
    backend_ok = (output_dir / "backend").is_dir()
    if not (frontend_ok and backend_ok):
        log(
            "template is incomplete: expected <output>/frontend and <output>/backend "
            f"(frontend={frontend_ok}, backend={backend_ok})"
        )
        return False
    return True


def main() -> int:
    args = parse_args()
    if not args.requirement_path:
        log("missing requirement directory: pass argv[1] or set ARCBENCH_TASK_DIR")
        return 2

    root = Path(__file__).resolve().parent
    requirement_dir = Path(args.requirement_path).expanduser().resolve()
    output_dir = Path(args.output_dir or (Path(tempfile.gettempdir()) / DEFAULT_OUTPUT_SUBDIR))
    if not args.output_dir:
        log(f"no --output-dir given; using default {output_dir}")
    output_dir = output_dir.expanduser().resolve()

    if not (requirement_dir / "requirements.yaml").is_file():
        log(f"requirements.yaml not found under {requirement_dir}")
        return 2
    output_dir.mkdir(parents=True, exist_ok=True)

    for name in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "MODEL"):
        if not (os.environ.get(name) or "").strip():
            log(f"warning: environment variable {name} is empty")

    log(f"eval port is {args.web_port}; generation never binds it")
    ensure_node_runtime(root)

    budget = (os.environ.get("SHALLOW_BUDGET_MS") or "0").strip() or "0"
    command = [
        npx_cmd(),
        "tsx",
        "index.ts",
        "--requirements-dir",
        str(requirement_dir),
        "--output-dir",
        str(output_dir),
        "--budget-ms",
        budget,
    ]
    try:
        run(command, root)
        exit_code = 0
    except RuntimeError as error:
        log(str(error))
        exit_code = 1

    if not check_template(output_dir):
        return 1
    log(f"pipeline finished with exit code {exit_code}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
