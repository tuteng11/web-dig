# Related-Source Discovery and Two-Node Q&A — MCP Agent Contract

**Version:** 2.1  
**Date:** November 14, 2026  
**Companion:** News_Graph_Implementation_Contract.md, version 2.1  
**Audience:** Agent implementing backend, gateway, MCP tools, and LLM orchestration

## 1. Authoritative scope

Implement the missing backend for a website that accepts a research question and a source URL, finds related posts/news/webpages, and returns source metadata plus relationships for a tree UI. Users select two nodes and ask the LLM a question. The LLM can call MCP tools for specific details and additional source discovery before answering.

This replaces version 1.0 in full: the single-page-only restriction and prohibition on LLM tool calls no longer apply. MCP is the constrained research interface; it is not itself a search engine or an LLM. Implement search/fetch adapters behind it and a server-side LLM orchestrator that actually invokes its tools.

Required in MVP: related-content discovery, persisted graph with tree projection, dates/times/sources, two-node questions, iterative MCP detail lookup, and grounded citations. No existing backend is assumed.

MUST denotes acceptance requirements. Defaults below are configurable, documented limits. Public account registration, paywall bypass, unrestricted agents, unlimited crawling, and public OAuth-discoverable MCP hosting are outside scope.

## 2. Architecture and responsibilities

Browser → authenticated website gateway → MCP client/server → research service, database, and workers.

For node questions, the gateway dispatches a server-side LLM orchestrator. That orchestrator is also an MCP client: it supplies the selected node context, invokes allowed data tools requested by the model, returns tool results to the model, and validates the final answer.

Use React/TypeScript on the frontend, FastAPI/Pydantic for gateway/service contracts, official MCP SDKs over Streamable HTTP, PostgreSQL for durable state, and Celery/Redis for workers. Start with HTTP retrieval and Trafilatura; isolate search, fetch, extraction, and LLM providers behind adapters. Browser rendering is optional and must obey the same egress controls.

The research service may share a process with the MCP server. No unnecessary internal HTTP layer is required. Use real SDK protocol handling and negotiated versions. Pin compatible releases; do not invent MCP methods or implement a REST endpoint that merely claims to be MCP.

## 3. Discovery meaning and pipeline

“Linked/related” includes:
1. A source directly hyperlinks to another source.
2. A source explicitly references, quotes, replies to, or reposts another.
3. Sources report the same event or a follow-up.
4. Sources are semantically relevant to the research question/seed, labeled as inferred related content.

These are different evidence classes. A search engine match alone does not establish a direct hyperlink, citation, reply, or repost relationship. Inbound coverage is provider-dependent and never guaranteed exhaustive.

Pipeline:
- Validate and fetch the submitted seed; extract immutable canonical text and metadata.
- Collect eligible outbound links, excluding navigation, tracking, login, and irrelevant boilerplate.
- Query a configured web/news search adapter using the question, seed title, distinctive phrases, entities, and known URL references.
- Use supported platform APIs/adapters for public posts when available. An inaccessible post remains unavailable/snippet-only; do not invent content.
- Fetch bounded candidates, extract metadata, deduplicate identities, and classify relevance/linkage against evidence.
- Trace cited originals, distinctive quotes, and earlier coverage within search budgets; choose the earliest relevant evidence found, then persist a chronological tree projection. Do not treat the submitted URL as the origin by default.
- Return partial results when some sources fail, with per-item status and coverage warnings.

Require one real search-provider adapter and one real page-fetch adapter plus deterministic fixtures. Support keyword queries, optional domains/date range, and pagination in the search adapter. Do not depend on scraping a search engine results page as the only implementation. Choose/configure an actual provider and document its supported filters, availability, and quota; no guessed URLs or fabricated provider results.

Default initial limits: 20 accepted related nodes, 3 search queries, 30 candidate fetches, discovery depth 1. User-requested expansion adds at most 10 nodes and one level per job, with a default maximum depth of 3. Apply relevance thresholds and global research caps; stop cleanly when budgets expire. Zero eligible results is valid.

## 4. Canonical data contracts

Generate strict shared schemas from backend models. IDs are opaque strings. Reject unknown input fields. Timestamps use RFC 3339 with explicit offsets where available; null means unknown.

### 4.1 Source node

