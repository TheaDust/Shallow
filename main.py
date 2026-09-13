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
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

ARC_EVAL_PORT = 3000
DEFAULT_OUTPUT_SUBDIR = "shallowcode-local/main"
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
    print(f"[shallowcode] {message}", file=sys.stderr, flush=True)


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

CGROUP_MEMORY_FILES = (
    "/sys/fs/cgroup/memory.max",
    "/sys/fs/cgroup/memory.current",
    "/sys/fs/cgroup/memory.events",
    "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    "/sys/fs/cgroup/memory/memory.usage_in_bytes",
)


def cgroup_memory_summary() -> str:
    """Best-effort container memory state; a nonzero oom_kill in memory.events proves the platform killed us."""
    parts: list[str] = []
    for entry in CGROUP_MEMORY_FILES:
        path = Path(entry)
        try:
            if not path.is_file():
                continue
            value = " ".join(path.read_text(encoding="utf-8", errors="replace").split())
        except OSError:
            continue
        parts.append(f"{path.name}={value}")
    return "; ".join(parts)


def cgroup_memory_limit_bytes() -> int | None:
    for entry in ("/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"):
        try:
            text = Path(entry).read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if not text or text == "max":
            continue
        try:
            value = int(text)
        except ValueError:
            continue
        if value > 0:
            return value
    return None


LOW_MEMORY_LIMIT_BYTES = 1024 * 1024 * 1024
LOW_MEMORY_NODE_OPTIONS = "--max-old-space-size=384"
# Bun runtime heap cap for the OpenCode server binary; measured ~70 MiB lower RSS.
LOW_MEMORY_BUN_JSC_FORCE_RAM_SIZE = "201326592"

BUILD_STALENESS_TOLERANCE_SECONDS = 2.0


def compiled_entry_is_fresh(root: Path, compiled: Path) -> bool:
    """A stale build/ silently runs old code; trust it only when no source file is newer."""
    try:
        built = compiled.stat().st_mtime
    except OSError:
        return False
    sources = (root / "index.ts", *(root / "src").rglob("*.ts"))
    for source in sources:
        try:
            if source.is_file() and source.stat().st_mtime > built + BUILD_STALENESS_TOLERANCE_SECONDS:
                return False
        except OSError:
            continue
    return True


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
    memory_limit = cgroup_memory_limit_bytes()
    if memory_limit is not None:
        log(f"container memory limit: {memory_limit // (1024 * 1024)} MiB")
        if memory_limit <= LOW_MEMORY_LIMIT_BYTES:
            # Applies to every Node child (npm install, playwright install, the
            # pipeline, MCP children); Python and native binaries are unaffected.
            os.environ.setdefault("NODE_OPTIONS", LOW_MEMORY_NODE_OPTIONS)
            # The OpenCode server is a Bun executable; tighten its JSC heap too.
            os.environ.setdefault("BUN_JSC_forceRAMSize", LOW_MEMORY_BUN_JSC_FORCE_RAM_SIZE)
            log(f"low-memory mode: NODE_OPTIONS={os.environ['NODE_OPTIONS']} BUN_JSC_forceRAMSize={os.environ['BUN_JSC_forceRAMSize']}")
    memory = cgroup_memory_summary()
    if memory:
        log(f"cgroup memory at start: {memory}")

    try:
        probe_model_endpoint(resolve_gateway_env(root))
        check_node_version()
        ensure_node_runtime(root)
    except RuntimeError as error:
        log(str(error))
        return 1

    budget = (os.environ.get("SHALLOW_BUDGET_MS") or "0").strip() or "0"
    compiled_entry = root / "build" / "index.js"
    if compiled_entry.is_file() and compiled_entry_is_fresh(root, compiled_entry):
        entry = ["node", str(compiled_entry)]
    else:
        if compiled_entry.is_file():
            log("compiled entry is older than src/; falling back to tsx")
        entry = [npx_cmd(), "tsx", "index.ts"]
    command = [
        *entry,
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
    memory = cgroup_memory_summary()
    if memory:
        log(f"cgroup memory after pipeline: {memory}")

    if not check_template(output_dir):
        return 1
    log(f"pipeline finished with exit code {exit_code}")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
