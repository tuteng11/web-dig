"""Gateway integration through a real MCP subprocess."""

from __future__ import annotations

import inspect
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

import news_trace.gateway as gateway_module
from news_trace.config import Settings
from news_trace.gateway import create_app
from news_trace.mcp_client import MCPClient, MCPInvalidResultError
from news_trace.models import (
    ErrorCode,
    ErrorEnvelope,
    GraphResult,
    NodeDetails,
)

from helpers import FIXTURE_PATH
from transport_helpers import allocate_free_loopback_port, running_fixture_mcp_server

GRAPH_PATH = "/api/v1/research/fixture-riverbend/graph"
NODE_PATH = "/api/v1/research/fixture-riverbend/nodes"
PREVIEW_HOST = "127.0.0.1:4173"
PREVIEW_ORIGIN = "http://127.0.0.1:4173"
REQUEST_ID = "6f1c1f3e-5a2b-4c8d-9e0f-1234567890ab"


@pytest.fixture(scope="session")
def mcp_server_process():
    with running_fixture_mcp_server() as server:
        yield server


def make_settings(
    mcp_url: str,
    *,
    mode: str = "fixture",
    allowed_hosts: tuple[str, ...] = ("testserver", PREVIEW_HOST),
    allowed_origins: tuple[str, ...] = ("http://testserver", PREVIEW_ORIGIN),
) -> Settings:
    base = Settings.from_env()
    return replace(
        base,
        mode=mode,
        fixture_path=FIXTURE_PATH,
        mcp_url=mcp_url,
        allowed_hosts=allowed_hosts,
        allowed_origins=allowed_origins,
    )


def test_gateway_serves_graph_and_node_through_mcp(mcp_server_process) -> None:
    settings = make_settings(mcp_server_process.url)
    app = create_app(settings)
    with TestClient(app, base_url="http://testserver") as client:
        graph_response = client.get(GRAPH_PATH)
        node_response = client.get(f"{NODE_PATH}/n-dateonly")

    assert graph_response.status_code == 200
    assert graph_response.headers["cache-control"] == "no-store"
    graph = GraphResult.model_validate(graph_response.json())
    assert graph.root_node_id == "n-grassroots"
    assert graph.seed_node_id == "n-seed"
    assert len(graph.nodes) == 16

    assert node_response.status_code == 200
    assert node_response.headers["cache-control"] == "no-store"
    details = NodeDetails.model_validate(node_response.json())
    assert details.node.id == "n-dateonly"
    assert details.node.publication.timestamp is None

    # The app has only an MCP client endpoint, not repository access.
    assert isinstance(app.state.mcp_client, MCPClient)
    assert app.state.mcp_client.url == mcp_server_process.url
    assert not hasattr(gateway_module, "FixtureRepository")
    assert "fixture_service" not in inspect.getsource(gateway_module)


def test_gateway_unknown_node_is_404_not_found(mcp_server_process) -> None:
    settings = make_settings(mcp_server_process.url)
    app = create_app(settings)
    with TestClient(app, base_url="http://testserver") as client:
        response = client.get(f"{NODE_PATH}/n-does-not-exist")

    assert response.status_code == 404
    assert response.headers["cache-control"] == "no-store"
    envelope = ErrorEnvelope.model_validate(response.json())
    assert envelope.error.code is ErrorCode.NOT_FOUND
    assert envelope.error.retryable is False


def test_gateway_maps_mcp_unavailable_to_503_and_health_stays_up() -> None:
    down_url = f"http://127.0.0.1:{allocate_free_loopback_port()}/mcp"
    settings = make_settings(down_url)
    app = create_app(settings)
    with TestClient(app, base_url="http://testserver") as client:
        response = client.get(GRAPH_PATH)
        health = client.get("/health")

    assert response.status_code == 503
    envelope = ErrorEnvelope.model_validate(response.json())
    assert envelope.error.code is ErrorCode.MCP_UNAVAILABLE
    assert envelope.error.retryable is True
    assert response.headers["cache-control"] == "no-store"

    assert health.status_code == 200
    assert health.json() == {
        "status": "ok",
        "service": "news-trace-gateway",
        "mode": "fixture",
        "fixture": True,
    }


