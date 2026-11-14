"""Loopback Host/Origin checks for the fixture gateway.

The MCP server uses the official SDK's ``TransportSecuritySettings`` directly.
The gateway needs the same DNS-rebinding protections on its own public routes,
so this module keeps the small amount of header-validation logic separate from
the HTTP error mapping in ``gateway.py``.
"""

from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

from news_trace.config import Settings

# Fixture requests may arrive through the Vite dev proxy. Loopback Hosts are
# accepted even when their port is not explicitly listed; Origin is still
# allow-listed or must match the request Host.
LOOPBACK_HOSTNAMES = frozenset({"localhost"})


def is_loopback_hostname(hostname: str | None) -> bool:
    """Return whether a header hostname denotes a loopback interface."""

    if not hostname:
        return False
    normalized = hostname.strip().strip("[]").lower()
    if normalized in LOOPBACK_HOSTNAMES:
        return True
    try:
        return ipaddress.ip_address(normalized).is_loopback
    except ValueError:
        return False


def parse_host_header(value: str | None) -> tuple[str | None, int | None]:
    """Split a Host header into hostname and port without accepting userinfo."""

    if not value:
        return None, None
    try:
        parsed = urlsplit(f"//{value}")
        # Accessing .port raises ValueError for an out-of-range or malformed port.
        return parsed.hostname, parsed.port
    except ValueError:
        return None, None


def _matches_pattern(value: str, patterns: tuple[str, ...]) -> bool:
    for pattern in patterns:
        if value == pattern:
            return True
        if pattern.endswith(":*") and value.startswith(pattern[:-1]):
            return True
    return False


def validate_transport_access(
    host: str | None,
    origin: str | None,
    settings: Settings,
) -> str | None:
    """Return a safe rejection message, or ``None`` when the request may proceed.

    Missing ``Origin`` is allowed for server-to-server requests and same-origin
    browser GETs. In fixture mode, a loopback ``Host`` is accepted even when the
    port is not explicitly listed so the Vite proxy keeps working; ``Origin``
    still has to be allow-listed or match the request origin.
    """

    if not host:
        return "The request Host header is required."
    if "@" in host:
        return "The request Host is not allowed."

    hostname, _ = parse_host_header(host)
    host_allowed = _matches_pattern(host, settings.allowed_hosts)
    if not host_allowed and not (
        settings.fixture_enabled and is_loopback_hostname(hostname)
    ):
        return "The request Host is not allowed."

    if origin is None or origin == "":
        return None

    if _matches_pattern(origin, settings.allowed_origins):
        return None

    try:
        parsed_origin = urlsplit(origin)
        origin_hostname = parsed_origin.hostname
        origin_port = parsed_origin.port
    except ValueError:
        return "The request Origin is not allowed."

    if (
        parsed_origin.scheme not in {"http", "https"}
        or not origin_hostname
        or parsed_origin.username is not None
        or parsed_origin.password is not None
    ):
        return "The request Origin is not allowed."

    # Same-origin requests are safe even when the deployment forgot to list the
    # exact origin in NEWS_TRACE_ALLOWED_ORIGINS.
    if origin_hostname == hostname and origin_port == _origin_port(host):
        return None
    if parsed_origin.netloc.lower() == host.lower():
        return None

    return "The request Origin is not allowed."


def _origin_port(host: str) -> int | None:
    _, port = parse_host_header(host)
    return port
