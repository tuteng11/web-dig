# News Graph — Frontend Website Implementation Contract

**Version:** 2.1
**Date:** November 14, 2026  
**Companion:** Question_Source_MCP_Agent_Contract.md, version 2.1  
**Audience:** The agent implementing the website UI and its gateway integration

## 1. Product and scope

Build a research website where the user provides **a question and a source post/article/webpage URL**. The backend searches for related posts, news, and webpages through MCP. The frontend displays returned items as an interactive tree with publication date, time, and source. The user can select **exactly two distinct nodes**, ask a question about them, and receive a cited answer from an LLM that can request additional details through MCP.

This version replaces the previous frontend contract in full. There is no existing backend: the companion contract instructs the backend agent to build it. The previous single-page-only research scope no longer applies. Related-content discovery, the tree UI, and two-node questioning are all required in the first complete release.

MUST denotes required acceptance behavior. Numerical defaults are implementation starting points, not measured performance claims. The companion contract owns shared DTOs, MCP tool schemas, job semantics, and error codes; this document owns browser behavior and presentation. Generate shared client types rather than creating divergent copies.

## 2. Required user journey

1. Enter a research question and the source link; submit.
2. Observe source retrieval and related-content discovery progress.
3. See a chronological tree rooted at the earliest relevant evidence discovered; the submitted source is highlighted wherever its publication time places it.
4. Inspect dates, times, publishers/platforms, relationship labels, and supporting evidence.
5. Expand a node to discover additional related content within the configured limits.
6. Select two nodes; enter a comparison or detail question.
7. Observe the LLM requesting node details, relationship evidence, or additional search results through MCP.
8. Read the answer with clickable citations. Additional discoveries appear in a reviewable list and are added to the tree only when the user chooses.

The frontend MUST NOT fabricate nodes, connections, timestamps, quotes, or research activity. An empty or partially successful discovery is a valid state.

## 3. Architecture and ownership

Browser requests go to same-origin gateway routes. The gateway acts as the MCP client for discovery and data access, and runs or dispatches the server-side LLM conversation. The browser never holds model/provider/service credentials and never constructs raw MCP JSON-RPC messages.

| Component | Ownership |
|---|---|
| Research form and tree | Frontend agent |
| Two-node selection, question panel, citations | Frontend agent |
| Typed HTTP client and HTTP fixture adapter | Frontend agent, generated against backend schemas |
| Gateway, MCP client/server, search/fetch adapters, job execution | Backend agent under companion contract |
| Publication metadata and relationship evidence | Backend-provided values; frontend formats but does not infer |
| Browser-level integration tests | Frontend agent using fixture and live gateway modes |

Use React + TypeScript + Vite unless an existing repository requires another framework. Use Cytoscape.js or an established equivalent with a hierarchical layout. Record the chosen layout package and pin compatible dependencies. Keep tree projection logic independent of the renderer.

## 4. Screens and layout

### 4.1 Start screen

Display a compact research form:
- Question textarea, 1–2,000 Unicode code points.
- HTTP(S) source URL, maximum 2,048 characters.
- Submit action and inline validation.
- Plain-language scope: search for content linked to or related to the supplied source.
- Explicit synthetic-data label in fixture mode.

Do not display fabricated trending stories or demo data as current results. Preserve unsent input during transient errors; do not put question text or source query parameters into the browser URL or analytics.

### 4.2 Research workspace

Desktop layout:
- Header: original question, submitted source, earliest-found source, job status, and new-research action.
- Left panel: source list, search within loaded results, filters, and research scope.
- Center: tree canvas with zoom, pan, fit, root focus, collapse/expand, and legend.
- Right panel: node details or selected-pair question/answer.
- Persistent selection tray naming the two selected nodes and offering clear/swap actions.

At narrow widths, use Tree / Sources / Ask tabs. Keep selection and the current answer while switching tabs. Provide a keyboard-accessible outline/list that supports the same inspect, select, expand, and citation actions as the canvas.

### 4.3 Node cards

Each visible node shows title (or a labeled URL fallback), content kind, source name/domain, publication date and time when known, and retrieval/content status. Detail view adds canonical URL, original URL, author when supplied, timestamps with provenance, excerpt, and the reason it was connected.

Render missing publication information explicitly:
- Timestamp: show localized date and time, with original offset/timezone in details.
- Date only: show date and “Time unavailable”; do not convert to invented midnight.
- Unknown timezone: label it; do not silently apply the browser timezone.
- Unknown date/time: “Publication time unavailable.”
- Retrieval time: separate “Retrieved” field, never presented as publication time.

A search-result snippet may be displayed as a snippet, but MUST carry its status and cannot masquerade as verified full-page evidence.

## 5. Tree semantics

The underlying relationships form a graph and may contain cycles or multiple parents. The UI is a **tree projection** of that graph.

