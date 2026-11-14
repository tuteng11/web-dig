# Traceback — contract UI

React + TypeScript + Vite implementation of the browser side of
[News_Graph_Implementation_Contract.md](../News_Graph_Implementation_Contract.md) v2.1 in the
new Traceback visual language.

The UI can run without a backend through an explicit synthetic fixture adapter. The adapter
implements the same typed client interface as the HTTP gateway, so wiring the real backend later
does not require rewriting components. Fixture mode is always labelled **Synthetic demo** and
never silently replaces live research.

## Run

Requirements: Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open the printed Vite URL. The landing page offers **Load synthetic Riverbend demo**; that is the
offline path. It loads a deterministic 16-source fixture with cycles, multiple parents, duplicate
syndication, date-only and undated sources, ties, cross-links, and an expanded revision that
reroots the tree.

Typecheck and production build:

```sh
npm run typecheck
npm run build
```

Unit tests for chronology, publication precision, filtering, caps, answer validation, and the
fixture client:

```sh
npm test
```

Shared DTOs are generated in `apps/web/src/generated/newsTraceContracts.ts` from
`contracts/generated/news_graph.schema.json`. Keep this app's copy in sync:

```sh
npm run sync:contracts
npm run check:contracts
```

Browser smoke test (uses the installed Edge/Chrome through `playwright-core`; no browser
download):

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 4173
# in a second terminal:
npm run smoke:browser
```

## Modes

| Mode | How to enable | Behaviour |
|---|---|---|
| Synthetic fixture | default | Uses the bundled Riverbend fixture. Live discovery is refused with an explicit message; the demo button loads the fixture. |
| Live gateway | `VITE_FIXTURE_MODE=false` | Calls the same-origin `/api/v1` routes. If the gateway is absent, errors are shown honestly. |

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

Request IDs are created per intentional mutation. The client handles abort signals, same-origin
credentials, safe error envelopes, malformed payloads, and polling every 2 s while visible and
10 s while hidden (stopping at terminal status).

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
- Additional discoveries shown separately until an explicit “Add to tree” action.
- Loading, queued/running, empty, partial/truncated, cancellation, provider failure, malformed
  payload, cap, and version-conflict states.
- Initial render cap of 100 nodes, hard cap of 500 nodes / 1,500 relationships, and explicit
  omitted counts.
- Research/filter/node/selection state is restored from the route; question text and source URLs
  are never written to the browser URL or local storage.
- Responsive Tree / Sources / Ask tabs preserve selection and answers while switching.

## Fixture answers (explicitly synthetic)

The fixture adapter returns a clearly labelled synthetic answer for the demo pair
`n-seed` + `n-grassroots`, using only the fixture's publication metadata and link evidence. Other
pairs receive a publication-order answer when both nodes expose typed metadata evidence, otherwise
an `insufficient_evidence` outcome. No model or MCP call is executed, and every fixture answer says
so in its limitations.

The expanded fixture revision adds an earlier planning-board agenda (`n-agenda`) and reroots the
tree. The UI shows an origin-change notice, keeps selections, and leaves earlier answers pinned to
their original revision.

## Acceptance coverage (frontend v2.1)

| ID | Status | Evidence / boundary |
|---|---|---|
| FE-01 | Wired, live pending | The typed gateway client posts `/research` and polls the job. Fixture mode refuses live discovery explicitly; live verification needs the backend. |
| FE-02 | Implemented | `formatPublication` preserves timestamp/date/unknown-zone/unknown states and keeps retrieval separate; covered by unit tests. |
| FE-03 | Implemented | Chronological layout, seed/root separation, ties, uncertainty, cross-links; fixture expansion reroots with a notice and preserves selections. Browser smoke passed. |
| FE-04 | Implemented | Traced, chronological-only, and inferred edges use distinct labels/styles; factual direction is shown in details. |
| FE-05 | Implemented | A/B buttons, clear/swap, exactly-two enforcement, explicit Replace A/B for a third node. |
| FE-06 | Implemented | Question requests pin the pair and graph revision; retained answers keep their own pair/revision and stale badges. |
| FE-07 | UI complete, live pending | Activity events, statement citations, and citation drawer are implemented; fixture answers state that no model/MCP ran. |
| FE-08 | Implemented | Additional candidates stay separate until explicit “Add to tree”; stale revisions are rejected. Browser smoke passed. |
| FE-09 | Implemented | Collapse/expand, filters with context ancestors, list alternative, 100/500/1,500 caps and notices. |
| FE-10 | Implemented, live auth pending | Route state resumes research/job/filters/node/selection and fixture revision; server ownership checks remain backend work. |
| FE-11 | Implemented | Loading, queued/running, empty, partial/truncated, cancellation, provider/network, malformed, conflict, and cap states. |
| FE-12 | Implemented | Escaped text, safe HTTP(S) links only, no secrets or fabricated dates/citations; validation rejects malformed payloads. |
| FE-13 | Implemented | Keyboard-accessible list and buttons, mobile Tree/Sources/Ask tabs with state preserved; 390px browser smoke passed. |
| FE-14 | Logic present, performance unverified | Cap selection exists; the bundled fixture has 17 nodes, so the 500-node/1,500-edge three-second gate is not claimed. |
| FE-15 | Pending backend | End-to-end live discovery and a real MCP-backed two-node answer require the gateway/MCP/LLM. |

## Pending backend work

These acceptance criteria need the real gateway/MCP/LLM and are intentionally not claimed here:

- FE-01 live discovery through the gateway and MCP.
- FE-07 real MCP detail/search activity and backend-validated citations.
- FE-10 resuming an authenticated live job after refresh (route state is implemented; server
  authorization/ownership remains backend work).
- FE-15 end-to-end live discovery and a two-node question requiring an MCP detail call.
- Real 500-node/1,500-edge performance evidence (the cap logic exists; the bundled fixture is small).

The client validates graph, node-detail, and answer payload shapes before rendering. Malformed
payloads produce a safe error state instead of guessed nodes or citations.

## Security boundaries

- Source/model text is rendered as escaped React text; no source HTML is injected.
- Links are limited to safe HTTP(S) URLs with `noreferrer noopener` when opened externally.
- No provider/MCP credentials, raw MCP messages, question text, or source URLs are stored in the
  browser URL or local storage.
- Fixture data is deterministic and local; it is never presented as live research.