Every node contains:
- id, research_id, content_kind: post | news | webpage.
- requested_url, canonical_url, title nullable, author nullable.
- source: {name nullable, domain, platform nullable}.
- publication: {timestamp nullable, date nullable, raw nullable, precision: timestamp | date | unknown, timezone_status: known | unknown, evidence_id nullable}.
- updated_at nullable; retrieved_at required; discovered_at required.
- content_status: full_text | excerpt | snippet_only | unavailable.
- excerpt nullable, snapshot_id nullable, content_hash nullable, warnings[].

A date-only value uses YYYY-MM-DD and timestamp=null. An explicit timezone is required for a normalized timestamp. If source text contains a local time without timezone, preserve raw/date, mark timezone unknown, and do not invent UTC. Publication metadata must carry its extraction provenance. Search-provider dates remain labeled provider-reported; relative timestamps with unresolved meaning stay raw/unknown. Retrieval time is never publication time.

### 4.2 Relationship

Fields: id, from_node_id, to_node_id, kind, directed, method, explanation, evidence_ids[], score nullable, status, created_at.

Kinds:
- links_to: directed from linking page to linked page; require verified link target and originating snapshot/location.
- references: directed from referencing item to referenced item; require supported reference evidence.
- replies_to / reposts: directed from reply/repost to original; require platform metadata or explicit source evidence.
- same_event: undirected; supported event identity in both sources.
- follows_up: directed newer development → earlier reporting; require supported continuity and chronology.
- related_topic: undirected inferred relevance; never presented as direct linkage.

method is source_link | platform_metadata | llm_inference. status is validated | provisional. Semantic relationships require evidence from both endpoints; snippet-only relationships remain provisional and visibly labeled. Scores, if used, are uncalibrated relevance scores, not truth probabilities.

Preserve logical link direction separately from tree parent/child. Canonicalize undirected keys; retain multiple supported relationship types. No causal assertions are created from dates or adjacency.

### 4.3 Graph response and tree projection

GraphResult contains research_id, graph_revision, seed_node_id, root_node_id nullable, origin_assessment, nodes[], relationships[], tree_edges[], cross_link_ids[], undated_node_ids[], limits, truncated, omitted_count nullable, warnings[].

origin_assessment contains status (resolved_within_results | provisional | unresolved), earliest_candidate_ids[], rationale, searched_at, coverage_notes[], and timestamp evidence references. “Resolved” means earliest among adequately dated relevant evidence found in this run, never a guarantee of the first appearance anywhere on the internet.

Search backward from the seed using original citations, quoted phrases, earlier publication filters where supported, and platform references. Root eligibility requires substantive evidence of the particular news/event/claim being traced; an older generic background page is not automatically its origin. If the question encompasses unrelated events, request scope refinement or report ambiguous origin rather than choosing an unrelated oldest page.

Order comparable publication timestamps ascending. Preserve date-only values as uncertain intervals and missing-zone values as uncertain local times; do not synthesize midnight UTC. Equal or overlapping earliest candidates produce a provisional root and an explicit candidate set. Stable IDs may choose a display anchor among ties but do not establish historical priority. If no defensible date exists, root_node_id=null and status=unresolved; return an unplaced/undated collection with the seed highlighted until evidence improves.

Each tree edge contains parent_id, child_id, relationship_id nullable, placement_kind (traced_relationship | chronological_only), and discovery_depth. Prefer a supported relationship to an earlier node as the parent; among eligible parents prefer trace evidence, then the closest preceding publication time, then stable ID. Keep factual relationship direction separate from display direction. When no supported earlier parent exists but the item is relevant, attach it with chronological_only placement, no relationship_id, and no implied provenance. An inferred topic relationship may be shown separately but cannot masquerade as a traced citation. Non-root ordered nodes have one display parent; uncertain-time nodes can remain unplaced in a separate collection. All tree edges are acyclic; later-to-earlier factual links remain cross-links.

An earlier discovery can change the root and projection. Increment graph_revision atomically, provide origin-change warnings, and retain old answer/snapshot references. Do not freeze an incorrect root merely to preserve layout. Filters never rewrite the stored origin assessment.

Default graph cap: 500 nodes and 1,500 relationships. Node/edge limits and partial status are explicit. Deduplicate canonical URLs conservatively; preserve different publishers carrying identical syndicated text. Exact duplicate content is not independent corroboration.

### 4.4 Evidence and snapshots

Evidence contains id, node_id, snapshot_id, kind, quote nullable, start/end nullable, link_target nullable, metadata_field/value nullable, retrieved_at.