- The submitted source is a discovery seed, not a forced root. Highlight it with a “Submitted source” badge. Root the tree at the earliest traceable relevant evidence found by the backend, labeled “Earliest evidence found,” with coverage and uncertainty details.
- Use the backend's versioned chronological projection. Traceable parent-child connections reference actual relationships. When chronological placement is necessary without a supported trace relationship, show a visibly distinct “Chronological placement only” connector; it is not a factual citation, influence, or causation edge.
- Preserve additional relationships as cross-links in node details and optional overlays; do not discard them from the data model.
- Separate the presentation parent-child connection from the factual direction of a relationship. A discovery parent is not necessarily the source of a quotation or hyperlink.
- Edge labels distinguish “Links to,” “References,” “Same event,” “Follow-up,” and “Related topic.”
- Direct linkage and inferred semantic relevance must have visibly different line styles/labels.
- The vertical time axis orders comparable publication times from earlier to later; branching reflects supported trace relationships where available. Neither order nor branching proves causation. Keep sources with uncertain dates in a clearly labeled time-uncertain lane.
- Repeated URLs resolve to the same stable node; cycles become cross-links, not infinite recursive branches.
- Nodes with only broad-topic similarity remain identified as inferred related content.
- Ordering is chronological by default. Equal times share a time band with a stable visual tie-break, not a claimed precedence. Date-only or timezone-unknown values preserve uncertainty; never invent midnight or a timezone. Candidate relevance ranking must not reorder the chronology.

If the earliest origin is ambiguous, show a provisional root and the alternative earliest candidates. If no defensible publication ordering exists, show an explicit origin-unresolved state rather than claiming the seed is the origin. An earlier discovery produces a new graph revision and a notice before rerooting; preserve selected node identities and pin old answers to their original snapshots. A filter must not silently redefine the earliest-known source.

Required controls: pan/zoom, fit, root focus, submitted-source focus, collapse/expand subtree, inspect cross-links, publication range, source, content kind, relationship kind, and loaded-result search. Filters affect the current dataset unless the user explicitly requests further discovery.

When filtering hides an ancestor, retain it as a dimmed “Context” node to keep the path understandable, or show the matching node in the accessible list. Do not invent a new factual relationship to bypass the hidden ancestor.

Default initial discovery returns up to 20 related items. Render up to 100 nodes initially, with an explicit hard interactive cap of 500 nodes and 1,500 relationships. Show omitted counts and expansion limits. Existing selections and pinned positions survive updates. New results must not silently replace the user's current workspace.

## 6. Node selection and questions

A regular click inspects a node. A visible “Select for question” control or keyboard action adds it to the selection tray; selection must not depend on modifier keys.

Require exactly two distinct nodes to submit a node question. Clicking a third node does not silently discard one: offer explicit replacement of slot A or B. The root may be selected. Show titles, sources, dates, and A/B labels so the reference is clear.

Examples of supported questions:
- “What changed between these reports?”
- “Do they disagree about the funding amount?”
- “Which source was published first?”
- “Does either report identify the original source?”
- “Find the specific announcement they both refer to.”

Send node IDs and the displayed graph revision, not copied article text or client-generated summaries. The backend pins the corresponding source versions. If versions changed, show the conflict and let the user refresh before resubmitting.

Changing the selected pair does not relabel an existing answer. Retain the original pair with that answer, cancel its browser polling if appropriate, and place new questions in a distinct request context.

## 7. LLM activity and answer UI

Show concise verified activity events returned by the backend, such as:
- Reading selected sources.
- Looking up the reported amount.
- Checking relationship evidence.
- Searching for the original announcement.
- Checking citations.

Do not show hidden chain-of-thought, raw system prompts, tool credentials, or fabricated typing/progress. Display meaningful tool failures and available partial findings.

The answer panel must:
- Render structured statements and citation markers as escaped text.
- Open a citation drawer with the exact quote, source node/title, snapshot identity, publication metadata, and retrieval time.
- Distinguish evidence from either selected node from evidence found in additional sources.
- Show uncertainty, conflicting claims, incomplete access, and selected-passage coverage.
- Support answered, partially answered, and insufficient-evidence outcomes.
- Explain when neither source provides enough information.
- Keep additional discoveries separate until “Add to tree” is selected.

Only the backend validates and publishes citations. The frontend still validates response shape and references before rendering; malformed payloads show a safe error, not guessed citations.

## 8. HTTP integration and state

All routes are under /api/v1. The companion contract defines their exact shared models.

| Route | Frontend behavior |
|---|---|
| POST /research | Submit question, source_url, request_id; retain returned job/research IDs |
| GET /jobs/{job_id}?after_event_seq=... | Poll job and safe ordered activity events |
| POST /jobs/{job_id}/cancel | Request cancellation; wait for terminal state |
| GET /research/{research_id}/graph | Load a versioned graph/tree projection |
| GET /research/{research_id}/nodes/{node_id} | Inspect source metadata and available content/evidence |
| POST /research/{research_id}/expand | Request further discovery from a node |
| POST /research/{research_id}/questions | Ask about exactly two selected nodes |
| POST /research/{research_id}/discoveries | Add explicitly selected additional findings through a validated graph mutation |

Create a UUID request_id once for each intentional mutation; reuse it for network retries of the identical payload. Changed inputs require a new ID. Never automatically resubmit a timed-out mutation with a new ID.

