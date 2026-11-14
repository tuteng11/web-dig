# News Trace web — fixture explorer

React + TypeScript + Vite frontend for the News Trace first milestone.

This build is a **read-only fixture explorer**. It loads the synthetic research session from the FastAPI gateway,
which reaches the fixture MCP server over Streamable HTTP. It does not submit live research, run an LLM, or answer
node questions.

## Prerequisites

- Node.js 22.22.2 or newer (verified with 24.22.1) and npm
- The backend gateway and fixture MCP server running; see the repository [README](../../README.md)

## Run

From the repository root:

```powershell
Copy-Item .env.example .env
npm --prefix apps/web install
npm --prefix apps/web run dev
```

Open `http://127.0.0.1:5173`. Vite loads environment values from the repository-root `.env` and proxies `/api` and
`/health` to the gateway (`http://127.0.0.1:8000` by default) with the Host header rewritten for the gateway's
allow-list.

### Configuration

| Variable | Default | Purpose |
|---|---|---|
| `VITE_FIXTURE_MODE` | unset | Must be `true` to load the synthetic fixture session. Anything else shows the explicit live-mode-unavailable state. |
| `VITE_FIXTURE_RESEARCH_ID` | `fixture-riverbend` | Fixture research session requested from the gateway. |
| `VITE_API_BASE` | `/api/v1` | Gateway API base path. |
| `VITE_GATEWAY_PROXY` | `http://127.0.0.1:8000` | Vite dev proxy target; not exposed to the browser. |

Fixture mode is never an automatic hidden fallback. The UI displays a persistent **Synthetic demo** badge and the
gateway health response reports `mode: "fixture"`.

## Gateway routes used

- `GET /api/v1/research/{research_id}/graph` → `GraphResult`
- `GET /api/v1/research/{research_id}/nodes/{node_id}` → `NodeDetails`

The typed client validates essential graph references at runtime before rendering. Malformed payloads produce a
safe error state, not guessed data.

## Implemented

- Chronological tree canvas with a deterministic layout independent of Cytoscape.
- Accessible source outline/list with search and content-kind filtering.
- Honest publication display: timestamp with explicit zone, date-only (“Time unavailable”),
  timezone-unknown, unknown time, and a separate retrieval time.
- Submitted-source and earliest-evidence badges, provisional-origin candidates and display-anchor notices,
  cross-link display, node detail panel, snapshot/evidence display.
- Exactly-two-node A/B selection with clear/swap and explicit third-node replacement.
- Unplaced/time-uncertain lane for date-only, unknown-zone, undated, and older context sources; equal timestamps
  share a time band with an explicit tie-break label.
- Responsive Tree / Sources / Ask tabs.
- Explicit loading, malformed-response, MCP-unavailable, and live-mode-unavailable states.

## Pending

- Live research submission and job progress.
- Node expansion and reroot notices driven by a job.
- Two-node question orchestration, answer/citation UI, and additional-findings review.
- Full keyboard journey and full accessibility audit.
- 500-node/1,500-edge performance and graph-cap UI.
- Production authentication, CSRF, and deployment configuration.

See [../docs/IMPLEMENTATION_STATUS.md](../docs/IMPLEMENTATION_STATUS.md) for the contract acceptance mapping.

## Checks

From the repository root:

```powershell
npm --prefix apps/web test
npm --prefix apps/web run typecheck
npm --prefix apps/web run build
npm --prefix apps/web run generate:types
```

Regenerate types from `contracts/generated/news_graph.schema.json` whenever backend shared models change. Do not
edit `src/generated/newsTraceContracts.ts` by hand.

### Real-browser smoke check

With the backend and Vite dev server running:

```powershell
cd apps/web
npm install
npm run smoke:browser
```

The script uses the installed Microsoft Edge through `playwright-core`, verifies the synthetic badge, source list,
time-uncertain lane, node inspection, two-node tray, and disabled question action, then writes a screenshot to the
system temp directory. No browsers are downloaded by the script.
