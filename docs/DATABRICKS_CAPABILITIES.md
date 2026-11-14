# Databricks Free Edition capability results

**Workspace status** — Pending authenticated access. This environment has no Databricks CLI login, workspace URL, or configured Databricks credentials. A local pass in this table records software verification. The workspace column records the evidence required to proceed with the live deployment.

| Probe | Local evidence | Free Edition workspace evidence |
|---|---|---|
| Two Databricks Apps | Both source roots can be staged and started locally | Pending both deployed `/health` responses. Record App names, URLs, and deployment IDs |
| Lakebase | Fresh credential call for every new connection tested with SDK and database doubles | Pending committed insert and second-connection read for both service principals. Record project/branch/endpoint and compare `first_seen` after restart and after OAuth token expiry |
| App-to-App MCP | Official client initialized a Streamable HTTP session, listed tools, and called the research App through ASGI | Pending the web App's OAuth-authenticated MCP result. Record both App names and the probe status/code |
| Hosted model | Model adapter tested with simulated provider responses and a real local MCP call | Pending hosted function request, actual research App tool call, and model response confirming the tool result. Record the model and endpoint |
| Web search | Candidate URL parsing tested with simulated structured citations | Pending candidate URLs from managed MCP or a configured alternative. Record mode and result count |
| Source access | Redirect recipient and robots policy checks tested with simulated responses | Pending fetch of a representative article and of a search citation from the research App. Record approved domains and safe result codes |
| Presenter access | Diagnostic action rejects callers outside its configured operator list | Pending browser access by the intended judge or presenter. Record role and status only |

## Go/no-go

Select a live search provider and hosted model after they pass in the workspace. If source egress blocks collection, record the affected domains and approve an ingestion path or a labeled corpus replay for the demo. Leave pending checks unverified until there is evidence. See the [deployment runbook](DATABRICKS_DEPLOYMENT.md) for the commands and settings.
