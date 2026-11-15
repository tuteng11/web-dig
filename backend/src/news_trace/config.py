"""Environment configuration for the fixture milestone.

Live provider configuration is intentionally absent in this milestone. The
fixture mode must be selected explicitly and is reported by the gateway health
endpoint and the web UI.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc


def _env_list(name: str, default: str) -> tuple[str, ...]:
    raw = os.environ.get(name, default)
    return tuple(item.strip() for item in raw.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    mode: str
    fixture_path: Path
    mcp_host: str
    mcp_port: int
    mcp_url: str
    gateway_host: str
    gateway_port: int
    allowed_hosts: tuple[str, ...]
    allowed_origins: tuple[str, ...]

    @property
    def fixture_enabled(self) -> bool:
        return self.mode == "fixture"

    @classmethod
    def from_env(cls) -> Settings:
        mcp_host = os.environ.get("NEWS_TRACE_MCP_HOST", "127.0.0.1")
        mcp_port = _env_int("NEWS_TRACE_MCP_PORT", 8765)
        gateway_host = os.environ.get("NEWS_TRACE_GATEWAY_HOST", "127.0.0.1")
        gateway_port = _env_int("NEWS_TRACE_GATEWAY_PORT", 8000)
        default_mcp_url = f"http://{mcp_host}:{mcp_port}/mcp"
        default_hosts = (
            f"127.0.0.1:{gateway_port},localhost:{gateway_port},"
            f"127.0.0.1:{mcp_port},localhost:{mcp_port}"
        )
        default_origins = (
            "http://127.0.0.1:5173,http://localhost:5173,"
            "http://127.0.0.1:4173,http://localhost:4173"
        )
        fixture_path = Path(
            os.environ.get(
                "NEWS_TRACE_FIXTURE_PATH",
                str(REPOSITORY_ROOT / "fixtures" / "riverbend_fixture.json"),
            )
        )
        if not fixture_path.is_absolute():
            fixture_path = REPOSITORY_ROOT / fixture_path
        return cls(
            mode=os.environ.get("NEWS_TRACE_MODE", "unconfigured").strip().lower(),
            fixture_path=fixture_path,
            mcp_host=mcp_host,
            mcp_port=mcp_port,
            mcp_url=os.environ.get("NEWS_TRACE_MCP_URL", default_mcp_url),
            gateway_host=gateway_host,
            gateway_port=gateway_port,
            allowed_hosts=_env_list("NEWS_TRACE_ALLOWED_HOSTS", default_hosts),
            allowed_origins=_env_list("NEWS_TRACE_ALLOWED_ORIGINS", default_origins),
        )
