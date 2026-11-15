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

## New Traceback frontend read-path wiring

- The new `frontend/` UI loads its default synthetic demo graph and node details through the real
  gateway → MCP → fixture read path.
- `VITE_DEMO_TRANSPORT=bundled` (or `?demo=1&transport=bundled`) keeps the complete local synthetic
  expansion/question/citation/additional-discovery simulation with zero backend requests.
- The demo transport is persisted in the URL, and a gateway failure never falls back silently to
  bundled data.
- Backend discovery/job/expansion/question/additional-discovery routes are explicit typed
  `503 PROVIDER_NOT_CONFIGURED` stubs; unknown jobs return `404`. No fake jobs or answers are
  produced.
- Job polling treats `after_event_seq` as exclusive and advances using the highest sequence
  actually received; `next_event_seq` remains the server's next allocation and is never used as a
  cursor.
- Start/question/expand/additional-discovery submissions take a synchronous gate, expose pending
  state before awaiting, memoize a request ID per exact payload for explicit retries, and discard
  responses from a superseded session.
- URL-resumed jobs are checked against the active research id in both the boot path and
  job-completion handling; mismatches are ignored without changing the graph or answers.
- Graph loads capture the session epoch and cannot write a stale graph, session, or error after a
  new research starts; starting live research aborts an in-flight graph load.
- Job envelopes are checked against the requested kind, research id, request id, and (for
  cancellation) job id before being installed, settled, or treated as a successful cancellation.
  Mismatches surface a safe `MALFORMED_RESPONSE` and leave the active job/polling intact.

## Frontend acceptance mapping

| ID | Status | Evidence / gap |
|---|---|---|
| FE-01 | Partial (gateway read path wired) | The new frontend default demo loads graph and node details from the gateway, which reaches the real MCP server. Live discovery `POST /research` is a typed 503 stub. |
| FE-02 | Partial (fixture) | Publication formatter and detail panel distinguish timestamp, date-only, unknown timezone, unknown time, and retrieval time. Covered by frontend tests; live extraction not present. |
| FE-03 | Partial | Projection tests cover seed-newer-than-origin, ties in a shared time band, date-only/UTC-boundary uncertainty, cycles, multiple parents, older non-origin context that is not used as a display ancestor, and an earlier source rerooting revision 2 with stable IDs. The bundled demo shows the reroot and notice; the gateway demo serves revision 1 only. No backend expansion job. |
| FE-04 | Partial | Relationship kind/method/direction and traced vs chronological-only placement are visible; factual backward/cycle links remain cross-links. Tree edges are validated against relationship endpoints and trace kinds. No live link extraction or full edge-style acceptance run. |
| FE-05 | Passed (fixture UI) | Source-list/keyboard-reachable controls implement exactly-two-node selection with A/B slots, clear/swap, same-node rejection, and an explicit third-node replacement choice. Covered by frontend tests and the real-browser smoke. |
| FE-06 | Bundled demo implemented; backend pending | Pair pinning, graph-revision pinning, and answer attribution exist in the bundled synthetic flow. Gateway question jobs return typed 503. |
| FE-07 | Bundled demo implemented; live pending | Activity events, statements, citation markers, limitations, and citation drawer are implemented for synthetic answers. No LLM/MCP orchestration exists. |
| FE-08 | Bundled demo implemented; backend pending | Additional discoveries stay separate until explicit “Add to tree” in the bundled demo. Gateway discovery mutation returns typed 503. |
| FE-09 | Implemented (new UI) | Tree controls, accessible outline/list, search/filter, collapse/expand, context ancestors, cross-links, time-uncertain lane, and 100/500/1,500 caps exist. Performance acceptance remains pending. |
| FE-10 | Bundled demo implemented; live auth pending | Client route state, polling, cancellation, synchronous duplicate-submit gate, per-payload retry request IDs, and resumed-job research-id checks exist. Pre-graph discovery-job resume and server ownership/authentication remain backend work. |
| FE-11 | Implemented (new UI) | Loading, malformed response, typed gateway envelopes, MCP unavailable, source unavailable, date uncertainty, provisional origin, cancellation, provider failure, insufficient evidence, and live-mode-unavailable states exist. |
| FE-12 | Partial | No keys, no raw HTML execution, no fabricated nodes/dates/citations in the fixture slice. Full release security and citation gates remain. |
| FE-13 | Implemented (new UI) | Responsive Tree/Sources/Ask layout, keyboard-operable outline/buttons, and mobile state preservation are covered by browser smokes. |
| FE-14 | Pending | No 500-node/1,500-edge benchmark or documented test hardware measurement. |
| FE-15 | Pending | Requires live discovery and a configured LLM; unavailable credentials remain an explicit release gate. |

## Backend acceptance mapping

