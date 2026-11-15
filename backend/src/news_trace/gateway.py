"""FastAPI gateway for the News Trace fixture milestone.

The read path is deliberately indirect: routes call an official-SDK MCP client,
which opens a Streamable HTTP session to ``news_trace.mcp_server``. This module
must never import the fixture repository or read fixture data in process.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Sequence
from typing import Any

import uvicorn
from fastapi import FastAPI, Path, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from news_trace.api_contracts import (
    AddDiscoveriesRequest,
    AskQuestionRequest,
    ExpandNodeRequest,
    StartResearchRequest,
)
from news_trace.config import Settings
from news_trace.mcp_client import (
    MCPClient,
    MCPClientError,
    MCPInvalidResultError,
    MCPProtocolError,
    MCPToolError,
    MCPUnavailableError,
)
from news_trace.models import (
    ErrorCode,
    ErrorDetail,
    ErrorEnvelope,
    GraphResult,
    NodeDetails,
)
from news_trace.transport_security import is_loopback_hostname, validate_transport_access

logger = logging.getLogger(__name__)

SERVICE_NAME = "news-trace-gateway"
API_PREFIX = "/api/v1"

PROVIDER_NOT_CONFIGURED_MESSAGE = (
    "Live research is not implemented in this milestone. "
    "Start the gateway with NEWS_TRACE_MODE=fixture to use the synthetic fixture."
)
RESEARCH_JOBS_NOT_IMPLEMENTED_MESSAGE = (
    "Research jobs and graph mutations are not implemented in this milestone. "
    "The synthetic demo is read-only; no job was created."
)
JOB_NOT_FOUND_MESSAGE = "No research job with that id exists in this milestone."
MCP_UNAVAILABLE_MESSAGE = "The research data service is unavailable."
NOT_FOUND_MESSAGE = "The requested research object was not found."
INVALID_MCP_RESULT_MESSAGE = "The research data service returned an invalid response."
INTERNAL_ERROR_MESSAGE = "The gateway could not complete this request."


def _envelope_response(
    status_code: int,
    code: ErrorCode,
    message: str,
    *,
    retryable: bool,
) -> JSONResponse:
    envelope = ErrorEnvelope(
        error=ErrorDetail(code=code, message=message, retryable=retryable),
    )
    return JSONResponse(
        status_code=status_code,
        content=envelope.model_dump(mode="json"),
        headers={"Cache-Control": "no-store"},
    )


def _provider_not_configured() -> JSONResponse:
    return _envelope_response(
        503,
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        PROVIDER_NOT_CONFIGURED_MESSAGE,
        retryable=False,
    )


def _research_jobs_not_implemented() -> JSONResponse:
    return _envelope_response(
        503,
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        RESEARCH_JOBS_NOT_IMPLEMENTED_MESSAGE,
        retryable=False,
    )


def _job_not_found() -> JSONResponse:
    return _envelope_response(
        404,
        ErrorCode.NOT_FOUND,
        JOB_NOT_FOUND_MESSAGE,
        retryable=False,
    )


def _map_client_error(exc: MCPClientError) -> JSONResponse:
    if isinstance(exc, MCPUnavailableError):
        return _envelope_response(
            503,
            ErrorCode.MCP_UNAVAILABLE,
            MCP_UNAVAILABLE_MESSAGE,
            retryable=True,
        )
    if isinstance(exc, MCPToolError):
        if exc.code == ErrorCode.NOT_FOUND.value:
            return _envelope_response(
                404,
                ErrorCode.NOT_FOUND,
                NOT_FOUND_MESSAGE,
                retryable=False,
            )
        if exc.retryable:
            return _envelope_response(
                503,
                ErrorCode.MCP_UNAVAILABLE,
                MCP_UNAVAILABLE_MESSAGE,
                retryable=True,
            )
        return _envelope_response(
            500,
            ErrorCode.INTERNAL_ERROR,
            "The research data service reported an error.",
            retryable=False,
        )
    if isinstance(exc, (MCPInvalidResultError, MCPProtocolError)):
        return _envelope_response(
            500,
            ErrorCode.INTERNAL_ERROR,
            INVALID_MCP_RESULT_MESSAGE,
            retryable=False,
        )
    return _envelope_response(
        500,
        ErrorCode.INTERNAL_ERROR,
        INVALID_MCP_RESULT_MESSAGE,
        retryable=False,
    )


def create_app(
    settings: Settings | None = None,
    client: object | None = None,
) -> FastAPI:
    """Build the gateway app.

    ``client`` exists for focused tests; when omitted the default is an
    ``MCPClient`` pointed at ``settings.mcp_url``. The app stores no repository
    handle, so there is no in-process fixture shortcut.
    """

    resolved = settings or Settings.from_env()
    mcp_client: Any = client if client is not None else MCPClient(resolved.mcp_url)

    app = FastAPI(
        title="News Trace Gateway",
        version="0.1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    app.state.settings = resolved
    app.state.mcp_client = mcp_client

    @app.middleware("http")
    async def local_access_and_cache_control(request: Request, call_next: Any) -> Any:
        is_api_route = request.url.path.startswith(f"{API_PREFIX}/")
        if is_api_route:
            rejection = validate_transport_access(
                request.headers.get("host"),
                request.headers.get("origin"),
                resolved,
            )
            if rejection is not None:
                return _envelope_response(
                    421,
                    ErrorCode.INVALID_REQUEST,
                    rejection,
                    retryable=False,
                )

        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        _ = request, exc
        return _envelope_response(
            422,
            ErrorCode.INVALID_REQUEST,
            "The request parameters are invalid.",
            retryable=False,
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(
        request: Request,
        exc: StarletteHTTPException,
    ) -> JSONResponse:
        _ = request
        if exc.status_code == 404:
            return _envelope_response(
                404,
                ErrorCode.NOT_FOUND,
                "The requested route or object was not found.",
                retryable=False,
            )
        return _envelope_response(
            exc.status_code,
            ErrorCode.INVALID_REQUEST,
            "The request could not be processed.",
            retryable=False,
        )

    @app.get("/health")
    async def health() -> dict[str, Any]:
        return {
            "status": "ok",
            "service": SERVICE_NAME,
            "mode": resolved.mode,
            "fixture": resolved.fixture_enabled,
        }

    @app.get(
        f"{API_PREFIX}/research/{{research_id}}/graph",
        response_model=GraphResult,
    )
    async def get_research_graph(
        research_id: str = Path(min_length=1, max_length=200),
    ) -> GraphResult | JSONResponse:
        if not resolved.fixture_enabled:
            return _provider_not_configured()
        try:
            return await mcp_client.get_graph(research_id)
        except MCPClientError as exc:
            return _map_client_error(exc)
        except Exception:
            logger.exception("Unexpected gateway failure reading a research graph")
            return _envelope_response(
                500,
                ErrorCode.INTERNAL_ERROR,
                INTERNAL_ERROR_MESSAGE,
                retryable=False,
            )

    @app.get(
        f"{API_PREFIX}/research/{{research_id}}/nodes/{{node_id}}",
        response_model=NodeDetails,
    )
    async def get_node_details(
        research_id: str = Path(min_length=1, max_length=200),
        node_id: str = Path(min_length=1, max_length=200),
        detail_query: str | None = Query(default=None, max_length=1000),
    ) -> NodeDetails | JSONResponse:
        if not resolved.fixture_enabled:
            return _provider_not_configured()
        try:
            return await mcp_client.get_node_details(
                research_id,
                node_id,
                detail_query,
            )
        except MCPClientError as exc:
            return _map_client_error(exc)
        except Exception:
            logger.exception("Unexpected gateway failure reading node details")
            return _envelope_response(
                500,
                ErrorCode.INTERNAL_ERROR,
                INTERNAL_ERROR_MESSAGE,
                retryable=False,
            )

    # The frontend already calls these routes. No job store or mutation
    # implementation exists in this milestone, so validate the typed request and
    # answer honestly instead of returning a fabricated job. Read routes above
    # remain the MCP-backed implementation.
    @app.post(f"{API_PREFIX}/research")
    async def start_research(payload: StartResearchRequest) -> JSONResponse:
        _ = payload
        return _research_jobs_not_implemented()

    @app.post(f"{API_PREFIX}/research/{{research_id}}/expand")
    async def expand_research_node(
        payload: ExpandNodeRequest,
        research_id: str = Path(min_length=1, max_length=200),
    ) -> JSONResponse:
        _ = payload, research_id
        return _research_jobs_not_implemented()

    @app.post(f"{API_PREFIX}/research/{{research_id}}/questions")
    async def ask_research_question(
        payload: AskQuestionRequest,
        research_id: str = Path(min_length=1, max_length=200),
    ) -> JSONResponse:
        _ = payload, research_id
        return _research_jobs_not_implemented()

    @app.post(f"{API_PREFIX}/research/{{research_id}}/discoveries")
    async def add_research_discoveries(
        payload: AddDiscoveriesRequest,
        research_id: str = Path(min_length=1, max_length=200),
    ) -> JSONResponse:
        _ = payload, research_id
        return _research_jobs_not_implemented()

    @app.get(f"{API_PREFIX}/jobs/{{job_id}}")
    async def get_research_job(
        job_id: str = Path(min_length=1, max_length=200),
        after_event_seq: int | None = Query(default=None, ge=0),
    ) -> JSONResponse:
        _ = job_id, after_event_seq
        return _job_not_found()

    @app.post(f"{API_PREFIX}/jobs/{{job_id}}/cancel")
    async def cancel_research_job(
        job_id: str = Path(min_length=1, max_length=200),
    ) -> JSONResponse:
        _ = job_id
        return _job_not_found()

    return app


def _parser(settings: Settings) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run the News Trace gateway (fixture milestone)."
    )
    parser.add_argument(
        "--host",
        default=settings.gateway_host,
        help=f"Gateway bind host (default: {settings.gateway_host})",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=settings.gateway_port,
        help=f"Gateway bind port (default: {settings.gateway_port})",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    settings = Settings.from_env()
    args = _parser(settings).parse_args(argv)

    if not is_loopback_hostname(args.host):
        print(
            "news_trace.gateway refuses to bind a non-loopback host in this "
            f"fixture milestone (requested {args.host!r}).",
            file=sys.stderr,
        )
        return 2

    uvicorn.run(
        create_app(settings),
        host=args.host,
        port=args.port,
        log_level="info",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
