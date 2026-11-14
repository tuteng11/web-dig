"""Real official-SDK MCP integration over Streamable HTTP."""

from __future__ import annotations

import json

import httpx
import pytest
from mcp import Client
from mcp.types import TextContent

from news_trace.mcp_client import MCPClient, MCPToolError
from news_trace.models import (
    ErrorCode,
    ErrorEnvelope,
    GraphResult,
    NodeDetails,
    PublicationPrecision,
    TimezoneStatus,
)

from transport_helpers import running_fixture_mcp_server


@pytest.fixture(scope="session")
def mcp_server_process():
    with running_fixture_mcp_server() as server:
        yield server


def _text_payload(result) -> dict:
    text_blocks = [block for block in result.content if isinstance(block, TextContent)]
    assert text_blocks, "expected a text fallback alongside structuredContent"
    return json.loads(text_blocks[0].text)


def test_mcp_transport_rejects_unapproved_host(mcp_server_process) -> None:
    bad = httpx.get(
        mcp_server_process.url,
        headers={"host": "evil.example", "accept": "text/event-stream"},
    )
    good = httpx.get(
        mcp_server_process.url,
        headers={
            "host": f"127.0.0.1:{mcp_server_process.port}",
            "accept": "text/event-stream",
        },
        timeout=1.0,
    )

    assert bad.status_code == 421
    assert good.status_code != 421


async def test_official_client_lists_only_research_tools(mcp_server_process) -> None:
    async with Client(
        mcp_server_process.url,
        read_timeout_seconds=10.0,
    ) as client:
        listing = await client.list_tools()

    assert {tool.name for tool in listing.tools} == {
        "get_research_graph",
        "get_node_details",
    }
    assert len(listing.tools) == 2
    for tool in listing.tools:
        assert tool.input_schema["type"] == "object"
        assert tool.output_schema is not None


async def test_official_client_reads_typed_graph_and_node(
    mcp_server_process,
) -> None:
    async with Client(
        mcp_server_process.url,
        read_timeout_seconds=10.0,
    ) as client:
        graph_result = await client.call_tool(
            "get_research_graph",
            {"research_id": "fixture-riverbend"},
        )
        node_result = await client.call_tool(
            "get_node_details",
            {"research_id": "fixture-riverbend", "node_id": "n-dateonly"},
        )

    assert graph_result.is_error is False
    graph = GraphResult.model_validate(graph_result.structured_content)
    assert graph.research_id == "fixture-riverbend"
    assert graph.root_node_id == "n-grassroots"
    assert graph.seed_node_id == "n-seed"
    assert len(graph.nodes) == 16
    # The unstructured fallback is compatible with the structured payload.
    assert GraphResult.model_validate(_text_payload(graph_result)) == graph

    assert node_result.is_error is False
    details = NodeDetails.model_validate(node_result.structured_content)
    assert details.node.id == "n-dateonly"
    assert details.node.publication.precision is PublicationPrecision.date
    assert details.node.publication.timestamp is None
    assert details.node.publication.timezone_status is TimezoneStatus.unknown


async def test_unknown_research_is_a_typed_error_not_a_fake_success(
    mcp_server_process,
) -> None:
    async with Client(
        mcp_server_process.url,
        read_timeout_seconds=10.0,
    ) as client:
        result = await client.call_tool(
            "get_research_graph",
            {"research_id": "does-not-exist"},
        )

    assert result.is_error is True
    envelope = ErrorEnvelope.model_validate(result.structured_content)
    assert envelope.error.code is ErrorCode.NOT_FOUND
    assert envelope.error.retryable is False

    text = _text_payload(result)
    assert text["error"]["code"] == "NOT_FOUND"
    serialized = json.dumps(text)
    assert "Traceback" not in serialized
    assert "site-packages" not in serialized


async def test_gateway_client_wrapper_validates_and_raises_typed_errors(
    mcp_server_process,
) -> None:
    client = MCPClient(mcp_server_process.url, timeout=10.0)

    graph = await client.get_graph("fixture-riverbend")
    assert graph.root_node_id == "n-grassroots"
    assert len(graph.nodes) == 16

    details = await client.get_node_details(
        "fixture-riverbend",
        "n-dateonly",
        detail_query="publication date",
    )
    assert details.node.publication.timestamp is None

    with pytest.raises(MCPToolError) as exc_info:
        await client.get_node_details("fixture-riverbend", "n-missing")

    assert exc_info.value.code == "NOT_FOUND"
    assert exc_info.value.retryable is False
    assert exc_info.value.message
