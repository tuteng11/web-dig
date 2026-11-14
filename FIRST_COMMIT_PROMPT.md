# Agent prompt — create the first News Trace commit

You are working in the target project repository. Implement and create **one focused local first implementation commit** for News Trace. Do the work, run relevant checks, inspect the staged diff, and commit it. Do not push, publish, deploy, rewrite history, or create a remote repository as part of this task.

## 1. Read and establish scope

Read the repository's applicable AGENTS.md instructions, README.md, News_Graph_Implementation_Contract.md, and Question_Source_MCP_Agent_Contract.md. The contracts must be version 2.1 or newer, including the chronology correction below. If a required document is missing, identify it rather than inventing its contents. Respect existing agent/model assignments in AGENTS.md; do not overwrite that file or introduce a competing workflow.

The product takes a question and source URL, discovers related posts/news/websites, and shows a chronological tree. The submitted URL is only a search seed. The root represents the **earliest traceable relevant evidence found**, not automatically the submitted source. Users eventually select two nodes and ask an LLM questions; the LLM requests further details through MCP and answers with citations.

The complete contracts define the final release. This first commit deliberately establishes a small working foundation. Preserve the full scope in the implementation status document; do not erase requirements to make the first milestone appear complete.

Before editing, inspect the repository root, git status, existing history, package manifests, and installed tools. Preserve unrelated work. If no repository exists, initialize one in the intended project directory. If history exists, create the next ordinary commit; do not recreate or squash that history. Use configured Git author identity; do not invent one. Missing identity may block only the final commit, not preparation and verification.

## 2. Required first-commit deliverables

### A. Repository foundation

- Keep the README and both current contracts at the root, with working relative links. Keep this prompt as a development handoff document.
- Establish apps/web for React/TypeScript/Vite and backend/src/news_trace for Python modules, unless existing repository conventions already serve these roles.
- Add dependency manifests and lockfiles using one frontend package manager and one Python environment workflow. Verify official SDK documentation against the selected release before coding MCP integration.
- Add sensible ignore rules for secrets, dependency folders, virtual environments, build output, caches, and local database data. Preserve existing rules.
- Add .env.example with safe placeholders and clearly documented fixture mode. Do not invent provider endpoints or embed keys.
- Add executable scripts for the subset that works in this commit. Update README setup instructions to the commands actually tested.

### B. Shared schemas and chronological projection

Implement the core typed models from the backend contract: source node and publication precision, evidence, relationship, GraphResult, origin assessment, and tree placement. Generate frontend types from the authoritative schema or provide a reproducible checked conversion; do not maintain unrelated handwritten DTO copies.

Implement and test a deterministic chronological projection:
- seed_node_id and root_node_id are independent.
- The root is the earliest adequately supported relevant candidate found.
- Exclude unrelated old background pages from origin eligibility.
- Equal/overlapping dates can produce a provisional origin with alternative candidates.
- Missing dates or timezone uncertainty are preserved; never invent midnight UTC.
- No defensible chronology produces an origin-unresolved state, not a fabricated oldest source.
- Supported trace edges remain distinct from chronological-only placement connectors.
- Preserve factual link direction and cross-links even when they point backward in time.
- Earlier evidence discovered later changes the origin and graph revision without changing node IDs.

### C. One real MCP-backed fixture explorer

Implement a small vertical slice that runs locally without external provider credentials:
1. Seed a deterministic synthetic research fixture with at least 12 source nodes across posts/news/pages.
2. Run an actual official-SDK MCP server over Streamable HTTP.
3. Expose get_research_graph and get_node_details with the contract's typed results.
4. Implement gateway GET routes for graph and node inspection that use an SDK MCP client, not direct in-process shortcuts.
5. Load this fixture research session in the frontend through those gateway routes.
6. Render a chronological tree/outline with source/date/time precision, submitted-source highlighting, cross-links, and a node detail panel.
7. Implement exactly-two-node selection and a clear selection tray. The node-question submit action may remain disabled with a specific “Not implemented in this milestone” explanation until orchestration exists.

