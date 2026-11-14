# Architecture — News Trace first milestone

**Milestone:** fixture-backed chronological explorer
**Status:** read-only fixture slice; live discovery, jobs, and two-node questions are pending
**Date:** November 14, 2026

## Scope

This milestone proves the read path end to end:

```text
Browser (React/Vite)
  -> GET /api/v1/... (same-origin Vite proxy)
  -> FastAPI gateway
  -> official MCP SDK client
  -> official MCP SDK server over Streamable HTTP
  -> FixtureRepository
  -> deterministic chronological projection
```

The browser never talks to MCP directly, the gateway never imports fixture data directly, and no live search,
page fetch, LLM call, or graph mutation is presented as working. Fixture mode is explicit and visibly labeled.

## Module boundaries

| Path | Responsibility |
|---|---|
| `backend/src/news_trace/models.py` | Authoritative Pydantic DTOs: publication precision, source nodes, evidence, relationships, origin assessment, tree edges, `GraphResult`, `NodeDetails`, error envelopes |
| `backend/src/news_trace/projection.py` | Pure, deterministic chronology/origin/tree projection; no transport or renderer knowledge |
| `backend/src/news_trace/fixtures.py` | Fixture document schema and validation |
| `backend/src/news_trace/fixture_service.py` | Read-only fixture repository and expansion-stage projection for tests |
| `backend/src/news_trace/mcp_server.py` | Official-SDK MCP server exposing `get_research_graph` and `get_node_details` over Streamable HTTP |
| `backend/src/news_trace/mcp_client.py` | Official-SDK MCP client, structured-output validation, typed transport/tool errors |
| `backend/src/news_trace/gateway.py` | FastAPI read routes, error mapping, Host/Origin checks, loopback startup |
| `backend/src/news_trace/config.py` | Environment configuration and loopback defaults |
| `apps/web/src/api/` | Typed gateway client and response validation |
| `apps/web/src/generated/` | Generated TypeScript DTOs (committed, never hand-edited) |
| `apps/web/src/components/` | Explorer UI; no transport logic in renderers |
| `fixtures/riverbend_fixture.json` | Deterministic synthetic 16-node initial graph plus expanded-stage case |
| `contracts/generated/news_graph.schema.json` | Generated JSON Schema from the authoritative Pydantic models |

## Dependency versions

Versions are pinned in `backend/pyproject.toml`, `backend/uv.lock`, and `apps/web/package-lock.json`.

| Component | Version |
|---|---|
| MCP Python SDK | 2.3.0 (`mcp.server.mcpserver.MCPServer`, high-level `mcp.Client`) |
| FastAPI / Pydantic / Uvicorn | 0.163.0 / 2.14.3 / 0.54.0 |
| React / Vite / TypeScript | 19.3.1 / 8.3.8 / 5.9.3 |
| Cytoscape.js | 3.35.0 |
| Test stack | pytest 9.2.0, Vitest 5.1.0, Testing Library 16.3.3 |
| Python / Node used for verification | Python 3.14.7 / Node 24.22.1 |

The SDK was inspected against the installed 2.3.0 package before implementation. The v1 `FastMCP` import is not
used; 2.3.0 renamed it to `MCPServer`. Transport and tool discovery are exercised by tests over a real local HTTP
port, not an in-process shortcut.

## Shared schema generation

The backend Pydantic models are authoritative.

```text
backend/src/news_trace/models.py
  -> python scripts/generate_contracts.py
  -> contracts/generated/news_graph.schema.json
  -> npm --prefix apps/web run generate:types
  -> apps/web/src/generated/newsTraceContracts.ts
```

`scripts/generate_contracts.py --check` fails when the committed schema is stale. The generated TypeScript file is
committed so the frontend build does not require Python, but it must be regenerated whenever the shared models
change. Do not add handwritten DTO copies.

## Chronology and origin decisions

- `seed_node_id` and `root_node_id` are independent. The submitted URL is a discovery seed; the root is the
  earliest adequately supported relevant candidate.
- Origin eligibility is an explicit discovery-layer decision. Old generic background pages, inaccessible sources,
  snippet-only sources, and undated sources are not automatically origin candidates.
- Only fully normalized timestamps with an explicit timezone enter the dated tree axis. Date-only, timezone-unknown,
  and unknown-publication-time sources are listed in a separate unplaced/time-uncertain lane. Midnight UTC is never
  invented.
- Origin eligibility also constrains tree placement. A known-date page older than the resolved origin that was not
  eligible as origin evidence remains inspectable but is not used as a display ancestor; it is listed in the
  unplaced context lane. An unresolved origin emits no dated tree edges at all.
- Date-only origin candidates are compared using a conservative UTC-spanning interval (UTC+14 start through UTC-12
  end), so a date-only value is not declared later merely because its local calendar date matches the timestamp's
  local date. Only the earliest date-only candidate date(s) are named.
