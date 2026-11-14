# Deploy the Databricks capability Apps

These two Apps run phase 0 of the [integration plan](DATABRICKS_INTEGRATION_PLAN.md). They exercise the runtime identities, storage, model, and search paths before the project selects production dependencies. Record results in the [capability matrix](DATABRICKS_CAPABILITIES.md).

## Stage the source

Use Python 3.11 or later. From the repository root, stage the contents of both Apps into a new directory.

```sh
python scripts/stage_databricks_apps.py /tmp/news-trace-apps
```

The script stages Python source and dependencies alongside each `app.yaml`. The two directories are independently deployable using the documented Python Apps lifecycle. [Databricks Apps runtime](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/app-runtime)

## Configure workspace resources

1. Authenticate the Databricks CLI with `databricks auth login --host "$WORKSPACE_URL" --profile news-trace`. Create `news-trace-web` and `mcp-news-trace` in the Free Edition workspace. Record the two App URLs. [Create a custom MCP App](https://docs.databricks.com/aws/en/agents/mcp-tools/custom-mcp)
2. Attach the same Lakebase Autoscaling database to both Apps as an App resource. Each App uses its own PostgreSQL role and the `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGSSLMODE` from the resource. Use the direct compute endpoint. Run `deploy/databricks/probe.sql` in the database as the schema owner and grant both App roles `USAGE` on schema `news_trace` and `SELECT, INSERT` on `news_trace.capability_probe`. [Lakebase App resources](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/lakebase), [Lakebase OAuth tutorial](https://docs.databricks.com/aws/en/oltp/projects/tutorial-databricks-apps-autoscaling)
3. Grant the web App service principal **CAN USE** on the research App. Keep research App access limited to that principal and the workspace operators who manage the deployment. Grant the web App permission to query an available model with chat function calling. Give the research App access to the selected search service or model. Give the presenter **CAN USE** on the web App. [App permissions](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/permissions), [Databricks function calling](https://docs.databricks.com/aws/en/machine-learning/model-serving/function-calling)
4. Add the following values under `env` in the corresponding **staged** `app.yaml` files. Each entry has `name` and quoted `value` fields. App OAuth credentials come from the Apps runtime. Run the Apps behind the authenticated Databricks proxy, which supplies the web diagnostic's `X-Forwarded-User` identity. Use the full `<user-id>@<workspace-id>` value visible in the App access log for each operator. [App authentication](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/auth), [App access logs](https://docs.databricks.com/aws/en/dev-tools/databricks-apps/monitor)

| App | Setting | Value |
|---|---|---|
| Both | `NEWS_TRACE_LAKEBASE_ENDPOINT` | Lakebase compute resource name, in `projects/<project>/branches/<branch>/endpoints/<endpoint>` format |
| Web | `NEWS_TRACE_RESEARCH_MCP_URL` | Exact HTTPS research App URL ending in `/mcp` |
| Web | `NEWS_TRACE_MODEL` | Available Databricks chat model or endpoint name with function calling |
| Web | `NEWS_TRACE_PROBE_OPERATORS` | Space-separated forwarded identities for operators allowed to run diagnostics |
| Research | `NEWS_TRACE_RESEARCH_ALLOWED_HOSTS` | Comma-separated exact Host values accepted on `/mcp`, starting with the research App hostname |
| Research | `NEWS_TRACE_SAMPLE_URL` | Representative public article approved for retrieval |
| Research | `NEWS_TRACE_SOURCE_HOSTS` | Comma-separated exact ASCII publisher hostnames approved for retrieval, including expected redirect hosts |
| Research | `NEWS_TRACE_SEARCH_QUERY` | A public query expected to find an article on one of the approved source hosts |
| Research | `NEWS_TRACE_SEARCH_MODE` | Defaults to `managed-mcp`. Alternatives are `native-openai`, `native-gemini`, and `external-mcp` |
| Research | `NEWS_TRACE_SEARCH_MODEL` | Model service name required for either native search mode |
| Research | `NEWS_TRACE_SEARCH_CONNECTION`, `NEWS_TRACE_SEARCH_TOOL` | External MCP connection and discovered tool names for `external-mcp`. The tool must accept `query` as its only required argument |

Deploy research first. Set `WORKSPACE_APP_ROOT` to an existing workspace folder you can write to, such as `/Workspace/Users/name@example.com`.

```sh
(cd /tmp/news-trace-apps/research && databricks sync . "$WORKSPACE_APP_ROOT/mcp-news-trace" --profile news-trace)
databricks apps deploy mcp-news-trace --source-code-path "$WORKSPACE_APP_ROOT/mcp-news-trace" --profile news-trace
(cd /tmp/news-trace-apps/web && databricks sync . "$WORKSPACE_APP_ROOT/news-trace-web" --profile news-trace)
databricks apps deploy news-trace-web --source-code-path "$WORKSPACE_APP_ROOT/news-trace-web" --profile news-trace
```

## Run the checks

Open both HTTPS `/health` endpoints with an authorized browser session. Then use the operator's CLI OAuth login to run the integrated probe.

```sh
python -m pip install -e ./backend -r deploy/databricks/requirements.txt
python scripts/probe_databricks_apps.py --profile news-trace --app-url "$WEB_APP_URL"
```

The result separates the web and research App checks. Search must return citation URLs. The research App fetches the sample URL and independently attempts one search citation on an approved source host. Retrieval revalidates host and DNS on each redirect, connects to a checked public address, and checks the publisher's robots policy. It reports response size and redirect count as fetch evidence. The hosted-model test passes once the configured model requests the expected structured function call, the gateway executes it over MCP, and a second model response confirms the ephemeral challenge value. The runner returns a nonzero exit code if any of its checks fail.

Redeploy or restart both Apps and repeat. For each App, `created` should be `false`, `first_seen` should match its original value, and `reconnect` should be `true`. Repeat after at least one token lifetime to verify that fresh database connections work after expiration. For a managed search failure, check workspace preview availability, then configure a supported native model or a permitted external MCP and re-run. Keep a separate result for each attempt in the capability matrix. [Free Edition limits](https://docs.databricks.com/aws/en/getting-started/free-edition-limitations), [Web search](https://docs.databricks.com/aws/en/machine-learning/model-serving/web-search)

## Continue after the capability check

The probe database table stores only a stable test row per App. The product deployment still needs the Lakebase research schema, the leased executor, the signed owner context between Apps, the real discovery and two-node answer tools, the React gateway deployment, and the MLflow evidence trace. Use the capability results to select a provider and verify the contract acceptance criteria in subsequent phases.
