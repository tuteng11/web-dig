# Implementation status — first milestone

**Milestone:** repository foundation, shared schemas, deterministic chronological projection, and a
fixture-backed MCP read path.
**Date:** November 14, 2026
**Important:** This is a foundation milestone. It does not satisfy the release-level live-discovery, expansion,
LLM-question, citation, or production-access acceptance gates. “Passed” below means demonstrated for the fixture
slice only, unless explicitly marked otherwise.

## Implemented surface

- Authoritative Pydantic models for source nodes, publication precision/timezone uncertainty, evidence,
  relationships, origin assessment, tree placement, `GraphResult`, `NodeDetails`, and safe errors.
- Reproducible JSON Schema and generated frontend TypeScript contracts.
- Deterministic chronological projection with traced vs chronological-only edges, provisional/unresolved origins,
  uncertainty preservation, cycle/cross-link handling, stable IDs, and explicit truncation.
- Synthetic 16-node fixture across posts/news/webpages plus an expanded stage with an earlier discovered source.
- Real official-SDK MCP server over Streamable HTTP with `get_research_graph` and `get_node_details`.
- FastAPI gateway read routes that call MCP through the official SDK client; no direct in-process data shortcut.
- React/Vite fixture explorer loading through the gateway: chronological tree and accessible outline, honest
  publication labels, submitted-source/root badges, cross-links, node detail panel, and exactly-two-node selection.
- Explicit fixture badge, loopback bindings, Host/Origin validation, and honest MCP-unavailable/live-mode errors.

## Frontend acceptance mapping

| ID | Status | Evidence / gap |
|---|---|---|
| FE-01 | Partial | Fixture graph loads from the gateway, which reaches the real MCP server. Live question/source submission is intentionally unavailable. |
| FE-02 | Partial (fixture) | Publication formatter and detail panel distinguish timestamp, date-only, unknown timezone, unknown time, and retrieval time. Covered by frontend tests; live extraction not present. |
| FE-03 | Partial | Projection tests cover seed-newer-than-origin, ties in a shared time band, date-only/UTC-boundary uncertainty, cycles, multiple parents, older non-origin context that is not used as a display ancestor, and an earlier source rerooting revision 2 with stable IDs. The UI shows provisional alternatives and a display-anchor note. A user-triggered expansion/reroot job is not wired. |
| FE-04 | Partial | Relationship kind/method/direction and traced vs chronological-only placement are visible; factual backward/cycle links remain cross-links. Tree edges are validated against relationship endpoints and trace kinds. No live link extraction or full edge-style acceptance run. |
| FE-05 | Passed (fixture UI) | Source-list/keyboard-reachable controls implement exactly-two-node selection with A/B slots, clear/swap, same-node rejection, and an explicit third-node replacement choice. Covered by frontend tests and the real-browser smoke. |
| FE-06 | Pending | No question jobs, pair pinning, or answer attribution. |
| FE-07 | Pending | No LLM orchestration, tool activity, citations, or answer panel. |
| FE-08 | Pending | No additional-discoveries review/add flow. |
| FE-09 | Partial | Tree controls (zoom/pan/fit/root focus), accessible outline/list, search/filter, cross-link overlay, and time-uncertain lane exist for the read slice. Collapse/expand subtrees, context ancestors, and the full 500-node cap UI are pending. |
| FE-10 | Pending | No mutations, polling, job resume, or duplicate-submit behavior to verify. |
| FE-11 | Partial | Loading, malformed response, typed 422/404 gateway envelopes, MCP unavailable, source unavailable, date uncertainty, provisional origin, and live-mode-unavailable states exist. Cancellation, provider failure, insufficient evidence, and access errors are pending. |
| FE-12 | Partial | No keys, no raw HTML execution, no fabricated nodes/dates/citations in the fixture slice. Full release security and citation gates remain. |
| FE-13 | Partial | Responsive Tree/Sources/Ask layout and accessible outline/buttons exist; the complete research-and-question journey is not implemented. |
| FE-14 | Pending | No 500-node/1,500-edge benchmark or documented test hardware measurement. |
| FE-15 | Pending | Requires live discovery and a configured LLM; unavailable credentials remain an explicit release gate. |

## Backend acceptance mapping

