"""Search provider checks and URL normalization for the research App."""

from __future__ import annotations

import json
import os
import re
from typing import Any
from urllib.parse import quote

from mcp.types import TextContent

from news_trace.databricks.platform import (
    ProbeError,
    authenticated_mcp,
    https_url,
    model_request,
    required,
    workspace,
)
from news_trace.databricks.source_fetch import FetchError, source_url

URL_KEYS = {"url", "uri", "href", "link"}
MARKDOWN_URL = re.compile(r"\]\((https?://[^\s<>\)]+)\)")


def candidate_urls(payload: object, *, allow_text_links: bool = False) -> list[str]:
    candidates: dict[str, None] = {}

    def add(value: str) -> None:
        try:
            candidates[str(source_url(value))] = None
        except FetchError:
            return

    def visit(value: object, depth: int = 0) -> None:
        if depth > 12 or len(candidates) >= 12:
            return
        if isinstance(value, dict):
            for key, child in value.items():
                if len(candidates) >= 12:
                    break
                if key in URL_KEYS and isinstance(child, str):
                    add(child)
                else:
                    visit(child, depth + 1)
        elif isinstance(value, list):
            for child in value:
                visit(child, depth + 1)
        elif allow_text_links and isinstance(value, str):
            for match in MARKDOWN_URL.finditer(value[:20_000]):
                add(match[1])
                if len(candidates) >= 12:
                    break

    visit(payload)
    return list(candidates)


async def _mcp_search(mode: str, query: str) -> list[str]:
    host = https_url(workspace().config.host)
    if mode == "managed-mcp":
        url = f"{host}/ai-gateway/mcp-services/system.ai.web_search"
        tool_name = "web_search"
    else:
        connection = quote(required("NEWS_TRACE_SEARCH_CONNECTION"), safe="")
        url = f"{host}/api/2.0/mcp/external/{connection}"
        tool_name = required("NEWS_TRACE_SEARCH_TOOL")
    async with authenticated_mcp(url) as client:
        tools = await client.list_tools()
        tool = next((item for item in tools.tools if item.name == tool_name), None)
        schema = tool.input_schema if tool is not None else {}
        if "query" not in schema.get("properties", {}) or set(schema.get("required", [])) - {"query"}:
            raise ProbeError("SEARCH_TOOL_SCHEMA_UNSUPPORTED")
        response = await client.call_tool(tool_name, {"query": query})
        if response.is_error:
            raise ProbeError("SEARCH_UNAVAILABLE")
    parts: list[Any] = [response.structured_content]
    for block in response.content:
        if isinstance(block, TextContent):
            try:
                parts.append(json.loads(block.text))
            except (ValueError, RecursionError):
                parts.append(block.text)
    return candidate_urls(parts, allow_text_links=True)


async def search_probe(query: str) -> tuple[str, list[str]]:
    mode = os.environ.get("NEWS_TRACE_SEARCH_MODE", "managed-mcp")
    if mode in {"managed-mcp", "external-mcp"}:
        urls = await _mcp_search(mode, query)
    elif mode == "native-openai":
        result = await model_request("/ai-gateway/openai/v1/responses", {
            "model": required("NEWS_TRACE_SEARCH_MODEL"),
            "input": query,
            "tools": [{"type": "web_search"}],
            "max_output_tokens": 512,
        })
        urls = candidate_urls(result.get("output"))
    elif mode == "native-gemini":
        model = quote(required("NEWS_TRACE_SEARCH_MODEL"), safe="")
        result = await model_request(f"/ai-gateway/gemini/v1beta/models/{model}:generateContent", {
            "contents": [{"role": "user", "parts": [{"text": query}]}],
            "tools": [{"google_search": {}}],
            "generationConfig": {"maxOutputTokens": 512},
        })
        grounding = [item.get("groundingMetadata") for item in result.get("candidates", [])]
        urls = candidate_urls(grounding)
    else:
        raise ProbeError("INVALID_CONFIGURATION")
    if not urls:
        raise ProbeError("SEARCH_NO_CITATION_URLS")
    return mode, urls
