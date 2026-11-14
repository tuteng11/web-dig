"""Databricks OAuth, Lakebase, and model calls used by the capability Apps."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any

import httpx
import httpx2
import psycopg
from databricks.sdk import WorkspaceClient
from databricks.sdk.core import Config
from mcp import Client
from mcp.client.streamable_http import streamable_http_client


class ProbeError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ProbeError("NOT_CONFIGURED")
    return value


def https_url(value: str) -> str:
    try:
        url = httpx.URL(value)
    except httpx.InvalidURL as exc:
        raise ProbeError("INVALID_CONFIGURATION") from exc
    if url.scheme != "https" or not url.host or url.userinfo or url.query or url.fragment:
        raise ProbeError("INVALID_CONFIGURATION")
    return str(url).rstrip("/")


@lru_cache(maxsize=1)
def workspace() -> WorkspaceClient:
    return WorkspaceClient(config=Config(http_timeout_seconds=10, retry_timeout_seconds=10))


async def authorization() -> dict[str, str]:
    headers = await asyncio.to_thread(workspace().config.authenticate)
    token = headers.get("Authorization", "")
    if not token.startswith("Bearer "):
        raise ProbeError("AUTH_UNAVAILABLE")
    return {"Authorization": token}


@asynccontextmanager
async def authenticated_mcp(url: str, *, timeout: float = 20) -> AsyncIterator[Client]:
    async with asyncio.timeout(timeout):
        async with httpx2.AsyncClient(
            headers=await authorization(), timeout=httpx2.Timeout(timeout, connect=10), trust_env=False
        ) as http_client:
            transport = streamable_http_client(https_url(url), http_client=http_client)
            async with Client(transport, mode="legacy") as client:
                yield client


async def model_request(path: str, payload: dict[str, Any]) -> dict[str, Any]:
    url = https_url(workspace().config.host) + path
    async with asyncio.timeout(30):
        async with httpx.AsyncClient(timeout=25, trust_env=False) as client:
            response = await client.post(url, headers=await authorization(), json=payload)
            response.raise_for_status()
            body = response.json()
    if not isinstance(body, dict):
        raise ProbeError("INVALID_PROVIDER_RESPONSE")
    return body


async def _lakebase_connection() -> psycopg.AsyncConnection:
    endpoint = required("NEWS_TRACE_LAKEBASE_ENDPOINT")
    sslmode = os.environ.get("PGSSLMODE", "require")
    if sslmode not in {"require", "verify-ca", "verify-full"}:
        raise ProbeError("INVALID_CONFIGURATION")
    credential = await asyncio.to_thread(
        workspace().postgres.generate_database_credential, endpoint=endpoint
    )
    if not credential.token:
        raise ProbeError("AUTH_UNAVAILABLE")
    return await psycopg.AsyncConnection.connect(
        host=required("PGHOST"),
        dbname=required("PGDATABASE"),
        user=required("PGUSER"),
        port=os.environ.get("PGPORT", "5432"),
        sslmode=sslmode,
        password=credential.token,
        connect_timeout=10,
        options="-c statement_timeout=8000",
    )


async def lakebase_probe(role: str) -> dict[str, Any]:
    async with asyncio.timeout(30):
        async with await _lakebase_connection() as conn:
            inserted = await conn.execute(
                """
                INSERT INTO news_trace.capability_probe (probe_id) VALUES (%s)
                ON CONFLICT (probe_id) DO NOTHING
                """,
                (role,),
            )
            created = inserted.rowcount == 1
        # A new credential and physical connection must see the committed row.
        async with await _lakebase_connection() as conn:
            cursor = await conn.execute(
                "SELECT first_seen FROM news_trace.capability_probe WHERE probe_id = %s", (role,)
            )
            row = await cursor.fetchone()
    if row is None:
        raise ProbeError("LAKEBASE_ROW_MISSING")
    return {"first_seen": row[0].isoformat(), "created": created, "reconnect": True}
