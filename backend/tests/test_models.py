from __future__ import annotations

from datetime import date as DateType
from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from news_trace.models import (
    Evidence,
    EvidenceKind,
    GraphLimits,
    GraphResult,
    OriginAssessment,
    OriginStatus,
    Publication,
    PublicationPrecision,
    Relationship,
    RelationshipKind,
    SourceNode,
    TimezoneStatus,
    TreeEdge,
    TreePlacementKind,
)

from helpers import NOW, make_node


def test_timestamp_requires_explicit_timezone() -> None:
    with pytest.raises(ValidationError):
        Publication(
            timestamp=datetime(2026, 1, 1, 12, 0),
            precision=PublicationPrecision.timestamp,
            timezone_status=TimezoneStatus.known,
        )


def test_date_only_never_claims_midnight_or_timezone() -> None:
    publication = Publication(
        date=DateType(2026, 5, 30),
        precision=PublicationPrecision.date,
        timezone_status=TimezoneStatus.unknown,
        raw="May 30, 2026",
    )
    assert publication.timestamp is None
    assert publication.date == DateType(2026, 5, 30)
    with pytest.raises(ValidationError):
        Publication(
            date=DateType(2026, 5, 30),
            timestamp=datetime(2026, 5, 30, tzinfo=timezone.utc),
            precision=PublicationPrecision.date,
            timezone_status=TimezoneStatus.unknown,
        )
    with pytest.raises(ValidationError):
        Publication(
            date=DateType(2026, 5, 30),
            precision=PublicationPrecision.date,
            timezone_status=TimezoneStatus.known,
        )


def test_unknown_precision_cannot_invent_date() -> None:
    with pytest.raises(ValidationError):
        Publication(
            date=DateType(2026, 5, 30),
            precision=PublicationPrecision.unknown,
            timezone_status=TimezoneStatus.unknown,
        )


def test_relationship_direction_contract() -> None:
    base = dict(
        id="r1",
        from_node_id="a",
        to_node_id="b",
        kind=RelationshipKind.links_to,
        directed=True,
        method="source_link",
        explanation="links",
        evidence_ids=["ev1"],
        status="validated",
        created_at=NOW,
    )
    Relationship(**base)
    with pytest.raises(ValidationError):
        Relationship(**{**base, "directed": False})
    with pytest.raises(ValidationError):
        Relationship(**{**base, "kind": RelationshipKind.related_topic, "directed": True})


def test_validated_relationship_requires_evidence() -> None:
    with pytest.raises(ValidationError):
        Relationship(
            id="r1",
            from_node_id="a",
            to_node_id="b",
            kind=RelationshipKind.references,
            directed=True,
            method="source_link",
            explanation="reference",
            evidence_ids=[],
            status="validated",
            created_at=NOW,
        )


def test_link_evidence_requires_target() -> None:
    with pytest.raises(ValidationError):
        Evidence(
            id="ev1",
            node_id="a",
            snapshot_id="snap",
            kind=EvidenceKind.link,
            retrieved_at=NOW,
        )


def test_graph_rejects_tree_cycle_and_duplicate_children() -> None:
    a = make_node("a", timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc))
    b = make_node("b", timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc))
    origin = OriginAssessment(
        status=OriginStatus.resolved_within_results,
        earliest_candidate_ids=["a"],
        rationale="a is earliest",
        searched_at=NOW,
    )
    with pytest.raises(ValidationError):
        GraphResult(
            research_id="research-test",
            graph_revision=1,
            seed_node_id="b",
            root_node_id="a",
            origin_assessment=origin,
            nodes=[a, b],
            relationships=[],
            tree_edges=[
                TreeEdge(
                    parent_id="a",
                    child_id="b",
                    placement_kind=TreePlacementKind.chronological_only,
                    discovery_depth=1,
                ),
                TreeEdge(
                    parent_id="b",
                    child_id="a",
                    placement_kind=TreePlacementKind.chronological_only,
                    discovery_depth=2,
                ),
            ],
        )


def test_graph_requires_root_to_match_resolved_origin() -> None:
    a = make_node("a", timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc))
    b = make_node("b", timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc))
    origin = OriginAssessment(
        status=OriginStatus.resolved_within_results,
        earliest_candidate_ids=["a"],
        rationale="a is earliest",
        searched_at=NOW,
    )
    with pytest.raises(ValidationError):
        GraphResult(
            research_id="research-test",
            graph_revision=1,
            seed_node_id="b",
            root_node_id="b",
            origin_assessment=origin,
            nodes=[a, b],
            relationships=[],
            tree_edges=[],
        )


def test_truncated_graph_requires_omitted_count() -> None:
    a = make_node("a", timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc))
    origin = OriginAssessment(
        status=OriginStatus.resolved_within_results,
        earliest_candidate_ids=["a"],
        rationale="a is earliest",
        searched_at=NOW,
    )
    with pytest.raises(ValidationError):
        GraphResult(
            research_id="research-test",
            graph_revision=1,
            seed_node_id="a",
            root_node_id="a",
            origin_assessment=origin,
            nodes=[a],
            relationships=[],
            tree_edges=[],
            limits=GraphLimits(max_nodes=1),
            truncated=True,
            omitted_count=None,
        )