| ID | Status | Evidence / gap |
|---|---|---|
| BE-01 | Partial | Fixture discovery is served and projected through real MCP over Streamable HTTP. Live search/fetch discovery is not implemented. |
| BE-02 | Passed (fixture) | Model and projection tests preserve timestamp/date/timezone/raw/retrieval provenance; date-only never becomes midnight UTC. |
| BE-03 | Partial | Fixture links, references, reposts, replies, same-event, follow-up, and inferred topic relationships are distinct; snippets remain provisional. No live extraction/classification. |
| BE-04 | Passed (fixture projection) | Tests cover a newer seed, an earlier discovered source, ties in a shared band, unknown/date-only dates including UTC-boundary uncertainty, older non-eligible context excluded from display ancestry, backward links, cycles, unresolved origins with no tree edges, and stable IDs. Expansion is simulated in the bundled demo but is not yet a durable backend job. |
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
| Generated legacy frontend types current | `npm --prefix apps/web run generate:types` (bytes compared before/after) | **Passed** — no stale generated TypeScript |
| New frontend shared DTOs current | `npm --prefix frontend run check:contracts` | **Passed** — frontend/src/contracts/newsTrace.ts matches the generated legacy file |
| Backend models/projection/fixture/stub tests | `pytest -q` (via the runner) | **Passed** — 63 tests |
| MCP integration over Streamable HTTP | included in the backend suite | **Passed** — real SDK client/server, two-tool discovery, typed graph/node output, typed `NOT_FOUND`, Host rejection |
| Gateway read/error paths | included in the backend suite | **Passed** — real MCP subprocess, graph/node 200s, 404, 503 `MCP_UNAVAILABLE`, 421 Host/Origin, typed 422/404 envelopes, live-mode 503, health independent of MCP |
| Gateway job-route stubs | included in the backend suite | **Passed** — 503 `PROVIDER_NOT_CONFIGURED` for discovery/expand/question/discoveries, 404 for jobs/cancel, 422 for invalid bodies including empty userinfo and non-integer revisions, and an injected exploding MCP client proving no MCP calls or fake jobs |
| Preview-origin access | included in the backend suite | **Passed** — Host/Origin `127.0.0.1:4173` returns the graph; evil origins still 421 |
| Legacy frontend tests | `npm --prefix apps/web test` | **Passed** — 48 tests in 5 files |
| Legacy frontend typecheck | `npm --prefix apps/web run typecheck` | **Passed** |
| Legacy frontend production build | `npm --prefix apps/web run build` | **Passed** — 34 modules; non-fatal 732 kB chunk-size warning from Cytoscape |
| New frontend tests | `npm --prefix frontend test` | **Passed** — 65 tests in 10 files, including 11 transport-precedence, 5 job-event-cursor, 9 submission/idempotency, and 6 job-response-identity tests |
| New frontend typecheck | `npm --prefix frontend run typecheck` | **Passed** |
| New frontend production build | `npm --prefix frontend run build` | **Passed** — non-fatal 745 kB chunk-size warning; post-build guard confirms no unresolved `import.meta.env` values |
| Job event cursor semantics | `npm --prefix frontend test -- src/hooks/useJobPolling.test.ts` | **Passed** — 5 tests prove the exclusive cursor is the highest received seq, not `next_event_seq`; stale/empty responses cannot move it backwards |
| Submission gate and retry IDs | `npm --prefix frontend test -- src/domain/mutationGate.test.ts` | **Passed** — 9 tests cover synchronous locking, stale-token release, per-signature UUID reuse, settle, clear, and signature stability |
| Job response identity | `npm --prefix frontend test -- src/domain/jobResponses.test.ts` | **Passed** — 6 tests cover kind, research, request-id, and job-id mismatches plus omitted optional checks |
| Production env injection | `node scripts/check-build-env.mjs` (run by the build) | **Passed** — direct `import.meta.env.VITE_*` reads are statically replaced; configured transport/mode values are not dropped |
| New frontend bundled smoke | `npm --prefix frontend run smoke:browser` with preview on 4173 | **Passed** — full offline question/citation/additional-discovery/revision-2/reload flow; asserted zero `/api/v1` requests |
| New frontend gateway smoke | `npm --prefix frontend run smoke:browser:gateway` with backend on 8000 and preview on 4173 | **Passed** — graph and node-detail reads crossed `/api/v1/research/...`; transport persisted across reload; expand/question returned typed 503 without an answer or revision change; revision-2 links showed the gateway limitation; non-fixture IDs ignored bundled transport; an injected graph 503 rendered the error card with zero bundled sources |
| Startup/health | `backend\.venv\Scripts\python.exe scripts\run_fixture.py` | **Passed** — health `{"status":"ok","service":"news-trace-gateway","mode":"fixture","fixture":true}`; gateway graph returned root `n-grassroots`, seed `n-seed`, 16 nodes; `n-dateonly` returned `timestamp=null`, `timezone_status=unknown` |

The browser smoke screenshot was written to the system temp directory; the exact screenshot is not committed.

## Known limitations

- No live search provider, page fetcher, extraction pipeline, or LLM adapter.
- No PostgreSQL/Celery/Redis jobs or persistence.
- No backend expansion, question, citation, or additional-discovery jobs. The bundled demo simulates these
  client-side; the gateway job routes are explicit typed stubs.
- No production authentication/ownership/CSRF model; local services are loopback-only. The client
  rejects a resumed job whose research id does not match, but the backend must enforce ownership
  independently once job routes exist.
- Resuming a discovery job before its graph exists is not implemented; the pre-graph boot flow
  belongs to the backend job milestone.
- In-flight mutation requests are discarded by session epoch on replacement rather than aborted.
- App-level lifecycle guards are covered by pure helper tests, typechecking, and browser smokes, but
  the frontend package has no component/DOM test harness for deferred cancellation, finalization,
  or boot-resume promises.
- A boot URL job discarded because another submission was already in flight is not retried
  automatically; reloading the URL retries it.
- The expanded-stage reroot is proven in projection tests and the bundled demo; it is not exposed as a
  user-triggered backend job.
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
- Both frontends currently ship their graph renderer in the main chunk; code-splitting is a follow-up.
