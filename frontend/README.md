# Traceback — contract UI

React + TypeScript + Vite implementation of the browser side of
[News_Graph_Implementation_Contract.md](../News_Graph_Implementation_Contract.md) v2.1 in the
new Traceback visual language.

The synthetic demo reads its graph and node details from the backend gateway through the real
MCP fixture server by default. It is always labelled **Synthetic demo** and never silently
replaces live research. An explicit bundled offline adapter (`VITE_DEMO_TRANSPORT=bundled` or
`?demo=1&transport=bundled`) keeps the complete interactive contract demo available without a
backend. The gateway demo is read-only: job, question, expansion, and additional-discovery routes
are not implemented in this milestone and return typed errors instead of fake results.

## Run

Requirements: Node.js 22 or newer, plus the backend for the default gateway demo.

Start the fixture gateway and MCP server from the repository root:

```sh
backend/.venv/Scripts/python.exe scripts/run_fixture.py
```

In a second terminal, install and start the new UI:

```sh
npm install
npm run dev
```

Open the printed Vite URL. Vite proxies `/api` and `/health` to `http://127.0.0.1:8000`.
The landing page offers **Load synthetic Riverbend demo**; by default it loads the deterministic
16-source graph and node details through the gateway. Use
`http://127.0.0.1:5173/?demo=1&transport=bundled` for the fully offline demo with local expansion,
question, citation, and additional-discovery simulation.

Typecheck and production build:

```sh
npm run typecheck
npm run build
```

The production build checks that Vite statically replaced every `import.meta.env.VITE_*` read.
If the bundle still contains a runtime `import.meta.env` expression, the build fails so configured
transport/mode values cannot be silently dropped.

Unit tests for chronology, publication precision, filtering, caps, answer validation, the fixture
client, job-event cursor semantics, submission/idempotency guards, and job-response identity:

```sh
npm test
```

Shared DTOs are generated in `apps/web/src/generated/newsTraceContracts.ts` from
`contracts/generated/news_graph.schema.json`. Keep this app's copy in sync:

```sh
npm run sync:contracts
npm run check:contracts
```