Use fixture data only behind explicit fixture configuration, with a visible “Synthetic demo” badge. An explicit development fixture entry point is allowed; it is not a live discovery result. Do not pretend to fetch submitted URLs, run a model, or discover real content. Do not expose unimplemented mutations as successful no-ops. The live research submission path can remain clearly unavailable for this commit.

Full PostgreSQL job persistence, Celery dispatch, live search, safe source fetching, and LLM orchestration may remain next-milestone tasks. State that limit plainly. If an existing codebase already implements them, preserve and use them instead of replacing them with fixtures.

### D. Fixtures and meaningful checks

Include cases where the submitted seed is newer than its origin, an even earlier source arrives on expansion, timestamps tie, dates lack time/timezone, a source has no date, multiple sources cite one item, and links form a cycle. Include duplicate text from different publishers without collapsing publisher identities.

Run relevant checks:
- Type/schema generation and consistency.
- Frontend typecheck and production build.
- Backend model validation and chronological projection tests.
- An MCP integration test using actual Streamable HTTP and an official SDK client; verify tool discovery and typed output.
- Gateway integration proving the read path crosses MCP and surfaces an unavailable MCP service honestly.
- UI verification for tree/list rendering, publication labels, inspection, and exactly-two-node selection. Use automated browser tests if available; otherwise record specific manual checks and limitations.
- Working startup/health behavior, including port and environment configuration.

Test behavior and edge cases, not just snapshots that duplicate the implementation. Avoid unbounded external network calls and paid provider requests in the first-commit tests.

## 3. Development rules

Keep the code modular: schemas/domain, projection, MCP adapter, gateway client/routes, and provider interfaces. Implement only what the milestone needs. Do not scatter transport logic into UI components or model/provider logic into the graph renderer.

Do not install a large autonomous browsing framework, write a bespoke MCP protocol, or build billing/public accounts for this milestone. Keep local fixture access bound to loopback, validate Origin/Host, and make any development authentication bypass explicit and unavailable in live mode. Never commit secrets or raw private source data.

Use existing agent workflow rules when present. Independent UI/schema/test tasks may be delegated only when the active harness/repository instructions permit it. Keep shared schema changes coordinated and integrate them before final validation. This prompt does not override repository-specific model assignments.

## 4. Documentation before committing

Update README with verified prerequisites, setup/start/test commands, fixture entry point, and the implemented/pending boundary. Add docs/IMPLEMENTATION_STATUS.md mapping relevant FE/BE contract acceptance IDs to passed, partially covered, or pending, with evidence. This first slice does not satisfy full live-discovery or LLM-question acceptance.

Add a concise docs/ARCHITECTURE.md recording module boundaries, SDK version, schema-generation approach, chronology/origin decisions, and the next milestone. Do not claim unrun checks passed. If the environment prevents an important check, record the command, reason, and remaining uncertainty.

## 5. Make the commit

Inspect git diff and git status. Stage only the files created or intentionally changed for this task. Review the staged diff and run git diff --cached --check. Verify no secrets, virtual environments, node_modules, generated build bundles, or unrelated changes are staged. Commit generated schemas and lockfiles that belong to the source workflow.

If required local checks fail, fix them before committing. If an external/environment limitation prevents a check, document it honestly; do not present the result as fully verified. Avoid bypassing failing hooks or changing their rules merely to obtain a commit.

Create one local commit with a title such as:

    feat: bootstrap news trace with chronological MCP fixture explorer

If a pre-existing repository requires a different commit convention, follow it. Do not amend existing commits or push. If Git author identity or another genuine repository constraint prevents committing, leave a concrete, reviewed result ready to commit and report the exact blocker.

## 6. Final report

Report the commit hash/title, implemented slice, commands/checks and outcomes, local run instructions, and remaining work: durable discovery jobs, real providers, origin tracing against live data, bounded two-node LLM/MCP research, and full security/access gates. State explicitly whether a commit was actually created.

Proceed autonomously on reversible implementation decisions. The requested outcome is a reviewed first commit, not merely a proposed plan or an empty repository scaffold.