def test_gateway_rejects_invalid_host_and_origin(mcp_server_process) -> None:
    settings = make_settings(mcp_server_process.url)
    app = create_app(settings)
    with TestClient(app, base_url="http://testserver") as client:
        bad_host = client.get(GRAPH_PATH, headers={"host": "evil.example"})
        bad_origin = client.get(
            GRAPH_PATH,
            headers={"origin": "http://evil.example"},
        )
        missing_origin = client.get(GRAPH_PATH)
        vite_proxy = client.get(
            GRAPH_PATH,
            headers={
                "host": "127.0.0.1:5173",
                "origin": "http://127.0.0.1:5173",
            },
        )

    assert bad_host.status_code == 421
    assert ErrorEnvelope.model_validate(bad_host.json()).error.code is ErrorCode.INVALID_REQUEST
    assert bad_host.headers["cache-control"] == "no-store"

    assert bad_origin.status_code == 421
    assert ErrorEnvelope.model_validate(bad_origin.json()).error.code is ErrorCode.INVALID_REQUEST

    assert missing_origin.status_code == 200
    assert vite_proxy.status_code == 200


def test_gateway_live_mode_is_explicitly_unconfigured(mcp_server_process) -> None:
    class ExplodingClient:
        async def get_graph(self, research_id: str):
            raise AssertionError("live mode must not call MCP in this milestone")

    settings = make_settings(mcp_server_process.url, mode="live")
    app = create_app(settings, client=ExplodingClient())
    with TestClient(app, base_url="http://testserver") as client:
        response = client.get(GRAPH_PATH)
        health = client.get("/health")

    assert response.status_code == 503
    envelope = ErrorEnvelope.model_validate(response.json())
    assert envelope.error.code is ErrorCode.PROVIDER_NOT_CONFIGURED
    assert envelope.error.retryable is False
    assert "not implemented" in envelope.error.message.lower()

    assert health.status_code == 200
    assert health.json()["mode"] == "live"
    assert health.json()["fixture"] is False


def test_gateway_malformed_mcp_result_is_safe_500(mcp_server_process) -> None:
    class MalformedClient:
        async def get_graph(self, research_id: str):
            raise MCPInvalidResultError(
                "internal detail that must not reach the browser"
            )

    settings = make_settings(mcp_server_process.url)
    app = create_app(settings, client=MalformedClient())
    with TestClient(app, base_url="http://testserver") as client:
        response = client.get(GRAPH_PATH)

    assert response.status_code == 500
    envelope = ErrorEnvelope.model_validate(response.json())
    assert envelope.error.code is ErrorCode.INTERNAL_ERROR
    assert envelope.error.retryable is False
    assert "internal detail" not in envelope.error.message
    assert response.headers["cache-control"] == "no-store"


def test_gateway_validation_and_unmatched_routes_use_safe_envelopes(
    mcp_server_process,
) -> None:
    settings = make_settings(mcp_server_process.url)
    app = create_app(settings)
    with TestClient(app, base_url="http://testserver") as client:
        long_id = "x" * 201
        overlong_path = client.get(f"/api/v1/research/{long_id}/graph")
        overlong_query = client.get(
            f"{NODE_PATH}/n-seed",
            params={"detail_query": "q" * 1001},
        )
        unmatched = client.get("/api/v1/research/x/nodes/")
        missing_route = client.get("/api/v1/not-a-route")

    for response in (overlong_path, overlong_query, unmatched, missing_route):
        assert "detail" not in response.json()
        assert response.headers["cache-control"] == "no-store"

    assert overlong_path.status_code == 422
    assert (
        ErrorEnvelope.model_validate(overlong_path.json()).error.code
        is ErrorCode.INVALID_REQUEST
    )
    assert overlong_query.status_code == 422
    assert (
        ErrorEnvelope.model_validate(overlong_query.json()).error.code
        is ErrorCode.INVALID_REQUEST
    )
    assert unmatched.status_code == 404
    assert (
        ErrorEnvelope.model_validate(unmatched.json()).error.code
        is ErrorCode.NOT_FOUND
    )
    assert missing_route.status_code == 404
    assert (
        ErrorEnvelope.model_validate(missing_route.json()).error.code
        is ErrorCode.NOT_FOUND
    )