Text offsets use zero-based Unicode code points, start-inclusive/end-exclusive, into immutable NFC/LF-normalized canonical text. Validate exact substring equality. Link evidence stores its originating snapshot and link target. Platform/metadata evidence retains the original supplied fields and provenance. A snippet is labeled search evidence and cannot be silently upgraded to full-source evidence.

## 5. MCP tools

Define strict input/output schemas using the official SDK. Successful outputs use structuredContent with compatible text fallback where required. Standard protocol/input errors use SDK behavior; operational failures use isError=true and a typed safe error object.

### 5.1 Gateway control tools

| Tool | Inputs | Output |
|---|---|---|
| start_research | question, source_url, request_id | JobEnvelope with research_id |
| get_job | job_id, after_event_seq optional | JobEnvelope and ordered safe events |
| cancel_job | job_id | JobEnvelope |
| get_research_graph | research_id | GraphResult |
| expand_node | research_id, node_id, graph_revision, request_id | JobEnvelope |
| add_discoveries | research_id, answer_id, candidate_ids[], graph_revision, request_id | JobEnvelope |

### 5.2 LLM research tools

| Tool | Inputs | Output |
|---|---|---|
| get_node_details | research_id, node_id, detail_query optional | Metadata, snapshot identity, cited relevant passages, coverage |
| get_relationship_details | research_id, node_ids[2] | Existing relationship records and supporting evidence; empty is allowed |
| search_related_sources | research_id, seed_node_ids[], query, domains[] optional, published_from/to optional, limit | Candidate IDs, URLs, source/date metadata, snippets, relationship hypotheses, cursor/coverage |
| fetch_source_details | research_id, candidate_id, detail_query optional | Retrieved snapshot, metadata, relevant cited passages or explicit failure |

The LLM receives only the four research tools. It cannot invoke start/cancel/expand/add controls, change ownership, write arbitrary database records, or choose credentials. fetch_source_details accepts a server-issued candidate ID scoped to the research/run, not an unrestricted new URL.

Each tool checks authenticated identity and run-scoped permissions, including nodes and candidate IDs. Research IDs are references, not authorization. Limit search seed IDs to 1–2 existing nodes. detail_query is capped at 1,000 code points; search query at 1,000; limits at 1–10.

All operations with lasting work are idempotent under owner + request_id + input hash. Read tools return current or pinned data under documented version rules. Node question tool calls use the snapshots pinned by their run; new additional sources get separate snapshots.

## 6. Browser/gateway HTTP contract

All routes use /api/v1 except health endpoints. The frontend consumes these routes, not MCP credentials.

| Route | Behavior |
|---|---|
| POST /research | {question, source_url, request_id}; MCP start_research; return 202 JobEnvelope |
| GET /jobs/{job_id} | Optional after_event_seq; MCP get_job |
| POST /jobs/{job_id}/cancel | MCP cancel_job; return current state |
| GET /research/{research_id}/graph | MCP get_research_graph |
| GET /research/{research_id}/nodes/{node_id} | MCP get_node_details |
| POST /research/{research_id}/expand | {node_id, graph_revision, request_id}; MCP expand_node; 202 |
| POST /research/{research_id}/questions | {node_ids:[A,B], graph_revision, question, request_id}; persist orchestrator job; 202 |
| POST /research/{research_id}/discoveries | {answer_id, candidate_ids, graph_revision, request_id}; MCP add_discoveries; 202 |

Validate question length 1–2,000 code points, source URL ≤2,048 characters, request ID UUID, and exactly two distinct authorized nodes for node questions. Reject extra fields and client-supplied source text, owner IDs, model URLs, API keys, or system prompts. Cap request bodies at 16 KiB.

JobEnvelope fields: schema_version, job_id, research_id, request_id, kind (discovery | expansion | question | add_discoveries), status, stage, created_at, updated_at, cancel_requested, result nullable, error nullable, events[], next_event_seq.

status: queued | running | completed | failed | cancelled. stage provides the actual operation, e.g. fetching, searching, extracting, relating, answering, validating. Events are monotonic sequenced safe activity summaries; never hidden chain-of-thought.

Successful discovery/expansion/add jobs return {graph_revision, added_node_ids, warnings}. Question jobs return AnswerResult. Failure returns error and no result. Partial discovery completes with warnings and valid results. Cancellation terminality is transactional; late workers cannot publish after cancellation wins.

