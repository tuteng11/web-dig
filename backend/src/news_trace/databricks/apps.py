"""Databricks capability Apps. Run each role behind its Databricks Apps proxy."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import time
from collections.abc import Awaitable, Callable
from typing import Any

import httpx
import psycopg
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from starlette.responses import JSONResponse as StarletteJSONResponse
from starlette.routing import Route

from news_trace.databricks.platform import (
    ProbeError,
    authenticated_mcp,
    https_url,
    lakebase_probe,
    model_request,
    required,
)
from news_trace.databricks.search import search_probe
from news_trace.databricks.source_fetch import FetchError, fetch_public_page

TOOL_NAME = "probe_challenge"
TOOL = {
    "type": "function",
    "function": {
        "name": TOOL_NAME,
        "description": "Read the transient code for this capability check.",
        "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
    },
}


async def check(operation: Callable[[], Awaitable[dict[str, Any]]]) -> dict[str, Any]:
    started = time.monotonic()
    try:
        return {"status": "pass", **await operation()}
    except (ProbeError, FetchError) as exc:
        status = "unconfigured" if exc.code == "NOT_CONFIGURED" else "fail"
        return {"status": status, "code": exc.code}
    except httpx.HTTPStatusError as exc:
        return {"status": "fail", "code": f"HTTP_{exc.response.status_code}"}
    except psycopg.Error as exc:
        return {"status": "fail", "code": exc.sqlstate or "DATABASE_CONNECTION_FAILED"}
    except TimeoutError:
        return {"status": "fail", "code": "TIMEOUT"}
    except Exception as exc:
        # Provider exceptions can contain response bodies or credentials. Log only the class.
        print(f"Probe failed: {type(exc).__name__} after {time.monotonic() - started:.1f}s", flush=True)
        return {"status": "fail", "code": "DEPENDENCY_ERROR", "type": type(exc).__name__}


def _payload(result: Any) -> dict[str, Any]:
    if result.is_error or not isinstance(result.structured_content, dict):
        raise ProbeError("INVALID_MCP_RESULT")
    return result.structured_content


async def verify_mcp() -> dict[str, Any]:
    async with authenticated_mcp(required("NEWS_TRACE_RESEARCH_MCP_URL")) as client:
        tools = await client.list_tools()
        names = {tool.name for tool in tools.tools}
        if not {"health", "probe_capabilities", TOOL_NAME}.issubset(names):
            raise ProbeError("MCP_TOOLS_MISSING")
        if _payload(await client.call_tool("health", {})) != {"status": "healthy"}:
            raise ProbeError("INVALID_MCP_RESULT")
    return {"tools": sorted(names)}


def _assistant(result: dict[str, Any]) -> dict[str, Any]:
    try:
        message = result["choices"][0]["message"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ProbeError("INVALID_MODEL_OUTPUT") from exc
    if not isinstance(message, dict) or message.get("role") != "assistant":
        raise ProbeError("INVALID_MODEL_OUTPUT")
    return message


async def hosted_tool_probe() -> dict[str, Any]:
    model = required("NEWS_TRACE_MODEL")
    route = "/ai-gateway/mlflow/v1/chat/completions"
    messages = [{
        "role": "user",
        "content": "Call the available tool. Then reply with only its code value verbatim.",
    }]
    first = _assistant(await model_request(route, {
        "model": model, "messages": messages, "tools": [TOOL], "tool_choice": "required",
        "max_tokens": 512,
    }))
    calls = first.get("tool_calls")
    if not isinstance(calls, list) or len(calls) != 1:
        raise ProbeError("MODEL_TOOL_CALL_MISSING")
    try:
        call = calls[0]
        if (call["type"] != "function" or call["function"]["name"] != TOOL_NAME
                or json.loads(call["function"]["arguments"]) != {} or not call["id"]):
            raise ProbeError("INVALID_MODEL_TOOL_CALL")
    except (KeyError, ValueError, TypeError) as exc:
        raise ProbeError("INVALID_MODEL_TOOL_CALL") from exc
    async with authenticated_mcp(required("NEWS_TRACE_RESEARCH_MCP_URL")) as client:
        result = _payload(await client.call_tool(TOOL_NAME, {}))
    code = result.get("code")
    if not isinstance(code, str) or len(code) != 16:
        raise ProbeError("INVALID_MCP_RESULT")
    messages += [
        {"role": "assistant", "content": first.get("content"), "tool_calls": calls},
        {"role": "tool", "tool_call_id": call["id"], "content": json.dumps({"code": code})},
    ]
    final = _assistant(await model_request(route, {
        "model": model, "messages": messages, "tools": [TOOL], "tool_choice": "none",
        "max_tokens": 512,
    }))
    content = final.get("content")
    if not isinstance(content, str) or content.strip() != code:
        raise ProbeError("MODEL_TOOL_RESULT_NOT_CONFIRMED")
    return {"model": model, "tool": TOOL_NAME, "tool_result_confirmed": True}


async def _research_checks() -> dict[str, Any]:
    urls: list[str] = []
    hosts = frozenset(host.strip().lower() for host in os.environ.get("NEWS_TRACE_SOURCE_HOSTS", "").split(",") if host.strip())

    async def search() -> dict[str, Any]:
        mode, result = await search_probe(required("NEWS_TRACE_SEARCH_QUERY"))
        urls.extend(result)
        return {"mode": mode, "candidate_count": len(urls)}

    async def fetch_sample() -> dict[str, Any]:
        if not hosts:
            raise ProbeError("NOT_CONFIGURED")
        page = await fetch_public_page(required("NEWS_TRACE_SAMPLE_URL"), hosts)
        return {"bytes": len(page.body), "redirects": page.redirects}

    lakebase, search_result, source_fetch = await asyncio.gather(
        check(lambda: lakebase_probe("research")), check(search), check(fetch_sample),
    )

    async def fetch_candidate() -> dict[str, Any]:
        if search_result["status"] != "pass":
            raise ProbeError("SEARCH_DID_NOT_PASS")
        if not hosts:
            raise ProbeError("NOT_CONFIGURED")
        candidates = [url for url in urls if httpx.URL(url).raw_host.decode("ascii") in hosts]
        if not candidates:
            raise ProbeError("NO_CITATION_ON_APPROVED_HOST")
        page = await fetch_public_page(candidates[0], hosts)
        return {"bytes": len(page.body), "redirects": page.redirects}

    search_result.setdefault("mode", os.environ.get("NEWS_TRACE_SEARCH_MODE", "managed-mcp"))
    return {
        "lakebase": lakebase,
        "search": search_result,
        "source_fetch": source_fetch,
        "search_result_fetch": await check(fetch_candidate),
    }


def create_research_app():
    server = MCPServer(name="news-trace-capability-probe")
    lock = asyncio.Lock()

    @server.tool()
    async def health() -> dict[str, str]:
        return {"status": "healthy"}

    @server.tool()
    async def probe_challenge() -> dict[str, str]:
        return {"code": secrets.token_hex(8)}

    @server.tool()
    async def probe_capabilities() -> dict[str, Any]:
        if lock.locked():
            return {"status": "fail", "code": "PROBE_BUSY"}
        async with lock:
            return await _research_checks()

    async def http_health(_request: Request) -> StarletteJSONResponse:
        return StarletteJSONResponse({"status": "ok", "service": "mcp-news-trace", "mode": "capability-probe"})

    hosts = [value.strip() for value in os.environ.get("NEWS_TRACE_RESEARCH_ALLOWED_HOSTS", "").split(",") if value.strip()]
    if hosts:
        security = TransportSecuritySettings(enable_dns_rebinding_protection=True, allowed_hosts=hosts)
    else:
        security = TransportSecuritySettings(enable_dns_rebinding_protection=True, allowed_hosts=["127.0.0.1:*"])
    app = server.streamable_http_app(
        json_response=True, stateless_http=True, transport_security=security, max_request_body_size=16_384,
    )
    app.routes.append(Route("/health", http_health))
    return app


async def _remote_checks() -> dict[str, Any]:
    async with authenticated_mcp(required("NEWS_TRACE_RESEARCH_MCP_URL"), timeout=65) as client:
        result = _payload(await client.call_tool("probe_capabilities", {}))
    if "lakebase" not in result:
        raise ProbeError("PROBE_BUSY" if result.get("code") == "PROBE_BUSY" else "INVALID_MCP_RESULT")
    return {"checks": result}


def create_web_app() -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    lock = asyncio.Lock()
    operators = frozenset(os.environ.get("NEWS_TRACE_PROBE_OPERATORS", "").split())

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok", "service": "news-trace-web", "mode": "capability-probe"}

    @app.post("/internal/databricks/probe")
    async def probe(request: Request) -> JSONResponse:
        # This identity comes from the Databricks Apps proxy. Never expose this service's bind port directly.
        caller_ids = request.headers.getlist("x-forwarded-user")
        if len(caller_ids) != 1 or caller_ids[0] not in operators:
            return JSONResponse({"code": "NOT_FOUND"}, status_code=404)
        if request.headers.get("origin") or request.headers.get("x-news-trace-probe") != "run":
            return JSONResponse({"code": "INVALID_REQUEST"}, status_code=403)
        if lock.locked():
            return JSONResponse({"code": "PROBE_BUSY"}, status_code=409)
        async with lock:
            lakebase, mcp, model, research = await asyncio.gather(
                check(lambda: lakebase_probe("web")), check(verify_mcp),
                check(hosted_tool_probe), check(_remote_checks),
            )
        return JSONResponse({
            "mode": "capability-probe", "lakebase": lakebase, "mcp": mcp,
            "hosted_model": model, "research_app": research,
        }, headers={"Cache-Control": "no-store"})

    return app


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("role", choices=("web", "research"))
    role = parser.parse_args().role
    port = os.environ.get("DATABRICKS_APP_PORT")
    app = create_web_app() if role == "web" else create_research_app()
    uvicorn.run(app, host="0.0.0.0" if port else "127.0.0.1", port=int(port or "8000"), proxy_headers=False)


if __name__ == "__main__":
    main()
