"""Helpers for tests that need a real MCP Streamable HTTP subprocess."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterator

import httpx

from helpers import FIXTURE_PATH, REPOSITORY_ROOT

BACKEND_SRC = REPOSITORY_ROOT / "backend" / "src"
STARTUP_TIMEOUT_SECONDS = 20.0


def allocate_free_loopback_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@dataclass
class FixtureMCPServerProcess:
    host: str = "127.0.0.1"
    port: int = field(default_factory=allocate_free_loopback_port)
    process: subprocess.Popen[bytes] | None = None
    log_path: Path | None = None

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}/mcp"

    def start(self) -> None:
        log_file = tempfile.NamedTemporaryFile(
            prefix="news-trace-mcp-",
            suffix=".log",
            delete=False,
        )
        self.log_path = Path(log_file.name)
        env = _child_environment(self.port)
        command = [
            sys.executable,
            "-m",
            "news_trace.mcp_server",
            "--host",
            self.host,
            "--port",
            str(self.port),
        ]
        self.process = subprocess.Popen(
            command,
            cwd=REPOSITORY_ROOT,
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
        log_file.close()
        try:
            self._wait_until_ready()
        except Exception:
            self.stop()
            raise

    def _wait_until_ready(self) -> None:
        assert self.process is not None
        deadline = time.monotonic() + STARTUP_TIMEOUT_SECONDS
        last_error: str | None = None
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(
                    "The fixture MCP server exited during startup "
                    f"(return code {self.process.returncode}).\n{self._read_log()}"
                )
            try:
                # Any HTTP response means uvicorn has bound and reached the ASGI
                # application. The MCP handshake itself is exercised by the tests.
                httpx.get(self.url, timeout=1.0)
                return
            except httpx.HTTPError as exc:
                last_error = str(exc)
            time.sleep(0.1)

        raise RuntimeError(
            "Timed out waiting for the fixture MCP server at "
            f"{self.url} ({last_error or 'no response'}).\n{self._read_log()}"
        )

    def _read_log(self) -> str:
        if self.log_path is None or not self.log_path.exists():
            return "MCP server log unavailable."
        try:
            return self.log_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return "MCP server log could not be read."

    def stop(self) -> None:
        process = self.process
        if process is not None and process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        self.process = None
        if self.log_path is not None and self.log_path.exists():
            try:
                self.log_path.unlink()
            except OSError:
                pass
        self.log_path = None


def _child_environment(port: int) -> dict[str, str]:
    env = os.environ.copy()
    before = env.get("PYTHONPATH")
    env["PYTHONPATH"] = (
        str(BACKEND_SRC) if not before else f"{BACKEND_SRC}{os.pathsep}{before}"
    )
    env["NEWS_TRACE_MODE"] = "fixture"
    env["NEWS_TRACE_FIXTURE_PATH"] = str(FIXTURE_PATH)
    env["NEWS_TRACE_MCP_HOST"] = "127.0.0.1"
    env["NEWS_TRACE_MCP_PORT"] = str(port)
    return env


@contextmanager
def running_fixture_mcp_server() -> Iterator[FixtureMCPServerProcess]:
    server = FixtureMCPServerProcess()
    server.start()
    try:
        yield server
    finally:
        server.stop()