Error envelope: {error:{code,message,retryable},request_id}. HTTP uses 401 authentication, 404 absent/unauthorized objects, 409 version/idempotency conflict, 422 validation, 429 limits, 503 unavailable dependencies. Failed asynchronous jobs remain readable via 200 status responses.

## 7. Two-node LLM orchestration

1. Authorize both selected nodes and supplied graph revision; reject stale revisions with VERSION_CONFLICT before starting.
2. Pin selected node metadata, snapshots when available, and relationship versions. Record selected_nodes[{node_id,snapshot_id nullable}] on the run.
3. Provide the question, selected-node identities, known evidence, and allowed tool schemas to the configured LLM.
4. Execute its requested MCP research tool calls through an SDK client. Validate every call against ownership, scope, argument schemas, and budget before execution.
5. Return bounded tool results to the model; allow further detail lookup or additional-source discovery.
6. Require a structured answer, resolve evidence references, validate citations, and persist it.
7. Return additional discoveries separately. Do not mutate the graph during answering; the explicit add-discoveries action handles insertion and validation.

Default per-question bounds: 6 model rounds, 8 tool calls total, 2 search calls, 4 new source fetches, 24,000 cumulative input tokens, 3,000 cumulative output tokens, and 180 seconds after execution begins. Reserve budgets before calls; a repair consumes remaining rounds/tokens. Parallel independent detail requests may be executed if they fit the same aggregate budget. Prevent repeated identical no-progress calls.

If a budget or provider limit prevents further research, return a grounded partial answer when possible; otherwise insufficient evidence. Never invent missing details. A fatal execution failure returns a failed job. Capture actual tools, durations, usage, evidence IDs, and failure codes without storing hidden chain-of-thought.

AnswerResult fields:
- answer_id, research_id, selected_nodes[], graph_revision, question.
- outcome: answered | partial | insufficient_evidence.
- statements[{text,citation_ids[]}], citations[{id,node_id,snapshot_id,evidence_id,quote,start,end}].
- limitations[], additional_candidate_ids[], usage, model_identity, completed_at.

Every substantive factual statement needs supporting citations. Additional sources must be identified as additional, not attributed to the original pair. Metadata questions such as publication order may cite typed metadata evidence instead of a text quote; for these citations quote/start/end are null and the evidence reference provides the field and provenance. Unknown dates must lead to uncertainty, not invented ordering.

Exact quote checks establish provenance, not truth. Test semantic support on reviewed fixtures. Insufficient-evidence answers have no factual statements; limitations explain what could not be established. Preserve attribution, disagreements, and differences in time scope.

## 8. Persistence, access, and retrieval safety

Persist research sessions, jobs/outbox, owner identity, source snapshots, nodes, evidence, relationships, graph revisions, projection, question runs, tool audit events, answers, and temporary candidates. A question completion alone does not persist candidate nodes into the public graph.

Create jobs and dispatch records in one transaction. Redis is transport; PostgreSQL is durable state. Recover abandoned leases and outbox records. Repeated worker delivery must not duplicate graph assertions or answers. Provider calls may still incur repeated charges after a crash; document this limit.

Gateway forwards a verified user principal using a short-lived signed service token. MCP validates issuer, audience, signature, algorithm, expiry, and scope. Owner IDs never come from model arguments. Apply the same ownership to jobs, graphs, snapshots, evidence, candidates, and answers.

Fetch only HTTP(S), normally ports 80/443. Reject userinfo, private/non-public IPv4/IPv6, loopback/link-local and reserved targets. Validate DNS and actual connection targets through address pinning or an enforcing egress proxy; validate every redirect and browser subrequest. Do not perform a pre-check followed by unrestricted DNS resolution. Limit redirects to three, decoded response size to 5 MiB, and fetch time to 20 seconds. Disable unsafe proxy inheritance. Respect robots/access restrictions and source limits; no credential forwarding or paywall/login bypass.

All retrieved content and search snippets are untrusted data. The LLM has only the allowed research tools, no shell, arbitrary network, secrets, or database-write access. Validate and escape final output. Keep prompts and credentials out of UI and routine logs. Restrict browser CORS/Origin, enforce CSRF protection where appropriate, and bind local services to loopback.

Default retention: research sessions, graph data, source snapshots, answers, and their evidence expire together after seven days unless explicitly retained by an authorized product feature. Return 404 after expiry; avoid orphaned citations. Default per-user budget: 100,000 cumulative model tokens per UTC day, with transactional reservations. Search-provider quotas and fetch counts require separate configured caps.

