# Traceback

Trace the evidence behind a viral claim, headline, or article. Traceback retrieves sources, checks how the wording changes, and shows publication dates separately from documented references.

## Run locally

Use Python 3.11 or later and Node.js 22 or later. From the project directory:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
.venv/bin/python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Open [Traceback](http://127.0.0.1:8000). FastAPI serves the built React app and API from one origin. The **Climate deadline demo** opens a cached investigation with five checked sources, including the IPCC report, press coverage, and a later fact check. It works without credentials. The landing page loads the same case automatically and labels it **Cached demo**.

For frontend development, leave FastAPI running and run `npm --prefix frontend run dev` in a second terminal. Vite proxies `/api` to port 8000. Set `TRACEBACK_API_ORIGIN` in the frontend environment to change this target.

## Enable live traces

Copy `.env.example` to `.env`, fill in the values, and restart FastAPI. Keep the file local.

| Variable | Value |
| --- | --- |
| `TAVILY_API_KEY` | Tavily key for Search and Extract |
| `OPENAI_API_KEY` | OpenAI API key with chat and embedding access |
| `OPENAI_CHAT_MODEL` | JSON-mode chat model. Defaults to `gpt-4o-mini`. |
| `OPENAI_EMBEDDING_MODEL` | Embedding model. Defaults to `text-embedding-3-small`. |
| `DATABRICKS_SERVER_HOSTNAME` | Workspace hostname, without `https://` |
| `DATABRICKS_HTTP_PATH` | SQL warehouse HTTP path from Connection Details |
| `DATABRICKS_TOKEN` | Workspace access token |
| `DATABRICKS_CATALOG` | Existing Unity Catalog catalog. Defaults to `main`. |
| `DATABRICKS_SCHEMA` | Target schema. Defaults to `traceback`. |
| `DATABRICKS_VECTOR_INDEX` | Optional fully qualified Databricks AI Search index name |

The warehouse needs to be reachable and the token identity needs permission to use it. The first live trace creates the schema and Delta tables if needed. Grant the identity `USE CATALOG`, `USE SCHEMA`, and permissions to create tables and read and modify the target tables. Grant `CREATE SCHEMA` if the app is creating the schema. [Databricks SQL Connector](https://docs.databricks.com/gcp/en/dev-tools/python-sql-connector)

To use AI Search, run a live trace to create `<catalog>.<schema>.passages`, then create a Delta Sync index using **Databricks-managed embeddings**. Set `id` as the primary key and `passage_text` as the embedding source. Either sync schedule works. Set `DATABRICKS_VECTOR_INDEX` to the index name and restart the API. Newly stored rows can appear in the SQL cosine results before the index syncs. [Create Databricks AI Search indexes](https://docs.databricks.com/aws/en/ai-search/create-ai-search) · [Query Databricks AI Search](https://docs.databricks.com/gcp/en/ai-search/query-ai-search)

## What Databricks does

1. Tavily retrieves publisher URLs, publication metadata when available, and extracted page content or search excerpts. An article URL goes through Tavily Extract so the app can identify a central factual claim to research. [Tavily Search](https://docs.tavily.com/documentation/api-reference/endpoint/search) · [Tavily Extract](https://docs.tavily.com/documentation/api-reference/endpoint/extract)
2. The backend normalizes URL identities, splits the text into overlapping passages, and embeds the claim and passages. It writes the source records and vectors to Delta using parameterized Databricks SQL. [OpenAI embeddings](https://developers.openai.com/api/docs/guides/embeddings)
3. The backend reads back the new rows, a bounded pool of historical rows, and any indexed hits. AI Search supplies index order when available. Python cosine similarity over Delta-backed vectors screens relevance and ranks the remaining passages. The backend retains one passage per source and de-duplicates publisher URLs.
4. Databricks SQL orders selected sources by publication date with unknown dates last and returns ingestion counts for the dashboard. The model assesses the retrieved passages, and the API validates citation IDs against the returned sources. Live graph edges come from matching hyperlinks in extracted pages. The demo also includes explicit textual attributions.
5. The inspector reads the interpretation for the current claim from Delta, including when a source was first retrieved for a different claim.

| Delta table | Contents |
| --- | --- |
| `sources` | Source and trace IDs, claim, URL and canonical URL, title, domain, publisher, source type, publication date, retrieval time, date provenance, and outbound links |
| `passages` | Passage and source IDs, trace ID, extracted text, embedding model, vector, and ingestion timestamp. Delta Change Data Feed is enabled for indexing. |
| `source_assessments` | Source interpretation and display passage keyed by trace and source |

After a live run, use this query in the SQL warehouse to inspect ingestion by trace. Replace `main.traceback` if you changed the namespace.

```sql
SELECT s.trace_id, COUNT(DISTINCT s.id) AS sources, COUNT(p.id) AS passages,
       MIN(s.published) AS earliest_retrieved_publication
FROM main.traceback.sources AS s
LEFT JOIN main.traceback.passages AS p ON p.source_id = s.id
GROUP BY s.trace_id
ORDER BY MAX(s.retrieved_at) DESC;
```

Dates come from retrieved metadata. Unknown dates stay unknown, and ties can appear at the earliest recorded date. The earliest item is relative to the retrieved evidence. A link shows a reference between pages, while the evidence inspector gives the claim-specific interpretation. Sources can be omitted if their available passages lack relevant evidence.

## API and checks

- `POST /api/trace` with `{"claim":"…","mode":"live"}` or `{"mode":"demo"}`
- `GET /api/health` for process and credential configuration status
- `GET /api/sources/{id}` with optional `?trace_id=…` for the corresponding assessment
- [Interactive API docs](http://127.0.0.1:8000/docs)

```sh
.venv/bin/python -m unittest discover -s tests -v
npm --prefix frontend run build
curl -fsS http://127.0.0.1:8000/api/health
curl -fsS http://127.0.0.1:8000/api/trace \
  -H 'Content-Type: application/json' -d '{"mode":"demo"}'
```

The automated suite verifies the API and exercises live orchestration with substituted external services. To verify the real integration, configure credentials, submit a live claim, then compare the dashboard's Delta counts against the warehouse query. If AI Search is configured, allow the index to sync before tracing the same claim again.

The app was built as a local React + FastAPI project. The Sites runtime runs Worker code and does not host a Python FastAPI process, so this checkout has no Sites deployment.
