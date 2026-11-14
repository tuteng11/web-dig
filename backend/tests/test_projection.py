from __future__ import annotations

from datetime import date as DateType
from datetime import datetime, timedelta, timezone

from news_trace.fixture_service import FixtureRepository
from news_trace.models import (
    GraphLimits,
    OriginStatus,
    PublicationPrecision,
    RelationshipKind,
    TreePlacementKind,
)
from news_trace.projection import project_graph

from helpers import FIXTURE_PATH, NOW, make_node, make_relationship

UTC = timezone.utc


def fixture_repository() -> FixtureRepository:
    return FixtureRepository(FIXTURE_PATH)


def project_custom(nodes, relationships, eligible, *, seed_id, revision=1, limits=None, previous_root=None):
    return project_graph(
        research_id="research-test",
        graph_revision=revision,
        seed_node_id=seed_id,
        nodes=nodes,
        relationships=relationships,
        origin_eligible_node_ids=eligible,
        searched_at=NOW,
        previous_root_node_id=previous_root,
        limits=limits,
    )


def test_fixture_initial_graph_roots_at_earliest_evidence_not_seed() -> None:
    graph = fixture_repository().get_graph("fixture-riverbend")

    assert graph.root_node_id == "n-grassroots"
    assert graph.seed_node_id == "n-seed"
    assert graph.seed_node_id != graph.root_node_id
    assert graph.origin_assessment.status is OriginStatus.resolved_within_results
    assert graph.origin_assessment.earliest_candidate_ids == ["n-grassroots"]
    assert graph.origin_assessment.timestamp_evidence_ids == ["ev-pub-n-grassroots"]
    assert len(graph.nodes) == 16
    assert len(graph.relationships) == 18
    assert graph.undated_node_ids == ["n-blocked", "n-dateonly", "n-local", "n-undated"]


def test_fixture_tree_preserves_chronology_and_ties() -> None:
    graph = fixture_repository().get_graph("fixture-riverbend")
    nodes = {node.id: node for node in graph.nodes}
    edges = {edge.child_id: edge for edge in graph.tree_edges}
    statuses = {node.id: node for node in graph.nodes}

    # The two hearing sources tie; the later stable id is placed with no time gap claim.
    assert nodes["n-hearing-live"].publication.timestamp == nodes["n-hearing-notes"].publication.timestamp
    tie_edge = edges["n-hearing-notes"]
    assert tie_edge.parent_id == "n-hearing-live"
    assert tie_edge.placement_kind is TreePlacementKind.chronological_only
    assert tie_edge.relationship_id is None

    # Every traced edge points at an earlier publication instant.
    for edge in graph.tree_edges:
        if edge.placement_kind is TreePlacementKind.traced_relationship:
            parent = statuses[edge.parent_id].publication.timestamp
            child = statuses[edge.child_id].publication.timestamp
            assert parent is not None and child is not None
            assert parent < child


def test_fixture_distinguishes_traced_edges_from_chronological_placement() -> None:
    graph = fixture_repository().get_graph("fixture-riverbend")
    placements = {edge.child_id: edge for edge in graph.tree_edges}

    assert placements["n-utility"].placement_kind is TreePlacementKind.traced_relationship
    assert placements["n-utility"].relationship_id == "r-grassroots-references-utility"
    assert placements["n-hearing-live"].placement_kind is TreePlacementKind.traced_relationship
    assert placements["n-hearing-live"].relationship_id == "r-live-replies-grassroots"
    assert placements["n-hearing-notes"].placement_kind is TreePlacementKind.chronological_only
    assert placements["n-hearing-notes"].relationship_id is None


def test_fixture_preserves_cross_links_cycles_and_multiple_parents() -> None:
    graph = fixture_repository().get_graph("fixture-riverbend")

    # The cycle is not expanded recursively; the unused direction is a cross-link.
    assert "r-forum-a-links-forum-b" in {
        edge.relationship_id for edge in graph.tree_edges
    }
    assert "r-forum-b-links-forum-a" in graph.cross_link_ids

    # n-regulators cites both minutes and the fact sheet; only one display parent.
    regulator_edges = [edge for edge in graph.tree_edges if edge.child_id == "n-regulators"]
    assert len(regulator_edges) == 1
    assert regulator_edges[0].parent_id == "n-minutes"
    assert "r-regulators-references-utility" in graph.cross_link_ids
    assert "r-regulators-related-seed" in graph.cross_link_ids