Browser smoke tests (use the installed Edge/Chrome through `playwright-core`; no browser
download). The default smoke runs the bundled offline flow and asserts zero `/api/v1` requests:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
# in a second terminal:
npm run smoke:browser
```

The gateway smoke requires the backend on port 8000 and the preview proxy target above. It asserts
that graph and node-detail reads reach `/api/v1/research/...`:

```sh
npm run smoke:browser:gateway
```

## Modes

| Mode | How to enable | Behaviour |
|---|---|---|
| Gateway fixture demo | `VITE_DEMO_TRANSPORT=gateway`, or unset when `VITE_FIXTURE_MODE` is not `true` | Loads graph and node details from the same-origin `/api/v1` gateway, which reaches the MCP fixture server. Read-only: expansion, question, and additional-discovery jobs return typed `503` responses. |
| Bundled offline demo | `VITE_DEMO_TRANSPORT=bundled`, legacy `VITE_FIXTURE_MODE=true` fallback, or `?demo=1&transport=bundled` | Uses the bundled Riverbend fixture and the complete local simulation. Makes no `/api/v1` requests. |
| Live gateway | `VITE_FIXTURE_MODE=false` | Enables the live research form and calls the same-origin `/api/v1` routes. Discovery and job routes are still typed `503` stubs in this milestone. |

Transport precedence is: valid `VITE_DEMO_TRANSPORT` value, then `VITE_FIXTURE_MODE=true` as a
legacy bundled fallback, then gateway. `VITE_FIXTURE_MODE=false` selects live-discovery mode.
`?demo=1&transport=gateway|bundled` overrides the demo transport for that page and is persisted
in the URL so a reload cannot silently switch transports.

`VITE_API_BASE` overrides the API base (default `/api/v1`). `VITE_FIXTURE_RESEARCH_ID` overrides
the fixture research id (default `fixture-riverbend`). No provider keys or MCP endpoints belong
in the browser.

## Contract routes used

The typed client in `src/api/gateway.ts` covers:

- `POST /research`
- `GET /jobs/{job_id}?after_event_seq=...`
- `POST /jobs/{job_id}/cancel`
- `GET /research/{research_id}/graph`
- `GET /research/{research_id}/nodes/{node_id}`
- `POST /research/{research_id}/expand`
- `POST /research/{research_id}/questions`
- `POST /research/{research_id}/discoveries`

The two read routes are wired end to end through MCP. The discovery, job, expansion, question,
and additional-discovery routes exist as explicit contract stubs in this milestone: valid
requests receive a typed `503 PROVIDER_NOT_CONFIGURED`, and unknown job ids receive `404`. No
synthetic job or fake answer is returned by the backend.

Request IDs are created per intentional mutation and memoized per payload, so an explicit retry of
the exact same request reuses its UUID while a different payload gets a new one. A synchronous
submission gate and immediately visible pending state prevent double-click duplicate jobs; responses
from a superseded session are discarded. The client also handles abort signals, same-origin
credentials, safe error envelopes, malformed payloads, and polling every 2 s while visible and
10 s while hidden (stopping at terminal status). `after_event_seq` is an exclusive cursor: the
client sends the highest sequence actually received, never `next_event_seq`.

## Implemented UI behaviour

- Research form with question (1–2000 code points) and HTTP(S) source URL (≤2048 characters),
  inline validation, preserved input on error, and explicit fixture labelling.
- Workspace header with question, submitted source, earliest evidence (resolved / provisional /
  unresolved), graph revision, job status, origin-change notice, and new research.
- Chronological tree with pan/zoom/fit/focus controls, root and submitted-source focus,
  collapse/expand subtree, cross-link overlay, traced versus chronological-only connectors,
  inferred-relationship styling, legend, and a time-uncertain lane.
- Source list alternative with loaded-result search, content-kind, source, relationship-kind, and
  publication-range filters; ancestors hidden by filters remain as dimmed context.
- Honest publication precision: timestamp with offset, date-only (“Time unavailable”),
  unknown-timezone wall clock, unknown date, and retrieval time kept separate.
- Node detail panel with canonical/original URLs, author, content status, snapshot, evidence,
  relationship direction/method/status, cross-link badges, warnings, and coverage notes.
- Exactly-two selection with A/B labels, clear/swap, explicit third-node replacement, and
  keyboard-operable list/tree actions.
- Node questions pinned to the selected pair and graph revision; safe activity events; answers
  with statements, citation markers, limitations, stale-revision notice, and citation drawer.
  These flows run in the bundled offline demo; the gateway demo is read-only and reports the
  typed job-not-implemented response instead of a fabricated answer.
- Additional discoveries shown separately until an explicit “Add to tree” action in the bundled
  offline demo.
- An explicit read-only notice on gateway demo sessions, separating the backend read path from
  the not-yet-implemented job routes.
- Loading, queued/running, empty, partial/truncated, cancellation, provider failure, malformed
  payload, cap, and version-conflict states.
- Initial render cap of 100 nodes, hard cap of 500 nodes / 1,500 relationships, and explicit
  omitted counts.
- Research/filter/node/selection state is restored from the route; question text and source URLs
  are never written to the browser URL or local storage.
- Responsive Tree / Sources / Ask tabs preserve selection and answers while switching.

## Fixture answers (explicitly synthetic)

The bundled fixture adapter returns a clearly labelled synthetic answer for the demo pair
`n-seed` + `n-grassroots`, using only the fixture's publication metadata and link evidence. Other
pairs receive a publication-order answer when both nodes expose typed metadata evidence, otherwise
an `insufficient_evidence` outcome. No model or MCP call is executed, and every fixture answer says
so in its limitations. The gateway demo does not run this adapter; it returns the backend's typed
job-not-implemented error.

The bundled expanded fixture revision adds an earlier planning-board agenda (`n-agenda`) and
reroots the tree. The UI shows an origin-change notice, keeps selections, and leaves earlier
answers pinned to their original revision. The gateway fixture currently serves revision 1 only;
requesting a newer revision shows the read-only notice rather than silently replacing it with the
bundled copy.

## Acceptance coverage (frontend v2.1)

| ID | Status | Evidence / boundary |
|---|---|---|
| FE-01 | Gateway read path wired; live discovery pending | The default synthetic demo loads graph and node details through the gateway/MCP read path. `POST /research` and job routes return typed `503` stubs; live discovery remains backend work. |
| FE-02 | Implemented | `formatPublication` preserves timestamp/date/unknown-zone/unknown states and keeps retrieval separate; covered by unit tests. |
| FE-03 | Implemented | Chronological layout, seed/root separation, ties, uncertainty, cross-links; fixture expansion reroots with a notice and preserves selections. Browser smoke passed. |
| FE-04 | Implemented | Traced, chronological-only, and inferred edges use distinct labels/styles; factual direction is shown in details. |
| FE-05 | Implemented | A/B buttons, clear/swap, exactly-two enforcement, explicit Replace A/B for a third node. |
| FE-06 | Implemented in bundled demo; gateway jobs pending | Question requests pin the pair and graph revision; retained answers keep their own pair/revision and stale badges. Gateway demo returns the typed not-implemented response. |
| FE-07 | Bundled UI complete; live pending | Activity events, statement citations, and citation drawer are implemented with the bundled synthetic answer; the gateway demo does not execute a model or MCP question call. |
| FE-08 | Bundled demo complete; backend pending | Additional candidates stay separate until explicit “Add to tree”; stale revisions are rejected. Gateway demo returns a typed `503` stub. |
| FE-09 | Implemented | Collapse/expand, filters with context ancestors, list alternative, 100/500/1,500 caps and notices. |
| FE-10 | Implemented, live auth pending | Route state resumes research/filters/node/selection and demo transport; gateway revision-1 limitation is shown explicitly. Duplicate submissions are gated synchronously, request IDs are reused per payload for explicit retries, and URL-resumed jobs are ignored unless their research id matches. Server ownership checks remain backend work. |
| FE-11 | Implemented | Loading, queued/running, empty, partial/truncated, cancellation, provider/network, malformed, conflict, and cap states. |
| FE-12 | Implemented | Escaped text, safe HTTP(S) links only, no secrets or fabricated dates/citations; validation rejects malformed payloads. |
| FE-13 | Implemented | Keyboard-accessible list and buttons, mobile Tree/Sources/Ask tabs with state preserved; 390px browser smoke passed. |
| FE-14 | Logic present, performance unverified | Cap selection exists; the bundled fixture has 17 nodes, so the 500-node/1,500-edge three-second gate is not claimed. |
| FE-15 | Pending backend | End-to-end live discovery and a real MCP-backed two-node answer require the gateway/MCP/LLM. |

## Pending backend work

These acceptance criteria need the real gateway/MCP/LLM and are intentionally not claimed here:

- FE-01 live discovery through the gateway and MCP; `POST /research` is currently a typed `503` stub.
- FE-07 real MCP detail/search activity and backend-validated citations.
- FE-08 backend persistence for additional discoveries; the gateway stub does not mutate a graph.
- FE-10 resuming an authenticated live job after refresh (route state is implemented; server
  authorization/ownership remains backend work).
- FE-10 resuming a discovery job before its graph exists; the client rejects a job from a different
  research id, but the pre-graph boot flow belongs to the backend job milestone.
- FE-15 end-to-end live discovery and a two-node question requiring an MCP detail call.
- Real 500-node/1,500-edge performance evidence (the cap logic exists; the bundled fixture is small).

The client validates graph, node-detail, and answer payload shapes before rendering. Malformed
payloads produce a safe error state instead of guessed nodes or citations. Job envelopes are also
checked against the requested kind, research id, request id, and (for cancellation) job id before
they are installed or settled; a mismatch is rejected as `MALFORMED_RESPONSE`.

App-level lifecycle guards are covered by the pure gate, polling, and response-identity tests plus
the browser smokes. A component-level test harness for deferred cancellation, finalization, and
boot-resume promises is still a follow-up; the frontend package has no DOM test environment.

## Security boundaries

- Source/model text is rendered as escaped React text; no source HTML is injected.
- Links are limited to safe HTTP(S) URLs with `noreferrer noopener` when opened externally.
- No provider/MCP credentials, raw MCP messages, question text, or source URLs are stored in the
  browser URL or local storage.
- Fixture data is deterministic and local; it is never presented as live research.