| ID | Status | Evidence / gap |
|---|---|---|
| BE-01 | Partial | Fixture discovery is served and projected through real MCP over Streamable HTTP. Live search/fetch discovery is not implemented. |
| BE-02 | Passed (fixture) | Model and projection tests preserve timestamp/date/timezone/raw/retrieval provenance; date-only never becomes midnight UTC. |
| BE-03 | Partial | Fixture links, references, reposts, replies, same-event, follow-up, and inferred topic relationships are distinct; snippets remain provisional. No live extraction/classification. |
| BE-04 | Passed (fixture projection) | Tests cover a newer seed, an earlier discovered source, ties in a shared band, unknown/date-only dates including UTC-boundary uncertainty, older non-eligible context excluded from display ancestry, backward links, cycles, unresolved origins with no tree edges, and stable IDs. Expansion is not yet a durable job/UI flow. |
| BE-05 | Pending | No question job exists to authorize/pin two nodes and reject stale revisions. |
| BE-06 | Pending | No LLM/MCP detail-call orchestration. |
| BE-07 | Pending | No bounded search/fetch during questions. |
| BE-08 | Pending | No additional-findings mutation flow. |
| BE-09 | Partial | Model validators reject invented normalized timestamps, invalid evidence, unsupported relationship direction, tree edges that cite unrelated/non-trace relationships, and malformed graph/tree references. No LLM output/citation validator yet. |
| BE-10 | Partial | Fixture covers missing dates, unavailable content, snippet-only evidence, and duplicate syndication. Search-provider partial failure/no-results cases are pending. |
| BE-11 | Pending | No tool loop/budget implementation. |
| BE-12 | Partial | Loopback binding, Host/Origin validation, and MCP DNS-rebinding protection exist. SSRF/DNS-rebinding egress tests are not applicable until live fetch exists. |
| BE-13 | Pending | No broker, worker, replay, cancellation, or expiry semantics. |
| BE-14 | Passed (read tools) | Official SDK discovery and tool calls succeed over a real local Streamable HTTP port; gateway uses the SDK client and does not bypass MCP. |
| BE-15 | Pending | Live discovery plus a tool-assisted two-node question require provider credentials. |

## Fixture coverage

`fixtures/riverbend_fixture.json` contains 16 initial sources (17 including the expanded-only agenda) across
`post`, `news`, and `webpage`. It includes the required seed-newer-than-origin, earlier-on-expansion, tie,
date-only, timezone-unknown, undated, unavailable, multiple-citation, multiple-parent, cycle, and duplicate-text
cases. The duplicate publishers retain distinct IDs, domains, and snapshots even when text and content hash match.

The fixture is synthetic and reserved for explicit fixture mode. It is not a live discovery result, and the UI
shows a persistent synthetic-demo badge.

## Verification log

Run on Windows with Python 3.14.7, Node 24.22.1, uv 0.13.8, and Microsoft Edge through Playwright 1.65.1.
The convenience runner was executed from the repository root:

```text
backend\.venv\Scripts\python.exe scripts\check.py
```

| Check | Command | Outcome |
|---|---|---|
| Shared schema freshness | `python scripts/generate_contracts.py --check` | **Passed** — committed JSON Schema matches the Pydantic models |
| Generated frontend types current | `npm --prefix apps/web run generate:types` (bytes compared before/after) | **Passed** — no stale generated TypeScript |
| Backend models/projection/fixture tests | `pytest -q` (via the runner) | **Passed** — 57 tests |
| MCP integration over Streamable HTTP | included in the backend suite | **Passed** — real SDK client/server, two-tool discovery, typed graph/node output, typed `NOT_FOUND`, Host rejection |
| Gateway read/error paths | included in the backend suite | **Passed** — real MCP subprocess, graph/node 200s, 404, 503 `MCP_UNAVAILABLE`, 421 Host/Origin, typed 422/404 envelopes, live-mode 503, health independent of MCP |
| Frontend tests | `npm --prefix apps/web test` | **Passed** — 48 tests in 5 files |
| Frontend typecheck | `npm --prefix apps/web run typecheck` | **Passed** |
| Frontend production build | `npm --prefix apps/web run build` | **Passed** — 34 modules; non-fatal 730 kB chunk-size warning from Cytoscape |
| Real-browser fixture smoke | `npm --prefix apps/web run smoke:browser` with backend + Vite running | **Passed** — synthetic badge, source list, root/seed badges, time-uncertain lane, detail fetch, A/B selection tray, disabled question action |
| Startup/health | `uv run --project backend python scripts/run_fixture.py` | **Passed** — health `{"status":"ok","service":"news-trace-gateway","mode":"fixture","fixture":true}`; gateway graph returned root `n-grassroots`, seed `n-seed`, 16 nodes; `n-dateonly` returned `timestamp=null`, `timezone_status=unknown` |

The browser smoke screenshot was written to the system temp directory; the exact screenshot is not committed.

## Known limitations

- No live search provider, page fetcher, extraction pipeline, or LLM adapter.
- No PostgreSQL/Celery/Redis jobs or persistence.
- No expansion, question, citation, or additional-discovery features.
- No production authentication/ownership/CSRF model; local services are loopback-only.
- The expanded-stage reroot is proven in projection tests, not exposed as a user-triggered UI flow.
- Only the documented fixture research id is available.
- `detail_query` is accepted and length-capped but does not yet filter fixture evidence.
- The full 500-node/1,500-edge interaction and performance acceptance is not measured.
- Relationship-cap overflow raises an explicit projection error rather than fabricating a truncated relationship set.
- `TreeEdge.discovery_depth` currently records display-tree depth in the fixture projection; durable discovery jobs
  will supply real provenance.
- The MCP Python SDK's generated tool input schema does not advertise `additionalProperties: false`; the server still validates typed fields and limits, but unknown tool input keys are ignored by the SDK argument model.
- Some fixture links point to later-published documents by design, to exercise factual direction and cycles without
  claiming first-publication provenance. `updated_at` is null for the synthetic sources.
- A fresh MCP session is opened per gateway read; this is acceptable at fixture scale but should be pooled or job-scoped later.
- The frontend bundle includes Cytoscape in the main chunk; code-splitting is a follow-up.
