"""Official-SDK MCP server exposing the deterministic fixture research.

Run directly with ``python -m news_trace.mcp_server``. The server refuses to
start outside explicit fixture mode; live discovery is intentionally absent from
this milestone and must not be silently replaced by fixture data.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Sequence
from typing import Annotated, cast

from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import CallToolResult, TextContent
from pydantic import Field

from news_trace.config import Settings
from news_trace.fixture_service import FixtureNotFoundError, FixtureRepository
from news_trace.models import (
    ErrorCode,
    ErrorDetail,
    ErrorEnvelope,
    GraphResult,
    NodeDetails,
)
from news_trace.transport_security import is_loopback_hostname

logger = logging.getLogger(__name__)

SERVER_NAME = "news-trace-fixture-mcp"
SERVER_VERSION = "0.1.0"
STREAMABLE_HTTP_PATH = "/mcp"

UNKNOWN_RESEARCH_MESSAGE = "No research with that id exists in this fixture."
UNKNOWN_NODE_MESSAGE = "No node with that id exists in this fixture research."
INTERNAL_ERROR_MESSAGE = "The fixture research service could not complete this request."


def _error_result(
    code: ErrorCode,
    message: str,
    *,
    retryable: bool = False,
) -> CallToolResult:
    """Build a typed, safe MCP error result.

    The official SDK treats a returned ``CallToolResult`` as authoritative, so
    ``isError`` is true and the structured payload remains machine-readable
    without ever exposing a traceback or filesystem path.
    """

    envelope = ErrorEnvelope(
        error=ErrorDetail(code=code, message=message, retryable=retryable),
    )
    payload = envelope.model_dump(mode="json")
    return CallToolResult(
        content=[TextContent(type="text", text=envelope.model_dump_json())],
        structured_content=payload,
        is_error=True,
    )


def create_server(
    repository: FixtureRepository,
    *,
    name: str = SERVER_NAME,
    version: str = SERVER_VERSION,
) -> MCPServer:
    """Create the fixture MCP server for tests or an embedding caller."""

    server = MCPServer(
        name=name,
        version=version,
        instructions=(
            "Read-only synthetic research fixture for News Trace. "
            "This server does not perform live discovery."
        ),
    )

    @server.tool(
        name="get_research_graph",
        description=(
            "Return the deterministic chronological research graph for a fixture "
            "research id, including nodes, relationships, and tree projection."
        ),
    )
    async def get_research_graph(
        research_id: Annotated[str, Field(min_length=1, max_length=200)],
    ) -> GraphResult:
        try:
            graph = repository.get_graph(research_id)
        except FixtureNotFoundError:
            return cast(
                GraphResult,
                _error_result(ErrorCode.NOT_FOUND, UNKNOWN_RESEARCH_MESSAGE),
            )
        except Exception:
            logger.exception("Unexpected failure while reading a fixture graph")
            return cast(
                GraphResult,
                _error_result(ErrorCode.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE),
            )
        return graph

    @server.tool(
        name="get_node_details",
        description=(
            "Return metadata, evidence, relationships, and snapshot identity for "
            "one fixture research node. detail_query is reserved for a later "
            "evidence-selection milestone and does not change the fixture result."
        ),
    )
    async def get_node_details(
        research_id: Annotated[str, Field(min_length=1, max_length=200)],
        node_id: Annotated[str, Field(min_length=1, max_length=200)],
        detail_query: Annotated[str | None, Field(max_length=1000)] = None,
    ) -> NodeDetails:
        # The fixture repository is the only data source; detail_query is
        # accepted and capped so the production signature is stable.
        _ = detail_query
        try:
            details = repository.get_node_details(research_id, node_id)
        except FixtureNotFoundError:
            return cast(
                NodeDetails,
                _error_result(ErrorCode.NOT_FOUND, UNKNOWN_NODE_MESSAGE),
            )
        except Exception:
            logger.exception("Unexpected failure while reading fixture node details")
            return cast(
                NodeDetails,
                _error_result(ErrorCode.INTERNAL_ERROR, INTERNAL_ERROR_MESSAGE),
            )
        return details

    return server


def build_transport_security(
    settings: Settings,
    *,
    host: str,
    port: int,
) -> TransportSecuritySettings:
    """Enable DNS-rebinding protection with explicit loopback allow-lists."""

    allowed_hosts = list(dict.fromkeys(settings.allowed_hosts))
    allowed_origins = list(dict.fromkeys(settings.allowed_origins))

    for candidate_host in _loopback_aliases(host):
        allowed_hosts.extend(
            [
                f"{candidate_host}:{port}",
                f"{candidate_host}:*",
            ]
        )
        allowed_origins.extend(
            [
                f"http://{candidate_host}:{port}",
                f"https://{candidate_host}:{port}",
            ]
        )

    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=list(dict.fromkeys(allowed_hosts)),
        allowed_origins=list(dict.fromkeys(allowed_origins)),
    )


def _loopback_aliases(host: str) -> tuple[str, ...]:
    if not is_loopback_hostname(host):
        return (host,)
    aliases = ["127.0.0.1", "localhost", "[::1]"]
    if host not in aliases:
        aliases.insert(0, host)
    return tuple(aliases)


def _parser(settings: Settings) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the News Trace fixture MCP server over Streamable HTTP."
    )
    parser.add_argument(
        "--host",
        default=settings.mcp_host,
        help=f"MCP bind host (default: {settings.mcp_host})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=settings.mcp_port,
        help=f"MCP bind port (default: {settings.mcp_port})",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    settings = Settings.from_env()
    args = _parser(settings).parse_args(argv)

    if not settings.fixture_enabled:
        print(
            "news_trace.mcp_server only serves the deterministic fixture in this "
            f"milestone; NEWS_TRACE_MODE={settings.mode!r} is not supported. "
            "Set NEWS_TRACE_MODE=fixture explicitly.",
            file=sys.stderr,
        )
        return 2

    if not is_loopback_hostname(args.host):
        print(
            "news_trace.mcp_server refuses to bind a non-loopback host in this "
            f"fixture milestone (requested {args.host!r}).",
            file=sys.stderr,
        )
        return 2

    if not settings.fixture_path.is_file():
        print(
            f"Fixture file not found: {settings.fixture_path}",
            file=sys.stderr,
        )
        return 2

    try:
        repository = FixtureRepository(settings.fixture_path)
    except Exception as exc:
        print(
            "Fixture could not be loaded: "
            f"{type(exc).__name__}: {exc}",
            file=sys.stderr,
        )
        return 2

    security = build_transport_security(settings, host=args.host, port=args.port)
    server = create_server(repository)
    logger.info(
        "Serving fixture research %s at http://%s:%d%s",
        repository.research_id,
        args.host,
        args.port,
        STREAMABLE_HTTP_PATH,
    )
    server.run(
        "streamable-http",
        host=args.host,
        port=args.port,
        streamable_http_path=STREAMABLE_HTTP_PATH,
        transport_security=security,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
