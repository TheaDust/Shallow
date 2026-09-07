#!/usr/bin/env python3
"""ARC-Bench baseline adapter: raw OpenCode without ShallowCode orchestration.

Same entrypoint contract as the ShallowCode adapter (see
https://github.com/octos-org/arc-adapter):

    python main.py <requirement_path> [--output-dir DIR] [--type web] [--web-port N]

The Python layer resolves paths, prepares the Node runtime, and drives
`baseline/index.ts`, which feeds one ROOT-child subtree at a time to OpenCode in
a single session (mirroring the official codex reference implementation). No
probes, no judge, no repair loop, no git checkpoints.

When neither --output-dir nor ARCBENCH_TEMPLATE_DIR is given, the TS entry
defaults the delivery directory to <system tmp>/shallowcode-local/baseline.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

DEFAULT_OUTPUT_SUBDIR = "shallowcode-local/baseline"
MIN_NODE_VERSION = (20, 18, 1)


def npm_cmd() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def npx_cmd() -> str:
    return "npx.cmd" if os.name == "nt" else "npx"


def check_node_version() -> None:
    try:
        completed = subprocess.run(
            ["node", "--version"], capture_output=True, text=True, check=True
        )
    except (OSError, subprocess.CalledProcessError) as error:
        raise RuntimeError(f"node is not available: {error}")
    parts = completed.stdout.strip().lstrip("v").split(".")
    version = tuple(int(p) for p in parts[:3]) + (0,) * (3 - len(parts[:3]))
    if version < MIN_NODE_VERSION:
        raise RuntimeError(
            f"node {'.'.join(map(str, version))} is too old; "
            f"minimum is {'.'.join(map(str, MIN_NODE_VERSION))}"
        )
    log(f"node version {completed.stdout.strip()}")


def log(message: str) -> None:
    print(f"[baseline] {message}", file=sys.stderr, flush=True)


def load_env_file(root: Path) -> dict[str, str]:
    env_path = root / ".env"
    if not env_path.is_file():
        return {}
    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#"):
            continue
        separator = trimmed.find("=")
        if separator <= 0:
            continue
        key = trimmed[:separator].strip()
        value = trimmed[separator + 1 :].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


GATEWAY_VARS = ("OPENAI_API_KEY", "OPENAI_BASE_URL", "MODEL")


def resolve_gateway_env(root: Path) -> dict[str, str]:
    values = {name: (os.environ.get(name) or "").strip() for name in GATEWAY_VARS}
    if not all(values.values()):
        for key, value in load_env_file(root).items():
            if key in values and not values[key]:
                values[key] = value
    return values


def probe_model_endpoint(env: dict[str, str]) -> None:
    # Diagnostics (no secrets): which endpoint did the runner inject?
    base_url = env["OPENAI_BASE_URL"].rstrip("/")
    log(f"[env] OPENAI_BASE_URL={base_url}")
    log(f"[env] MODEL={env['MODEL']}")
    if not env["OPENAI_API_KEY"]:
        raise RuntimeError("OPENAI_API_KEY is empty; the runner did not inject model credentials")
    if not env["OPENAI_BASE_URL"]:
        raise RuntimeError("OPENAI_BASE_URL is empty; the runner did not inject a model endpoint")
    if not env["MODEL"]:
        raise RuntimeError("MODEL is empty; the runner did not inject a model name")
    url = base_url + "/chat/completions"
    payload = json.dumps({
        "model": env["MODEL"],
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 5,
        "stream": False,
    }).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {env['OPENAI_API_KEY']}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            log(f"model endpoint reachable: {url} -> HTTP {response.status}")
    except urllib.error.HTTPError as error:
        # Any HTTP response proves the endpoint is reachable; auth or model
        # errors surface later with full detail from the real calls.
        log(f"model endpoint reachable: {url} -> HTTP {error.code}")
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise RuntimeError(f"model endpoint unreachable: {url} ({error})")


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
    ensure_opencode_cli(root)


def ensure_opencode_cli(root: Path) -> None:
    bin_dir = root / "node_modules" / ".bin"
    if bin_dir.is_dir():
        os.environ["PATH"] = str(bin_dir) + os.pathsep + os.environ.get("PATH", "")
    for platform_bin in sorted((root / "node_modules").glob("opencode-*/bin")):
        os.environ["PATH"] = str(platform_bin) + os.pathsep + os.environ.get("PATH", "")
    if shutil.which("opencode") is None:
        raise RuntimeError(
            "opencode CLI not found; expected node_modules/.bin/opencode "
            "from the opencode-ai package after npm ci"
        )
    log("opencode CLI found")


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
    repo_root = root.parent
    requirement_dir = Path(args.requirement_path).expanduser().resolve()
    output_dir = Path(args.output_dir or (Path(tempfile.gettempdir()) / DEFAULT_OUTPUT_SUBDIR))
    if not args.output_dir:
        log(f"no --output-dir given; using default {output_dir}")
    output_dir = output_dir.expanduser().resolve()

    if not (requirement_dir / "requirements.yaml").is_file():
        log(f"requirements.yaml not found under {requirement_dir}")
        return 2
    output_dir.mkdir(parents=True, exist_ok=True)

    log(f"eval port is {args.web_port}; generation never binds it")
    try:
        probe_model_endpoint(resolve_gateway_env(repo_root))
        check_node_version()
        ensure_node_runtime(repo_root)
    except RuntimeError as error:
        log(str(error))
        return 1

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
