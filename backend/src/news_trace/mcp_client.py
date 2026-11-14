"""Official-SDK MCP client used by the gateway.

The gateway never reads fixture data directly. Every graph/node read crosses a
real Streamable HTTP MCP session created by the official SDK, and untrusted
payloads are validated against the shared Pydantic models before they can reach
an HTTP response.
"""

from __future__ import annotations

import json
from typing import Any, TypeVar

import anyio
from mcp import Client
from mcp.shared.exceptions import MCPError
from mcp.types import CallToolResult, TextContent
from pydantic import BaseModel, ValidationError

from news_trace.models import ErrorCode, ErrorDetail, ErrorEnvelope, GraphResult, NodeDetails

GET_RESEARCH_GRAPH_TOOL = "get_research_graph"
GET_NODE_DETAILS_TOOL = "get_node_details"

_ModelT = TypeVar("_ModelT", bound=BaseModel)


class MCPClientError(Exception):
    """Base class for failures reported by the MCP transport adapter."""


class MCPUnavailableError(MCPClientError):
    """The MCP endpoint could not be reached or the transport timed out."""


class MCPToolError(MCPClientError):
    """The server returned an ``isError`` result with a safe error payload."""

    def __init__(self, code: str, message: str, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class MCPInvalidResultError(MCPClientError):
    """The server's success payload did not match the shared contract."""


class MCPProtocolError(MCPClientError):
    """The MCP session failed at the protocol layer rather than the transport."""


class MCPClient:
    """Read-only MCP client for the fixture research tools.

    A fresh official-SDK Streamable HTTP session is opened for each call. That
    keeps the fixture server stateless from the gateway's perspective and avoids
    leaking a half-open session when a request times out.
    """

    def __init__(self, url: str, *, timeout: float = 10.0) -> None:
        if not url:
            raise ValueError("MCP URL must not be empty")
        if timeout <= 0:
            raise ValueError("MCP timeout must be positive")
        self.url = url
        self.timeout = timeout

    async def get_graph(self, research_id: str) -> GraphResult:
        return await self._call_tool(
            GET_RESEARCH_GRAPH_TOOL,
            {"research_id": research_id},
            GraphResult,
        )

    async def get_node_details(
        self,
        research_id: str,
        node_id: str,
        detail_query: str | None = None,
    ) -> NodeDetails:
        arguments: dict[str, Any] = {
            "research_id": research_id,
            "node_id": node_id,
        }
        if detail_query is not None:
            arguments["detail_query"] = detail_query
        return await self._call_tool(
            GET_NODE_DETAILS_TOOL,
            arguments,
            NodeDetails,
        )

    async def _call_tool(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        result_model: type[_ModelT],
    ) -> _ModelT:
        try:
            with anyio.fail_after(self.timeout):
                async with Client(
                    self.url,
                    read_timeout_seconds=self.timeout,
                ) as client:
                    try:
                        result = await client.call_tool(tool_name, arguments)
                    except RuntimeError as exc:
                        # The SDK revalidates structured output against the
                        # advertised schema and raises RuntimeError when it does
                        # not conform.
                        raise MCPInvalidResultError(
                            "The research data service returned an invalid structured result."
                        ) from exc
        except (MCPToolError, MCPInvalidResultError, MCPProtocolError):
            raise
        except TimeoutError as exc:
            raise MCPUnavailableError(
                "The research data service did not respond before the timeout."
            ) from exc
        except MCPError as exc:
            raise MCPProtocolError(
                "The research data service rejected the MCP request."
            ) from exc
        except Exception as exc:  # transport/SDK failures surface in many shapes
            raise MCPUnavailableError(
                "The research data service is unavailable."
            ) from exc

        if result.is_error:
            raise _tool_error_from_result(result)
        return _validate_result(result, result_model)

    async def aclose(self) -> None:
        """No persistent session is kept; present for a stable async lifecycle."""


def _tool_error_from_result(result: CallToolResult) -> MCPToolError:
    payload = result.structured_content
    if payload is None:
        payload = _first_text_payload(result)

    envelope: ErrorEnvelope | None = None
    if isinstance(payload, dict):
        try:
            envelope = ErrorEnvelope.model_validate(payload)
        except ValidationError:
            try:
                detail = ErrorDetail.model_validate(payload)
            except ValidationError:
                detail = None
            if detail is not None:
                envelope = ErrorEnvelope(error=detail)

    if envelope is not None:
        return MCPToolError(
            code=envelope.error.code.value,
            message=envelope.error.message,
            retryable=envelope.error.retryable,
        )

    # Never surface raw server text: an unexpected error shape is not trusted.
    return MCPToolError(
        code=ErrorCode.INTERNAL_ERROR.value,
        message="The research data service reported an error.",
        retryable=False,
    )


def _validate_result(
    result: CallToolResult,
    result_model: type[_ModelT],
) -> _ModelT:
    payload = result.structured_content
    if payload is None:
        payload = _first_text_payload(result)
    if payload is None:
        raise MCPInvalidResultError(
            "The research data service returned no structured result."
        )

    try:
        return result_model.model_validate(payload)
    except (ValidationError, TypeError, ValueError) as exc:
        raise MCPInvalidResultError(
            "The research data service returned a result that violates the shared contract."
        ) from exc


def _first_text_payload(result: CallToolResult) -> Any | None:
    """Parse the first text block that contains JSON, if any.

    Successful structured results normally arrive in ``structuredContent``. This
    fallback keeps clients compatible with servers that only provide the
    protocol-required text content.
    """

    for block in result.content:
        if not isinstance(block, TextContent):
            continue
        try:
            return json.loads(block.text)
        except (TypeError, ValueError):
            continue
    return None