def test_fixture_keeps_duplicate_text_publishers_distinct() -> None:
    graph = fixture_repository().get_graph("fixture-riverbend")
    nodes = {node.id: node for node in graph.nodes}

    first = nodes["n-synd-a"]
    second = nodes["n-synd-b"]
    assert first.id != second.id
    assert first.excerpt == second.excerpt
    assert first.content_hash == second.content_hash
    assert first.source.domain != second.source.domain
    assert first.source.name != second.source.name


def test_expanded_stage_reroots_without_changing_node_ids() -> None:
    repository = fixture_repository()
    initial = repository.get_graph("fixture-riverbend")
    expanded = repository.project_stage("fixture-riverbend", "expanded")

    initial_ids = {node.id for node in initial.nodes}
    expanded_ids = {node.id for node in expanded.nodes}
    assert initial_ids < expanded_ids
    assert expanded_ids - initial_ids == {"n-agenda"}

    assert initial.root_node_id == "n-grassroots"
    assert expanded.root_node_id == "n-agenda"
    assert expanded.graph_revision == 2
    assert expanded.seed_node_id == initial.seed_node_id
    assert any("Origin changed" in warning for warning in expanded.warnings)

    # The earlier agenda is the display parent; the factual link still points
    # forward in time from the neighborhood post to the agenda it cites.
    agenda_edge = next(edge for edge in expanded.tree_edges if edge.child_id == "n-grassroots")
    assert agenda_edge.parent_id == "n-agenda"
    assert agenda_edge.relationship_id == "r-grassroots-links-agenda"
    factual = next(
        item for item in expanded.relationships if item.id == "r-grassroots-links-agenda"
    )
    assert factual.from_node_id == "n-grassroots"
    assert factual.to_node_id == "n-agenda"


def test_equal_earliest_timestamps_produce_provisional_origin() -> None:
    tie = datetime(2026, 3, 1, 9, 0, tzinfo=UTC)
    a = make_node("a", timestamp=tie)
    b = make_node("b", timestamp=tie)
    c = make_node("c", timestamp=tie + timedelta(hours=2))

    graph = project_custom([c, b, a], [], ["a", "b", "c"], seed_id="c")

    assert graph.origin_assessment.status is OriginStatus.provisional
    assert graph.origin_assessment.earliest_candidate_ids == ["a", "b"]
    assert graph.root_node_id == "a"
    assert any("share the earliest publication timestamp" in note for note in [graph.origin_assessment.rationale])


def test_equal_instant_root_is_first_placed_despite_local_date_offsets() -> None:
    # Both normalize to 2026-05-09T20:00Z, but their local dates differ.
    aaa = make_node(
        "aaa",
        timestamp=datetime(
            2026,
            5,
            10,
            10,
            0,
            tzinfo=timezone(timedelta(hours=14)),
        ),
    )
    zzz = make_node(
        "zzz",
        timestamp=datetime(
            2026,
            5,
            9,
            8,
            0,
            tzinfo=timezone(timedelta(hours=-12)),
        ),
    )

    graph = project_custom([zzz, aaa], [], ["aaa", "zzz"], seed_id="zzz")

    assert graph.origin_assessment.earliest_candidate_ids == ["aaa", "zzz"]
    assert graph.root_node_id == "aaa"
    assert graph.root_node_id not in {
        edge.child_id for edge in graph.tree_edges
    }


def test_same_instant_ineligible_context_is_not_placed_before_root() -> None:
    same_instant = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    context = make_node("aaa-context", timestamp=same_instant)
    origin = make_node("zzz-origin", timestamp=same_instant)

    graph = project_custom(
        [context, origin],
        [],
        ["zzz-origin"],
        seed_id="zzz-origin",
    )

    assert graph.root_node_id == "zzz-origin"
    assert graph.tree_edges == []
    assert graph.root_node_id not in {
        edge.child_id for edge in graph.tree_edges
    }
    assert "aaa-context" in graph.undated_node_ids


