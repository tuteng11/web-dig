from __future__ import annotations

from datetime import date as DateType
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from news_trace.models import (
    ContentKind,
    ContentStatus,
    Publication,
    PublicationPrecision,
    SourceInfo,
    SourceNode,
    TimezoneStatus,
)

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPOSITORY_ROOT / "fixtures" / "riverbend_fixture.json"
EASTERN = timezone(timedelta(hours=-4))
NOW = datetime(2026, 7, 12, 10, 0, tzinfo=EASTERN)


def make_node(
    node_id: str,
    *,
    timestamp: datetime | None = None,
    date: DateType | None = None,
    precision: PublicationPrecision | None = None,
    timezone_status: TimezoneStatus | None = None,
    title: str | None = None,
    content_kind: ContentKind = ContentKind.news,
    content_status: ContentStatus = ContentStatus.full_text,
    excerpt: str | None = "Fixture excerpt.",
    domain: str | None = None,
    source_name: str | None = "Fixture Source",
    research_id: str = "research-test",
) -> SourceNode:
    if precision is None:
        precision = (
            PublicationPrecision.timestamp
            if timestamp is not None
            else PublicationPrecision.date
            if date is not None
            else PublicationPrecision.unknown
        )
    if timezone_status is None:
        timezone_status = (
            TimezoneStatus.known
            if precision is PublicationPrecision.timestamp
            else TimezoneStatus.unknown
        )
    publication = Publication(
        timestamp=timestamp,
        date=date,
        raw=None,
        precision=precision,
        timezone_status=timezone_status,
        evidence_id=None,
    )
    snapshot_id = (
        f"snap-{node_id}"
        if content_status in {ContentStatus.full_text, ContentStatus.excerpt}
        else None
    )
    if content_status is ContentStatus.snippet_only and excerpt is None:
        excerpt = "Snippet."
    if content_status is ContentStatus.unavailable:
        excerpt = None
    return SourceNode(
        id=node_id,
        research_id=research_id,
        content_kind=content_kind,
        requested_url=f"https://{domain or f'{node_id}.example'}/{node_id}",
        canonical_url=f"https://{domain or f'{node_id}.example'}/{node_id}",
        title=title or f"Title {node_id}",
        author=None,
        source=SourceInfo(
            name=source_name,
            domain=domain or f"{node_id}.example",
            platform=None,
        ),
        publication=publication,
        updated_at=None,
        retrieved_at=NOW,
        discovered_at=NOW,
        content_status=content_status,
        excerpt=excerpt,
        snapshot_id=snapshot_id,
        content_hash=f"sha256:fixture-{node_id}" if snapshot_id else None,
        warnings=[],
    )


def make_relationship(
    relationship_id: str,
    from_node_id: str,
    to_node_id: str,
    *,
    kind: str = "links_to",
    directed: bool = True,
    method: str = "source_link",
    evidence_ids: list[str] | None = None,
    status: str = "validated",
) -> Any:
    from news_trace.models import Relationship

    return Relationship(
        id=relationship_id,
        from_node_id=from_node_id,
        to_node_id=to_node_id,
        kind=kind,
        directed=directed,
        method=method,
        explanation="Fixture relationship.",
        evidence_ids=evidence_ids if evidence_ids is not None else ["ev-fixture"],
        score=None,
        status=status,
        created_at=NOW,
    )