def test_urls_require_a_host_and_valid_port() -> None:
    with pytest.raises(ValidationError):
        make_node("missing-host", domain=":8000")
    with pytest.raises(ValidationError):
        make_node("bad-port", domain="example.com:99999")


def test_fixture_mode_must_be_explicit(monkeypatch: pytest.MonkeyPatch) -> None:
    from news_trace.config import Settings

    monkeypatch.delenv("NEWS_TRACE_MODE", raising=False)
    settings = Settings.from_env()
    assert settings.mode == "unconfigured"
    assert settings.fixture_enabled is False


def test_graph_root_must_not_be_a_tree_child() -> None:
    a = make_node("a", timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc))
    b = make_node("b", timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc))
    origin = OriginAssessment(
        status=OriginStatus.resolved_within_results,
        earliest_candidate_ids=["b"],
        rationale="test root constraint",
        searched_at=NOW,
    )
    with pytest.raises(ValidationError, match="must not be a tree child"):
        GraphResult(
            research_id="research-test",
            graph_revision=1,
            seed_node_id="b",
            root_node_id="b",
            origin_assessment=origin,
            nodes=[a, b],
            relationships=[],
            tree_edges=[
                TreeEdge(
                    parent_id="a",
                    child_id="b",
                    placement_kind=TreePlacementKind.chronological_only,
                    discovery_depth=1,
                )
            ],
        )


def test_cross_link_ids_cannot_reuse_a_tree_edge_relationship() -> None:
    a = make_node("a", timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc))
    b = make_node("b", timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc))
    origin = OriginAssessment(
        status=OriginStatus.resolved_within_results,
        earliest_candidate_ids=["a"],
        rationale="a is earliest",
        searched_at=NOW,
    )
    from helpers import make_relationship

    link = make_relationship("r-a-b", "a", "b", kind="links_to")
    with pytest.raises(ValidationError, match="cross_link_ids.*tree edges"):
        GraphResult(
            research_id="research-test",
            graph_revision=1,
            seed_node_id="b",
            root_node_id="a",
            origin_assessment=origin,
            nodes=[a, b],
            relationships=[link],
            tree_edges=[
                TreeEdge(
                    parent_id="a",
                    child_id="b",
                    relationship_id="r-a-b",
                    placement_kind=TreePlacementKind.traced_relationship,
                    discovery_depth=1,
                )
            ],
            cross_link_ids=["r-a-b"],
        )


def test_tree_edge_must_cite_a_relationship_between_its_endpoints() -> None:
    a = make_node("a", timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc))
    b = make_node("b", timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc))
    c = make_node("c", timestamp=datetime(2026, 1, 3, tzinfo=timezone.utc))
    d = make_node("d", timestamp=datetime(2026, 1, 4, tzinfo=timezone.utc))
    origin = OriginAssessment(
        status=OriginStatus.resolved_within_results,
        earliest_candidate_ids=["a"],
        rationale="a is earliest",
        searched_at=NOW,
    )
    from helpers import make_relationship

    unrelated = make_relationship("r-c-d", "c", "d", kind="links_to")
    with pytest.raises(ValidationError, match="connect its parent and child"):
        GraphResult(
            research_id="research-test",
            graph_revision=1,
            seed_node_id="b",
            root_node_id="a",
            origin_assessment=origin,
            nodes=[a, b, c, d],
            relationships=[unrelated],
            tree_edges=[
                TreeEdge(
                    parent_id="a",
                    child_id="b",
                    relationship_id="r-c-d",
                    placement_kind=TreePlacementKind.traced_relationship,
                    discovery_depth=1,
                )
            ],
        )


def test_traced_tree_edge_rejects_non_trace_relationship_kind() -> None:
    a = make_node("a", timestamp=datetime(2026, 1, 1, tzinfo=timezone.utc))
    b = make_node("b", timestamp=datetime(2026, 1, 2, tzinfo=timezone.utc))
    origin = OriginAssessment(
        status=OriginStatus.resolved_within_results,
        earliest_candidate_ids=["a"],
        rationale="a is earliest",
        searched_at=NOW,
    )
    from helpers import make_relationship

    same_event = make_relationship(
        "r-same",
        "a",
        "b",
        kind="same_event",
        directed=False,
        method="llm_inference",
    )
    with pytest.raises(ValidationError, match="trace relationship kind"):
        GraphResult(
            research_id="research-test",
            graph_revision=1,
            seed_node_id="b",
            root_node_id="a",
            origin_assessment=origin,
            nodes=[a, b],
            relationships=[same_event],
            tree_edges=[
                TreeEdge(
                    parent_id="a",
                    child_id="b",
                    relationship_id="r-same",
                    placement_kind=TreePlacementKind.traced_relationship,
                    discovery_depth=1,
                )
            ],
        )