- Equal timestamps share one vertical time band. The stable ID order is a tie-break only, and the connector between
  tied nodes is labeled “Same published time (tie-break)” rather than claimed precedence.
- Equal earliest candidates, or date-only candidates overlapping the earliest instant, produce a `provisional`
  origin with a visible candidate list and a stable display anchor.
- A provisional origin is shown in a visible banner with its candidate sources; a date-only root is explicitly
  described as a display anchor rather than a precise first source.
- With no defensible chronology, `root_node_id` is `null`, status is `unresolved`, and the nodes remain unplaced.
  The seed is never relabeled as the origin to fill the gap.
- Tree placement prefers a supported trace relationship (`links_to`, `references`, `replies_to`, `reposts`,
  `follows_up`) to an earlier node, then the closest preceding publication time, then stable IDs. Without one, the
  node receives a visibly distinct `chronological_only` placement connector with no claimed provenance.
- Factual relationship direction is stored independently of display parent/child direction. Backward links and
  cycles remain cross-links; they are never recursively expanded into a fake tree.
- `related_topic` and `same_event` are not used as traced tree parents. Inferred relevance cannot masquerade as a
  citation or influence edge.
- Adding earlier evidence increments `graph_revision`, changes the root, emits an origin-change warning, and keeps
  node IDs stable. The fixture's expanded stage demonstrates the April agenda reroot without reusing IDs.

### Fixture chronology cases

The initial fixture contains 16 sources across posts, news, and webpages. It covers:

| Case | Fixture evidence |
|---|---|
| Seed newer than origin | submitted `n-seed` (June 18) vs root `n-grassroots` (May 10) |
| Earlier source discovered later | expanded stage adds `n-agenda` (April 28), rerooting with revision 2 |
| Equal timestamps | `n-hearing-live` and `n-hearing-notes` share June 2, 19:00 |
| Date-only | `n-dateonly` (May 30), time-uncertain lane |
| Local time without timezone | `n-local` preserves raw "June 2, 2026 7:00 PM" and unknown timezone |
| Missing date | `n-undated`, snippet-only, time-uncertain lane |
| Unavailable source | `n-blocked`, no fabricated content |
| Multiple sources cite one item | `n-seed` and `n-utility` both reference `n-minutes` |
| Multiple parents | `n-regulators` references `n-minutes` and `n-utility` |
| Link cycle | `n-forum-a` ↔ `n-forum-b` |
| Duplicate text, distinct publishers | `n-synd-a` and `n-synd-b` share text/hash but remain separate publishers |

## Fixture-mode security

- MCP server, gateway, and Vite dev server bind to `127.0.0.1` by default.
- The MCP transport enables DNS-rebinding protection with explicit Host/Origin allow-lists.
- The gateway rejects unapproved Host/Origin values with a safe 421 response.
- No credentials are required or committed. `.env.example` contains only safe local placeholders.
- Fixture mode is explicit: `NEWS_TRACE_MODE=fixture` must be configured for the backend services. Without it, the
  gateway reports `PROVIDER_NOT_CONFIGURED` and the MCP server refuses to start rather than silently serving
  synthetic data.
- The browser receives only gateway responses; MCP and provider credentials never reach it.
- The fixture badge and health mode make the synthetic state visible. Live mode fails explicitly instead of
  silently falling back to fixtures.
- Source text is rendered as React text, not HTML. External links use `rel="noreferrer noopener"`.

## Known limitations / next milestone

- No live search-provider or page-fetch adapter; no SSRF/enforcing-egress implementation yet.
- No PostgreSQL persistence, Celery/Redis jobs, cancellation, or graph mutation.
- No node expansion UI/job; the expanded projection exists only as a tested fixture stage.
- No LLM orchestration, two-node question execution, citations, or additional-findings flow.
- No production authentication/ownership model.
- The 500-node/1,500-relationship interactive cap has model limits and explicit node truncation checks, but no
  performance benchmark or full graph-cap UI yet. Relationship-cap overflow raises an explicit projection error
  instead of being silently truncated.
- `TreeEdge.discovery_depth` currently records display-tree depth in the fixture projection; discovery provenance
  will supply the real value when durable jobs exist.
- MCP tool argument schemas rely on the official SDK's generated model; unknown extra keys are ignored by the SDK
  rather than rejected. Typed fields and length limits are still enforced, and the behavior is listed as a known
  first-milestone limitation.
- Some fixture documents link to pages published later in time; these are intentional synthetic cases for
  preserving factual direction and cycles independently of display chronology, not claims that the link existed at
  first publication time.
- Accessibility and responsive behavior are implemented for the read/selection slice; the full research-and-question
  journey is still to be tested.

The next milestone is durable research jobs: persisted discovery, live adapters, expansion, and rerooting through
jobs, followed by bounded two-node LLM/MCP question answering.