## 9. Errors and honest limitations

Closed domain codes:
INVALID_REQUEST, NOT_FOUND, VERSION_CONFLICT, IDEMPOTENCY_CONFLICT, SOURCE_URL_BLOCKED, SOURCE_ACCESS_DENIED, SOURCE_FETCH_FAILED, UNSUPPORTED_CONTENT, EXTRACTION_FAILED, SEARCH_NOT_CONFIGURED, SEARCH_UNAVAILABLE, PROVIDER_NOT_CONFIGURED, PROVIDER_UNAVAILABLE, INVALID_MODEL_OUTPUT, RATE_LIMITED, BUDGET_EXCEEDED, JOB_TIMEOUT, MCP_UNAVAILABLE, INTERNAL_ERROR.

Distinguish provider unavailability from a successful search with no matches. Report failed candidates without discarding successful discovery. Do not claim exhaustive backlinks, exact dates from ambiguous metadata, independent corroboration from syndicated text, or causal relationships from chronological adjacency.

MCP transport failure cannot become a fabricated successful result. Missing live configuration must be explicit. Fixture mode never silently substitutes for a real search.

## 10. Agent deliverables and acceptance

Deliver runnable source, dependency lockfiles, migrations, shared DTOs/OpenAPI/MCP schemas, .env.example, Docker Compose, README, deterministic fixtures, reviewed evidence cases, and an acceptance report. Implement one genuine search provider, one source fetch/extraction path, and one LLM tool-calling adapter. Credentials remain deployment inputs.

| ID | Required evidence |
|---|---|
| BE-01 | Initial question + source discovers actual related posts/news/pages through MCP and returns graph/tree projection |
| BE-02 | Dates, times, timezone uncertainty, sources, retrieval time, and metadata provenance round-trip correctly |
| BE-03 | Direct outbound/inbound references and inferred relevance are distinguished; snippets cannot prove direct links |
| BE-04 | A newer submitted seed yields an earlier evidence root; ties/date uncertainty, unknown origin, backward links, and later discovery of earlier evidence preserve chronology and evidence semantics |
| BE-05 | Two distinct selected nodes and graph revision are authorized and pinned; stale revision is rejected |
| BE-06 | A question requiring absent details causes the model to call MCP detail tools and use returned evidence |
| BE-07 | A question requiring another source performs bounded MCP search/fetch; its citations identify the additional source |
| BE-08 | Additional findings do not mutate the tree until explicit add; addition validates relationships and revision |
| BE-09 | Invented quotes/IDs, metadata timestamps, unsupported conclusions, and wrong-snapshot citations are rejected |
| BE-10 | Missing dates, inaccessible posts, conflicting reports, partial search failure, and no-results cases remain honest |
| BE-11 | Tool loops stop at limits; concurrent calls obey total budgets; malicious content cannot expand tool privileges |
| BE-12 | SSRF, DNS rebinding, redirect/private-target, oversized-response, and cross-user access tests pass |
| BE-13 | Replay, broker outage, worker crash, cancellation race, and expired sessions preserve documented invariants |
| BE-14 | Official SDK discovery and tool calls succeed over real Streamable HTTP; gateway path does not bypass MCP |
| BE-15 | One live discovery plus one two-node tool-assisted question complete with manually checked evidence; unavailable credentials are listed as pending gates |

Fixtures must include at least 12 sources across posts/news/pages, a seed newer than its traced origin, an earlier source discovered on expansion, a cycle, multiple parents, explicit links, inferred relevance, duplicate text, unknown/date-only timestamps, blocked content, and at least 12 reviewed two-node questions spanning supported answers, additional lookup, conflict, and insufficient evidence.

**Definition of done:** the frontend can receive a dated/source-attributed related-content tree, and its two-node questions can be answered by an LLM that obtains specific details through bounded, auditable MCP research calls.

## 11. References for implementation

Use documentation matching pinned dependencies:
- Official MCP SDK: https://github.com/modelcontextprotocol/python-sdk
- MCP documentation: https://modelcontextprotocol.io/
- Trafilatura: https://trafilatura.readthedocs.io/en/latest/
- Cytoscape.js (frontend): https://js.cytoscape.org/

The implementation must verify current provider APIs and SDK interfaces before coding; this contract defines behavior, not unverified provider-specific endpoint syntax.