def test_date_only_earlier_candidate_makes_origin_provisional() -> None:
    dated = make_node("dated", date=DateType(2026, 4, 1))
    timestamped = make_node("timestamped", timestamp=datetime(2026, 4, 2, 12, 0, tzinfo=UTC))

    graph = project_custom([timestamped, dated], [], ["dated", "timestamped"], seed_id="timestamped")

    assert graph.origin_assessment.status is OriginStatus.provisional
    assert set(graph.origin_assessment.earliest_candidate_ids) == {"dated", "timestamped"}
    assert graph.root_node_id == "dated"
    assert "dated" in graph.undated_node_ids
    assert all(edge.parent_id != "dated" for edge in graph.tree_edges)


def test_only_earliest_date_only_candidates_are_named() -> None:
    early = make_node("dateonly-early", date=DateType(2026, 6, 1))
    later = make_node("dateonly-later", date=DateType(2026, 6, 9))
    timestamped = make_node(
        "timestamped",
        timestamp=datetime(2026, 6, 10, 12, 0, tzinfo=UTC),
    )

    graph = project_custom(
        [early, later, timestamped],
        [],
        ["dateonly-early", "dateonly-later", "timestamped"],
        seed_id="timestamped",
    )

    assert graph.origin_assessment.status is OriginStatus.provisional
    assert graph.origin_assessment.earliest_candidate_ids == ["dateonly-early"]
    assert graph.root_node_id == "dateonly-early"
    assert "dateonly-later" in graph.undated_node_ids
    assert "dateonly-later" not in {
        edge.parent_id for edge in graph.tree_edges
    } | {edge.child_id for edge in graph.tree_edges}


def test_date_only_utc_boundary_can_overlap_extreme_offset_timestamp() -> None:
    # 2026-05-09T23:30-12:00 is 2026-05-10T11:30Z, but the local timestamp date
    # is May 9. A May 10 date-only value with an unknown zone can still be earlier.
    timestamped = make_node(
        "timestamped",
        timestamp=datetime(
            2026,
            5,
            9,
            23,
            30,
            tzinfo=timezone(timedelta(hours=-12)),
        ),
    )
    dated = make_node("dateonly", date=DateType(2026, 5, 10))

    graph = project_custom(
        [timestamped, dated],
        [],
        ["timestamped", "dateonly"],
        seed_id="timestamped",
    )

    assert graph.origin_assessment.status is OriginStatus.provisional
    assert set(graph.origin_assessment.earliest_candidate_ids) == {
        "dateonly",
        "timestamped",
    }


def test_date_only_utc_start_boundary_includes_utc_plus_14() -> None:
    # Local midnight May 10 at UTC+14 is May 9 at 10:00Z. A May 10 date-only
    # value must be treated as possibly starting at that instant.
    timestamped = make_node(
        "timestamped",
        timestamp=datetime(
            2026,
            5,
            10,
            0,
            0,
            tzinfo=timezone(timedelta(hours=14)),
        ),
    )
    dated = make_node("dateonly", date=DateType(2026, 5, 10))

    graph = project_custom(
        [timestamped, dated],
        [],
        ["timestamped", "dateonly"],
        seed_id="timestamped",
    )

    assert graph.origin_assessment.status is OriginStatus.provisional
    assert set(graph.origin_assessment.earliest_candidate_ids) == {
        "dateonly",
        "timestamped",
    }


def test_no_defensible_chronology_is_unresolved_not_fabricated() -> None:
    first = make_node("first", precision=PublicationPrecision.unknown)
    second = make_node("second", precision=PublicationPrecision.unknown)

    graph = project_custom([first, second], [], ["first", "second"], seed_id="second")

    assert graph.origin_assessment.status is OriginStatus.unresolved
    assert graph.root_node_id is None
    assert graph.origin_assessment.earliest_candidate_ids == []
    assert graph.tree_edges == []
    assert set(graph.undated_node_ids) == {"first", "second"}


