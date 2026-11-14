"""Run the deployed probe using a Databricks CLI OAuth profile."""

from __future__ import annotations

import argparse
import asyncio
import json
import os

import httpx

from news_trace.databricks.platform import authorization, https_url


async def probe(app_url: str) -> int:
    headers = {**await authorization(), "X-News-Trace-Probe": "run"}
    async with httpx.AsyncClient(timeout=85, trust_env=False) as client:
        response = await client.post(https_url(app_url) + "/internal/databricks/probe", headers=headers)
    if response.status_code != 200:
        print(json.dumps({"status": "fail", "code": f"HTTP_{response.status_code}"}))
        return 1
    result = response.json()
    print(json.dumps(result, indent=2))
    research = result.get("research_app", {}).get("checks", {})
    checks = [result[key] for key in ("lakebase", "mcp", "hosted_model", "research_app")]
    checks.extend(research.get(key, {}) for key in ("lakebase", "search", "source_fetch", "search_result_fetch"))
    return 0 if all(check.get("status") == "pass" for check in checks) else 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-url", required=True)
    parser.add_argument("--profile", required=True)
    args = parser.parse_args()
    os.environ["DATABRICKS_CONFIG_PROFILE"] = args.profile
    os.environ["DATABRICKS_AUTH_TYPE"] = "databricks-cli"
    try:
        status = asyncio.run(probe(args.app_url))
    except Exception as exc:
        print(json.dumps({"status": "fail", "code": "PROBE_REQUEST_FAILED", "type": type(exc).__name__}))
        status = 1
    raise SystemExit(status)


if __name__ == "__main__":
    main()
