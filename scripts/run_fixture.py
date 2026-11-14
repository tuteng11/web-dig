#!/usr/bin/env python3
"""Start the fixture MCP server and gateway together.

Usage (from the repository root):

    uv run --project backend python scripts/run_fixture.py

The script loads optional ``.env`` values from the repository root without
overriding variables that are already set, starts the official-SDK MCP server as
a child process, waits for it to accept connections, then runs the FastAPI
gateway in the foreground. Ctrl+C shuts both processes down.
"""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import time
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
BACKEND_SRC = REPOSITORY_ROOT / "backend" / "src"
ENV_FILE = REPOSITORY_ROOT / ".env"
STARTUP_TIMEOUT_SECONDS = 20.0
_ENV_KEY = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")

sys.path.insert(0, str(BACKEND_SRC))

from news_trace.config import Settings  # noqa: E402
from news_trace.transport_security import is_loopback_hostname  # noqa: E402


def load_env_file(path: Path) -> None:
    """Load simple KEY=VALUE lines, leaving already-set variables untouched."""

    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not _ENV_KEY.fullmatch(key):
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


def wait_for_port(host: str, port: int, process: subprocess.Popen[bytes]) -> bool:
    deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return False
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.1)
    return False


def stop_process(process: subprocess.Popen[bytes] | None, label: str) -> None:
    if process is None or process.poll() is not None:
        return
    print(f"Stopping {label}...", flush=True)
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            pass


def child_environment(mcp_url: str, settings: Settings) -> dict[str, str]:
    env = os.environ.copy()
    existing_path = env.get("PYTHONPATH")
    env["PYTHONPATH"] = (
        str(BACKEND_SRC)
        if not existing_path
        else f"{BACKEND_SRC}{os.pathsep}{existing_path}"
    )
    env["PYTHONUNBUFFERED"] = "1"
    env["NEWS_TRACE_MODE"] = settings.mode
    env["NEWS_TRACE_FIXTURE_PATH"] = str(settings.fixture_path)
    env["NEWS_TRACE_MCP_HOST"] = settings.mcp_host
    env["NEWS_TRACE_MCP_PORT"] = str(settings.mcp_port)
    env["NEWS_TRACE_MCP_URL"] = mcp_url
    env["NEWS_TRACE_GATEWAY_HOST"] = settings.gateway_host
    env["NEWS_TRACE_GATEWAY_PORT"] = str(settings.gateway_port)
    return env


def read_fixture_research_id(path: Path) -> str:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "(unreadable fixture)"
    research_id = document.get("research_id")
    return research_id if isinstance(research_id, str) else "(missing research_id)"


def _url_host(host: str) -> str:
    """Bracket raw IPv6 literals for use in a URL authority."""

    if ":" in host and not host.startswith("["):
        return f"[{host}]"
    return host


def main() -> int:
    load_env_file(ENV_FILE)
    settings = Settings.from_env()

    if not settings.fixture_enabled:
        print(
            "run_fixture.py only starts the deterministic fixture backend; "
            f"NEWS_TRACE_MODE={settings.mode!r} is not supported in this milestone. "
            "Set NEWS_TRACE_MODE=fixture.",
            file=sys.stderr,
        )
        return 2

    if not settings.fixture_path.is_file():
        print(
            f"Fixture file not found: {settings.fixture_path}\n"
            "Check NEWS_TRACE_FIXTURE_PATH or restore fixtures/riverbend_fixture.json.",
            file=sys.stderr,
        )
        return 2

    if not is_loopback_hostname(settings.mcp_host):
        print(
            "Refusing to start the fixture MCP server on a non-loopback host "
            f"({settings.mcp_host!r}).",
            file=sys.stderr,
        )
        return 2
    if not is_loopback_hostname(settings.gateway_host):
        print(
            "Refusing to bind the gateway to a non-loopback host "
            f"({settings.gateway_host!r}) in fixture mode.",
            file=sys.stderr,
        )
        return 2

    mcp_url = f"http://{_url_host(settings.mcp_host)}:{settings.mcp_port}/mcp"
    env = child_environment(mcp_url, settings)

    print("Starting News Trace fixture backend...", flush=True)
    mcp_process = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "news_trace.mcp_server",
            "--host",
            settings.mcp_host,
            "--port",
            str(settings.mcp_port),
        ],
        cwd=REPOSITORY_ROOT,
        env=env,
    )

    try:
        if not wait_for_port(settings.mcp_host, settings.mcp_port, mcp_process):
            print(
                "The MCP server did not become ready on "
                f"{settings.mcp_host}:{settings.mcp_port} within "
                f"{STARTUP_TIMEOUT_SECONDS:.0f} seconds.",
                file=sys.stderr,
            )
            if mcp_process.poll() is not None:
                print(
                    f"MCP server exit code: {mcp_process.returncode}",
                    file=sys.stderr,
                )
            return 1

        research_id = read_fixture_research_id(settings.fixture_path)
        print("", flush=True)
        print("  News Trace fixture backend is ready", flush=True)
        print(f"  MCP Streamable HTTP: {mcp_url}", flush=True)
        print(
            f"  Gateway health:      http://{settings.gateway_host}:{settings.gateway_port}/health",
            flush=True,
        )
        print(
            f"  Gateway API:         http://{settings.gateway_host}:{settings.gateway_port}/api/v1",
            flush=True,
        )
        print(f"  Fixture research id: {research_id}", flush=True)
        print("  Synthetic demo data only; live discovery is not implemented.", flush=True)
        print("", flush=True)

        gateway_process: subprocess.Popen[bytes] | None = None
        try:
            gateway_process = subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "news_trace.gateway",
                    "--host",
                    settings.gateway_host,
                    "--port",
                    str(settings.gateway_port),
                ],
                cwd=REPOSITORY_ROOT,
                env=env,
            )
            try:
                return gateway_process.wait()
            except KeyboardInterrupt:
                print("\nShutting down News Trace fixture backend...", flush=True)
                return 0
        finally:
            stop_process(gateway_process, "gateway")
    finally:
        stop_process(mcp_process, "MCP server")


if __name__ == "__main__":
    raise SystemExit(main())
