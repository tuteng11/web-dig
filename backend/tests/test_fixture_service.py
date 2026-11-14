from __future__ import annotations

from datetime import date as DateType

import pytest

from news_trace.fixture_service import FixtureNotFoundError, FixtureRepository

from helpers import FIXTURE_PATH


def test_node_details_round_trip_through_fixture_repository() -> None:
    repository = FixtureRepository(FIXTURE_PATH)
    details = repository.get_node_details("fixture-riverbend", "n-seed")

    assert details.node.id == "n-seed"
    assert details.node.title
    assert details.node.snapshot_id == "snap-n-seed"
    assert details.snapshot is not None
    assert details.snapshot.id == "snap-n-seed"
    assert all(item.node_id == "n-seed" for item in details.evidence)
    assert any(item.kind.value == "link" for item in details.evidence)
    relationship_ids = {item.id for item in details.relationships}
    assert "r-seed-links-grassroots" in relationship_ids
    assert "r-regulators-related-seed" in relationship_ids
    assert details.coverage_notes


def test_date_only_details_preserve_uncertainty() -> None:
    repository = FixtureRepository(FIXTURE_PATH)
    details = repository.get_node_details("fixture-riverbend", "n-local")

    publication = details.node.publication
    assert publication.timestamp is None
    assert publication.date == DateType(2026, 6, 2)
    assert publication.raw == "June 2, 2026 7:00 PM"
    assert publication.precision.value == "date"
    assert publication.timezone_status.value == "unknown"
    assert any("timezone" in warning.lower() for warning in details.warnings)


def test_unavailable_source_details_remain_unavailable() -> None:
    repository = FixtureRepository(FIXTURE_PATH)
    details = repository.get_node_details("fixture-riverbend", "n-blocked")

    assert details.node.content_status.value == "unavailable"
    assert details.node.excerpt is None
    assert details.snapshot is None
    assert details.node.warnings


def test_expanded_nodes_are_not_readable_in_the_initial_session() -> None:
    repository = FixtureRepository(FIXTURE_PATH)
    with pytest.raises(FixtureNotFoundError):
        repository.get_node_details("fixture-riverbend", "n-agenda")


def test_unknown_research_and_node_are_rejected() -> None:
    repository = FixtureRepository(FIXTURE_PATH)
    with pytest.raises(FixtureNotFoundError):
        repository.get_graph("missing-research")
    with pytest.raises(FixtureNotFoundError):
        repository.get_node_details("fixture-riverbend", "missing-node")
    with pytest.raises(FixtureNotFoundError):
        repository.project_stage("fixture-riverbend", "missing-stage")


def test_repository_graph_identity_is_stable() -> None:
    repository = FixtureRepository(FIXTURE_PATH)
    first = repository.get_graph("fixture-riverbend")
    second = repository.get_graph("fixture-riverbend")

    assert first is second
    assert first.graph_revision == 1


def test_graph_and_details_round_trip_json_contract() -> None:
    from news_trace.models import GraphResult, NodeDetails

    repository = FixtureRepository(FIXTURE_PATH)
    graph = repository.get_graph("fixture-riverbend")
    details = repository.get_node_details("fixture-riverbend", "n-dateonly")

    restored_graph = GraphResult.model_validate_json(graph.model_dump_json())
    restored_details = NodeDetails.model_validate_json(details.model_dump_json())

    assert restored_graph == graph
    assert restored_details == details
    assert restored_details.node.publication.timestamp is None
    assert restored_details.node.publication.date == DateType(2026, 5, 30)
    assert restored_details.node.publication.timezone_status.value == "unknown"