def test_gateway_research_mutations_are_typed_not_implemented_stubs(
    mcp_server_process,
) -> None:
    settings = make_settings(mcp_server_process.url)
    app = create_app(settings)
    with TestClient(app, base_url="http://testserver") as client:
        responses = [
            client.post(
                "/api/v1/research",
                json={
                    "question": "What happened in Riverbend?",
                    "source_url": "https://example.com/riverbend",
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/expand",
                json={
                    "node_id": "n-seed",
                    "graph_revision": 1,
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/questions",
                json={
                    "node_ids": ["n-seed", "n-grassroots"],
                    "graph_revision": 1,
                    "question": "How are these two linked?",
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/discoveries",
                json={
                    "answer_id": "answer-1",
                    "candidate_ids": ["candidate-1", "candidate-2"],
                    "graph_revision": 1,
                    "request_id": REQUEST_ID,
                },
            ),
        ]

    for response in responses:
        assert response.status_code == 503
        assert response.headers["cache-control"] == "no-store"
        envelope = ErrorEnvelope.model_validate(response.json())
        assert envelope.error.code is ErrorCode.PROVIDER_NOT_CONFIGURED
        assert envelope.error.retryable is False
        assert "not implemented" in envelope.error.message.lower()
        assert "fixture mode" not in envelope.error.message.lower()


def test_gateway_job_stubs_never_call_mcp() -> None:
    class ExplodingClient:
        async def get_graph(self, research_id: str):
            raise AssertionError(f"stub called get_graph for {research_id}")

        async def get_node_details(
            self,
            research_id: str,
            node_id: str,
            detail_query: str | None = None,
        ):
            raise AssertionError(
                f"stub called get_node_details for {research_id}/{node_id}"
            )

    settings = make_settings("http://127.0.0.1:1/mcp")
    app = create_app(settings, client=ExplodingClient())
    with TestClient(app, base_url="http://testserver") as client:
        responses = [
            client.post(
                "/api/v1/research",
                json={
                    "question": "What happened in Riverbend?",
                    "source_url": "https://example.com/riverbend",
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/expand",
                json={
                    "node_id": "n-seed",
                    "graph_revision": 1,
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/questions",
                json={
                    "node_ids": ["n-seed", "n-grassroots"],
                    "graph_revision": 1,
                    "question": "How are these two linked?",
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/discoveries",
                json={
                    "answer_id": "answer-1",
                    "candidate_ids": ["candidate-1"],
                    "graph_revision": 1,
                    "request_id": REQUEST_ID,
                },
            ),
            client.get("/api/v1/jobs/job-1"),
            client.post("/api/v1/jobs/job-1/cancel"),
        ]

    assert [response.status_code for response in responses] == [
        503,
        503,
        503,
        503,
        404,
        404,
    ]


def test_gateway_job_routes_report_missing_jobs(mcp_server_process) -> None:
    settings = make_settings(mcp_server_process.url)
    app = create_app(settings)
    with TestClient(app, base_url="http://testserver") as client:
        job_response = client.get("/api/v1/jobs/job-1")
        cursor_response = client.get(
            "/api/v1/jobs/job-1",
            params={"after_event_seq": 7},
        )
        cancel_response = client.post("/api/v1/jobs/job-1/cancel")
        bad_cursor = client.get(
            "/api/v1/jobs/job-1",
            params={"after_event_seq": -1},
        )

    for response in (job_response, cursor_response, cancel_response):
        assert response.status_code == 404
        assert response.headers["cache-control"] == "no-store"
        envelope = ErrorEnvelope.model_validate(response.json())
        assert envelope.error.code is ErrorCode.NOT_FOUND
        assert envelope.error.retryable is False
        assert "job" in envelope.error.message.lower()

    assert bad_cursor.status_code == 422
    assert (
        ErrorEnvelope.model_validate(bad_cursor.json()).error.code
        is ErrorCode.INVALID_REQUEST
    )


def test_gateway_mutation_stubs_reject_invalid_bodies_safely(
    mcp_server_process,
) -> None:
    settings = make_settings(mcp_server_process.url)
    app = create_app(settings)
    valid_start = {
        "question": "What happened in Riverbend?",
        "source_url": "https://example.com/riverbend",
        "request_id": REQUEST_ID,
    }
    with TestClient(app, base_url="http://testserver") as client:
        responses = [
            client.post(
                "/api/v1/research",
                json={**valid_start, "request_id": "not-a-uuid"},
            ),
            client.post(
                "/api/v1/research",
                json={**valid_start, "question": "   "},
            ),
            client.post(
                "/api/v1/research",
                json={**valid_start, "extra_field": True},
            ),
            client.post(
                "/api/v1/research",
                json={
                    **valid_start,
                    "source_url": "https://user:secret@example.com/riverbend",
                },
            ),
            client.post(
                "/api/v1/research",
                json={
                    **valid_start,
                    "source_url": "https://@example.com/riverbend",
                },
            ),
            client.post(
                "/api/v1/research/research-1/questions",
                json={
                    "node_ids": ["n-seed", "n-seed"],
                    "graph_revision": 1,
                    "question": "How are these two linked?",
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/questions",
                json={
                    "node_ids": ["n-seed"],
                    "graph_revision": 1,
                    "question": "How are these two linked?",
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/discoveries",
                json={
                    "answer_id": "answer-1",
                    "candidate_ids": [],
                    "graph_revision": 1,
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/expand",
                json={
                    "node_id": "n-seed",
                    "graph_revision": 0,
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/expand",
                json={
                    "node_id": "n-seed",
                    "graph_revision": True,
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/questions",
                json={
                    "node_ids": ["n-seed", "n-grassroots"],
                    "graph_revision": "1",
                    "question": "How are these two linked?",
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                "/api/v1/research/research-1/discoveries",
                json={
                    "answer_id": "answer-1",
                    "candidate_ids": ["candidate-1"],
                    "graph_revision": True,
                    "request_id": REQUEST_ID,
                },
            ),
            client.post(
                f"/api/v1/research/{'x' * 201}/expand",
                json={
                    "node_id": "n-seed",
                    "graph_revision": 1,
                    "request_id": REQUEST_ID,
                },
            ),
            client.get(f"/api/v1/jobs/{'x' * 201}"),
        ]

    for response in responses:
        assert response.status_code == 422
        assert response.headers["cache-control"] == "no-store"
        body = response.json()
        assert "detail" not in body
        envelope = ErrorEnvelope.model_validate(body)
        assert envelope.error.code is ErrorCode.INVALID_REQUEST
        assert envelope.error.retryable is False
        assert envelope.error.message == "The request parameters are invalid."


def test_gateway_allows_preview_origin_4173(mcp_server_process) -> None:
    settings = make_settings(mcp_server_process.url)
    app = create_app(settings)
    with TestClient(app, base_url=PREVIEW_ORIGIN) as client:
        response = client.get(
            GRAPH_PATH,
            headers={
                "host": PREVIEW_HOST,
                "origin": PREVIEW_ORIGIN,
            },
        )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    graph = GraphResult.model_validate(response.json())
    assert graph.research_id == "fixture-riverbend"


def test_settings_default_origins_include_preview_port(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("NEWS_TRACE_ALLOWED_ORIGINS", raising=False)
    settings = Settings.from_env()

    assert "http://127.0.0.1:4173" in settings.allowed_origins
    assert "http://localhost:4173" in settings.allowed_origins
