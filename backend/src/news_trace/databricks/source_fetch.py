"""Bounded retrieval for approved public source domains."""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from dataclasses import dataclass
from urllib.parse import urlsplit

import httpx
from protego import Protego

USER_AGENT = "NewsTraceBot"
MAX_BYTES = 5 * 1024 * 1024
MAX_ROBOTS_BYTES = 512 * 1024
REDIRECTS = {301, 302, 303, 307, 308}


class FetchError(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class PublicPage:
    url: str
    body: bytes
    redirects: int


def source_url(value: str) -> httpx.URL:
    if not value or len(value) > 2048 or any(ord(char) <= 32 or char == "\\" for char in value):
        raise FetchError("SOURCE_URL_BLOCKED")
    try:
        if "@" in urlsplit(value).netloc:
            raise FetchError("SOURCE_URL_BLOCKED")
        url = httpx.URL(value)
    except (ValueError, httpx.InvalidURL) as exc:
        raise FetchError("SOURCE_URL_BLOCKED") from exc
    if (
        url.scheme not in {"http", "https"}
        or not url.host
        or url.userinfo
        or b"@" in url.netloc
        or url.port is not None
    ):
        raise FetchError("SOURCE_URL_BLOCKED")
    return url.copy_with(fragment=None)


async def _public_address(host: str, port: int) -> str:
    records = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses = [ipaddress.ip_address(record[4][0]) for record in records]
    for address in addresses:
        if not address.is_global or address.is_multicast or address.is_reserved or (
            isinstance(address, ipaddress.IPv6Address)
            and (address.ipv4_mapped or address.scope_id or address.sixtofour or address.teredo)
        ):
            raise FetchError("SOURCE_URL_BLOCKED")
    if not addresses:
        raise FetchError("SOURCE_FETCH_FAILED")
    return str(addresses[0])


async def _get(url: httpx.URL, max_bytes: int, accept: str) -> tuple[int, httpx.Headers, bytes]:
    address = await _public_address(url.raw_host.decode("ascii"), 443 if url.scheme == "https" else 80)
    async with httpx.AsyncClient(trust_env=False, follow_redirects=False) as client:
        # Connect to the checked address. Retain the original Host, SNI and certificate check.
        async with client.stream(
            "GET",
            url.copy_with(host=address),
            headers={
                "Host": url.netloc.decode("ascii"),
                "User-Agent": USER_AGENT,
                "Accept": accept,
                "Accept-Encoding": "identity",
            },
            extensions={"sni_hostname": url.raw_host.decode("ascii")},
        ) as response:
            body = bytearray()
            if response.status_code == 200:
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    raise FetchError("UNSUPPORTED_CONTENT")
                async for chunk in response.aiter_raw():
                    body.extend(chunk)
                    if len(body) > max_bytes:
                        raise FetchError("UNSUPPORTED_CONTENT")
            return response.status_code, response.headers, bytes(body)


async def fetch_public_page(value: str, allowed_hosts: frozenset[str]) -> PublicPage:
    url = source_url(value)
    robots: dict[tuple[str, str], Protego | None] = {}
    try:
        async with asyncio.timeout(20):
            for redirects in range(4):
                if url.raw_host.decode("ascii") not in allowed_hosts:
                    raise FetchError("SOURCE_URL_BLOCKED")
                origin = (url.scheme, url.host)
                if origin not in robots:
                    status, _, rules = await _get(
                        url.copy_with(path="/robots.txt", query=None), MAX_ROBOTS_BYTES, "text/plain"
                    )
                    if status not in {200, 404, 410}:
                        raise FetchError("SOURCE_ACCESS_DENIED")
                    robots[origin] = Protego.parse(rules.decode("utf-8", errors="replace")) if status == 200 else None
                policy = robots[origin]
                if policy is not None and not policy.can_fetch(str(url), USER_AGENT):
                    raise FetchError("SOURCE_ACCESS_DENIED")
                status, headers, body = await _get(url, MAX_BYTES, "text/html, application/xhtml+xml")
                if status in REDIRECTS and "location" in headers:
                    url = source_url(str(url.join(headers["location"])))
                    continue
                if status in {401, 403, 407, 429, 451}:
                    raise FetchError("SOURCE_ACCESS_DENIED")
                if status != 200:
                    raise FetchError("SOURCE_FETCH_FAILED")
                if headers.get("content-type", "").split(";", 1)[0].strip().lower() not in {
                    "text/html", "application/xhtml+xml"
                } or not body.strip():
                    raise FetchError("UNSUPPORTED_CONTENT")
                return PublicPage(str(url), body, redirects)
    except (TimeoutError, OSError, httpx.HTTPError, httpx.InvalidURL) as exc:
        raise FetchError("SOURCE_FETCH_FAILED") from exc
    raise FetchError("SOURCE_FETCH_FAILED")