Poll active jobs every two seconds while visible and ten seconds while hidden; stop at terminal status. Event cursors prevent duplicate activity. Ignore out-of-order revisions and responses belonging to another selected research session. Use abortable requests and cleanup polling on unmount.

Persist research/job IDs and view filters in the route so refresh resumes the view. Authentication is still required; a URL is not an access grant. Do not persist source bodies, secrets, or sensitive questions in local storage. Ephemeral form drafts may use session memory.

Initial discovery, node expansion, and node questions are separate jobs. A failed expansion or question must not destroy the existing tree. A job may succeed partially; show item-level warnings alongside valid nodes.

## 9. Errors, loading, and disabled states

Provide explicit states for initial loading, queued work, discovery in progress, no related results, partial results, source unavailable, search provider unavailable, expired session, request conflict, offline status, malformed backend response, cancelled job, and budget/limit exhaustion.

- Do not infer a connection from a search result when the backend supplies none.
- A partial source can remain in the tree as unavailable/snippet-only while other nodes succeed.
- Distinguish local form validation from source retrieval or provider failure.
- Retryable status reads may retry with backoff; billable mutations use the request-ID rule.
- Cancellation is best-effort. A completed result can win the cancellation race and must be shown honestly.
- Missing backend configuration presents an actionable setup/error state; fixture mode is explicit and never an automatic hidden fallback.
- Search can be incomplete. “No related results found” does not claim no related sources exist.

## 10. Frontend boundaries and security

Use same-origin authenticated gateway calls. Keep all provider and MCP service tokens server-side. Protect state-changing routes against CSRF where cookie authentication is used.

Render untrusted source/model text safely; do not embed arbitrary source HTML, execute links, or auto-load remote images/iframes from results. Only allow safe HTTP(S) navigation with appropriate external-link attributes. Do not directly fetch supplied source URLs from the browser.

Keep technical MCP details out of ordinary product copy. Users should see “Research sources” and “Ask about selected sources,” not protocol controls.

## 11. Required components and deliverables

Implement modular components for ResearchForm, JobProgress, TreeExplorer, SourceList, NodeDetails, PairSelectionTray, NodeQuestionPanel, AnswerWithCitations, CitationDrawer, and AdditionalDiscoveries.

Deliver typed gateway client, shared DTO generation, tree/list interaction state, fixture adapter, responsive UI, accessibility checks, and integration tests. Fixture scenarios must cover cycles, multiple parents, duplicates, unknown dates, same-time sources, blocked sources, partial discovery, additional-source answers, and two-node conflict questions.

The fixture adapter must implement the actual HTTP contract rather than unrelated hard-coded component data. Include a README with local startup, backend connection, fixture/live switching, known limitations, and completed/pending acceptance gates.

## 12. Acceptance criteria

| ID | Pass condition |
|---|---|
| FE-01 | Question + source URL starts real gateway/MCP discovery and displays backend-returned tree data |
| FE-02 | Every node shows source and honest date/time precision; retrieval time is never substituted for publication |
| FE-03 | A seed newer than other evidence is not the root; chronology, ties, uncertain dates, cycles, and multiple parents render correctly; earlier discoveries reroot with notice and preserved selections |
| FE-04 | Direct links and inferred relevance are distinguishable; edge direction remains correct |
| FE-05 | Exactly two distinct nodes can be selected by mouse or keyboard; third-node replacement is explicit |
| FE-06 | A submitted node question pins its original pair/revision; later selection changes cannot misattribute its answer |
| FE-07 | Actual MCP detail/search activity is displayed, and answers cite selected or additional source snapshots correctly |
| FE-08 | Additional findings appear separately and only enter the tree after explicit add action |
| FE-09 | Expand/collapse, filters, context ancestors, list alternative, and graph caps behave correctly |
| FE-10 | Refresh resumes authorized work; duplicate submits, stale responses, event replays, and polling cleanup are handled |
| FE-11 | Partial discovery, insufficient evidence, cancellation races, provider failure, and access errors have correct states |
| FE-12 | No keys, raw HTML execution, fabricated nodes, fabricated dates, or fabricated citations reach the UI |
| FE-13 | Keyboard navigation and narrow-screen layouts support the full research-and-question journey |
| FE-14 | A 500-node/1,500-edge fixture becomes interactive within three seconds after receipt on documented test hardware |
| FE-15 | A real configured discovery and a two-node question requiring an MCP detail call complete end to end; pending credentials are reported honestly |

**Definition of done:** a user can discover a tree of related sources with dates/times/publishers, select two nodes, ask a question, and inspect a grounded answer whose LLM obtained needed details through MCP.

## 13. Implementation order

1. Shared backend DTOs and realistic fixtures.
2. Research form, discovery progress, source list, and tree projection.
3. Node metadata/details, cross-links, filters, and expansion.
4. Pair selection, question jobs, tool activity, answers, and citations.
5. Additional-findings insertion, failure recovery, accessibility, and live integration.

Preserve the original goal of exploring connected news. Do not reduce this product to a single-page summary form or defer the tree and two-node interaction out of the first complete release.