def test_unresolved_origin_with_dated_nodes_emits_no_tree_edges() -> None:
    first = make_node("first", timestamp=datetime(2026, 1, 1, tzinfo=UTC))
    second = make_node("second", timestamp=datetime(2026, 1, 2, tzinfo=UTC))

    graph = project_custom([first, second], [], [], seed_id="second")

    assert graph.origin_assessment.status is OriginStatus.unresolved
    assert graph.root_node_id is None
    assert graph.tree_edges == []
    assert set(graph.undated_node_ids) == {"first", "second"}
    assert any("Origin unresolved" in warning for warning in graph.warnings)


def test_old_background_page_is_not_a_display_ancestor() -> None:
    old = make_node("old-background", timestamp=datetime(2020, 1, 1, tzinfo=UTC))
    relevant = make_node("relevant", timestamp=datetime(2026, 1, 1, tzinfo=UTC))

    graph = project_custom([old, relevant], [], ["relevant"], seed_id="relevant")

    assert graph.root_node_id == "relevant"
    assert graph.origin_assessment.earliest_candidate_ids == ["relevant"]
    assert "old-background" in {node.id for node in graph.nodes}

    # The excluded older page remains inspectable but is not the visual root.
    assert "old-background" in graph.undated_node_ids
    assert all(edge.parent_id != "old-background" for edge in graph.tree_edges)
    assert graph.tree_edges == []
    assert any("Older context sources" in warning for warning in graph.warnings)


def test_backward_factual_link_is_not_flipped_by_display_direction() -> None:
    early = make_node("early", timestamp=datetime(2026, 1, 1, tzinfo=UTC))
    late = make_node("late", timestamp=datetime(2026, 1, 2, tzinfo=UTC))
    # The later page links backward to the earlier page.
    backward = make_relationship("r-backward", "late", "early", kind="links_to")

    graph = project_custom([early, late], [backward], ["early", "late"], seed_id="late")

    assert graph.root_node_id == "early"
    edge = next(edge for edge in graph.tree_edges if edge.child_id == "late")
    # The display parent is the earlier node even though the factual link points backward.
    assert edge.parent_id == "early"
    assert edge.relationship_id == "r-backward"
    factual = next(item for item in graph.relationships if item.id == "r-backward")
    assert factual.from_node_id == "late"
    assert factual.to_node_id == "early"


def test_truncation_is_explicit_and_keeps_seed_and_origin() -> None:
    nodes = [
        make_node(f"n{index}", timestamp=datetime(2026, 1, index + 1, tzinfo=UTC))
        for index in range(4)
    ]

    graph = project_custom(
        nodes,
        [],
        [node.id for node in nodes],
        seed_id="n3",
        limits=GraphLimits(max_nodes=2),
    )

    assert graph.truncated is True
    assert graph.omitted_count == 2
    assert {node.id for node in graph.nodes} == {"n0", "n3"}
    assert graph.root_node_id == "n0"
    assert graph.seed_node_id == "n3"
    assert any("Graph truncated" in warning for warning in graph.warnings)


def test_unknown_zone_local_time_is_not_normalized() -> None:
    node = make_node(
        "local-time",
        date=DateType(2026, 6, 2),
        precision=PublicationPrecision.date,
        timezone_status="unknown",
    )
    assert node.publication.timestamp is None
    assert node.publication.timezone_status.value == "unknown"
    assert node.publication.date == DateType(2026, 6, 2)


def test_related_topic_never_becomes_traced_parent() -> None:
    early = make_node("early", timestamp=datetime(2026, 1, 1, tzinfo=UTC))
    late = make_node("late", timestamp=datetime(2026, 1, 2, tzinfo=UTC))
    topic = make_relationship(
        "r-topic",
        "early",
        "late",
        kind=RelationshipKind.related_topic.value,
        directed=False,
        method="llm_inference",
    )

    graph = project_custom([early, late], [topic], ["early", "late"], seed_id="late")

    edge = next(edge for edge in graph.tree_edges if edge.child_id == "late")
    assert edge.placement_kind is TreePlacementKind.chronological_only
    assert edge.relationship_id is None
    assert "r-topic" in graph.cross_link_ids
