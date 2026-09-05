#!/usr/bin/env python3
"""ARC-Bench baseline adapter: raw OpenCode without ShallowCode orchestration.

Same entrypoint contract as the ShallowCode adapter (see
https://github.com/octos-org/arc-adapter):

    python main.py <requirement_path> [--output-dir DIR] [--type web] [--web-port N]

The Python layer resolves paths, prepares the Node runtime, and drives
`baseline/index.ts`, which feeds one ROOT-child subtree at a time to OpenCode in
a single session (mirroring the official codex reference implementation). No
probes, no judge, no repair loop, no git checkpoints.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


def npm_cmd() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def npx_cmd() -> str:
    return "npx.cmd" if os.name == "nt" else "npx"


def log(message: str) -> None:
    print(f"[baseline] {message}", file=sys.stderr, flush=True)


def run(command: list[str], cwd: Path) -> None:
    log(f"run: {' '.join(command)} (cwd={cwd})")
    completed = subprocess.run(command, cwd=str(cwd), check=False)
    if completed.returncode != 0:
        raise RuntimeError(
            f"command failed with exit code {completed.returncode}: {' '.join(command)}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="ShallowCode ARC-Bench baseline adapter")
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
        default=(os.environ.get("ARCBENCH_WEB_PORT") or "3000").strip(),
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
    if not args.output_dir:
        log("missing output directory: pass --output-dir or set ARCBENCH_TEMPLATE_DIR")
        return 2

    root = Path(__file__).resolve().parent
    repo_root = root.parent
    requirement_dir = Path(args.requirement_path).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()

    if not (requirement_dir / "requirements.yaml").is_file():
        log(f"requirements.yaml not found under {requirement_dir}")
        return 2
    output_dir.mkdir(parents=True, exist_ok=True)

    for name in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "MODEL"):
        if not (os.environ.get(name) or "").strip():
            log(f"warning: environment variable {name} is empty")

    log(f"eval port is {args.web_port}; generation never binds it")
    ensure_node_runtime(repo_root)

    budget = (os.environ.get("SHALLOW_BUDGET_MS") or "0").strip() or "0"
    command = [
        npx_cmd(),
        "tsx",
        "baseline/index.ts",
        "--requirements-dir",
        str(requirement_dir),
        "--output-dir",
        str(output_dir),
        "--budget-ms",
        budget,
    ]
    try:
        run(command, repo_root)
        exit_code = 0
    except RuntimeError as error:
        log(str(error))
        exit_code = 1

    if not check_template(output_dir):
        return 1
    log(f"baseline finished with exit code {exit_code}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
