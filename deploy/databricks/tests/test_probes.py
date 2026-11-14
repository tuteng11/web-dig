import json
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import httpx2
import pytest
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

from news_trace.databricks import apps, platform, source_fetch
from news_trace.databricks.search import candidate_urls


@pytest.mark.asyncio
async def test_research_app_speaks_streamable_http():
    app = apps.create_research_app()
    async with app.router.lifespan_context(app):
        async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app)) as http_client:
            assert (await http_client.get("http://127.0.0.1:8000/health")).status_code == 200
            transport = streamable_http_client("http://127.0.0.1:8000/mcp", http_client=http_client)
            async with Client(transport, mode="legacy") as client:
                tools = await client.list_tools()
                assert {tool.name for tool in tools.tools} == {"health", "probe_challenge", "probe_capabilities"}
                result = await client.call_tool("probe_challenge", {})
                assert not result.is_error
                assert len(result.structured_content["code"]) == 16


@pytest.mark.asyncio
async def test_model_result_must_match_real_tool_response(monkeypatch):
    monkeypatch.setenv("NEWS_TRACE_MODEL", "model-for-test")
    monkeypatch.setenv("NEWS_TRACE_RESEARCH_MCP_URL", "https://research.example/mcp")
    calls = []

    @asynccontextmanager
    async def mcp(_url):
        app = apps.create_research_app()
        async with app.router.lifespan_context(app):
            async with httpx2.AsyncClient(transport=httpx2.ASGITransport(app=app)) as http_client:
                transport = streamable_http_client("http://127.0.0.1:8000/mcp", http_client=http_client)
                async with Client(transport, mode="legacy") as client:
                    yield client

    async def model(_path, payload):
        calls.append(payload["messages"][-1])
        if len(calls) == 1:
            message = {"role": "assistant", "tool_calls": [{
                "id": "call-1", "type": "function",
                "function": {"name": "probe_challenge", "arguments": "{}"},
            }]}
        else:
            assert calls[-1]["role"] == "tool"
            assert calls[-1]["tool_call_id"] == "call-1"
            message = {"role": "assistant", "content": json.loads(calls[-1]["content"])["code"]}
        return {"choices": [{"message": message}]}

    monkeypatch.setattr(apps, "authenticated_mcp", mcp)
    monkeypatch.setattr(apps, "model_request", model)
    assert (await apps.hosted_tool_probe())["tool_result_confirmed"]
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_web_probe_accepts_only_configured_operator(monkeypatch):
    monkeypatch.setenv("NEWS_TRACE_PROBE_OPERATORS", "123@456")
    app = apps.create_web_app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        path = "/internal/databricks/probe"
        assert (await client.post(path, headers={"X-News-Trace-Probe": "run"})).status_code == 404
        response = await client.post(path, headers={
            "X-News-Trace-Probe": "run", "X-Forwarded-User": "123@456", "Origin": "https://other.example",
        })
        assert response.status_code == 403
        for name in ("NEWS_TRACE_MODEL", "NEWS_TRACE_RESEARCH_MCP_URL", "NEWS_TRACE_LAKEBASE_ENDPOINT"):
            monkeypatch.delenv(name, raising=False)
        response = await client.post(path, headers={"X-News-Trace-Probe": "run", "X-Forwarded-User": "123@456"})
        assert response.status_code == 200
        assert response.json()["hosted_model"] == {"status": "unconfigured", "code": "NOT_CONFIGURED"}


@pytest.mark.asyncio
async def test_fetch_applies_allowlist_to_redirects(monkeypatch):
    hits = []

    async def get(url, _limit, _accept):
        hits.append(str(url))
        if url.path == "/robots.txt":
            return 404, httpx.Headers(), b""
        return 302, httpx.Headers({"Location": "https://unapproved.test/"}), b""

    monkeypatch.setattr(source_fetch, "_get", get)
    with pytest.raises(source_fetch.FetchError, match="SOURCE_URL_BLOCKED"):
        await source_fetch.fetch_public_page("https://publisher.test/news", frozenset({"publisher.test"}))
    assert hits == ["https://publisher.test/robots.txt", "https://publisher.test/news"]


@pytest.mark.asyncio
async def test_fetch_stops_at_robots_denial(monkeypatch):
    async def get(url, _limit, _accept):
        assert url.path == "/robots.txt"
        return 200, httpx.Headers(), b"User-agent: NewsTraceBot\nDisallow: /news*\n"

    monkeypatch.setattr(source_fetch, "_get", get)
    with pytest.raises(source_fetch.FetchError, match="SOURCE_ACCESS_DENIED"):
        await source_fetch.fetch_public_page("https://publisher.test/news", frozenset({"publisher.test"}))


@pytest.mark.asyncio
async def test_lakebase_issues_new_token_for_each_connection(monkeypatch):
    for name, value in {
        "PGHOST": "db.test", "PGUSER": "app", "PGDATABASE": "app-db", "PGSSLMODE": "require",
        "NEWS_TRACE_LAKEBASE_ENDPOINT": "projects/proj/branches/main/endpoints/primary",
    }.items():
        monkeypatch.setenv(name, value)
    tokens = iter(["first", "second"])
    workspace = SimpleNamespace(postgres=SimpleNamespace(
        generate_database_credential=lambda **kwargs: SimpleNamespace(token=next(tokens)),
    ))
    used = []

    async def connect(**kwargs):
        used.append(kwargs["password"])
        assert kwargs["sslmode"] == "require"

    monkeypatch.setattr(platform, "workspace", lambda: workspace)
    monkeypatch.setattr(platform.psycopg.AsyncConnection, "connect", connect)
    await platform._lakebase_connection()
    await platform._lakebase_connection()
    assert used == ["first", "second"]


def test_search_normalizes_deduplicates_and_preserves_order():
    payload = {"citations": [
        {"url": "https://publisher.test/article#a"},
        {"url": "https://publisher.test/article#b"},
        {"url": "https://user:password@publisher.test/private"},
        {"url": "file:///private"},
        {"url": "https://publisher.test:1234/"},
        {"uri": "https://publisher.test/next"},
    ]}
    assert candidate_urls(payload) == ["https://publisher.test/article", "https://publisher.test/next"]
