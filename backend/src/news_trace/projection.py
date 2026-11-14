"""Deterministic chronological projection for the fixture milestone.

The projection is intentionally independent of MCP, HTTP, and the renderer. It
turns source nodes plus supported relationships into a versioned ``GraphResult``
while preserving publication-time uncertainty and factual link direction.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date as DateType
from datetime import datetime, timedelta, timezone

from news_trace.models import (
    GraphLimits,
    GraphResult,
    OriginAssessment,
    OriginStatus,
    PublicationPrecision,
    Relationship,
    SourceNode,
    TRACE_RELATIONSHIP_KINDS,
    TimezoneStatus,
    TreeEdge,
    TreePlacementKind,
)

DEFAULT_COVERAGE_NOTES = (
    "Origin status is limited to the sources included in this run.",
    "A chronological placement connector is not evidence of citation, influence, or causation.",
)


class ProjectionError(ValueError):
    """Raised when the supplied graph state cannot be projected safely."""


@dataclass(frozen=True)
class NodeTime:
    node_id: str
    precision: PublicationPrecision
    timestamp: datetime | None
    date: DateType | None
    evidence_id: str | None

    @property
    def has_instant(self) -> bool:
        return self.timestamp is not None

    @property
    def has_date(self) -> bool:
        return self.date is not None

    @property
    def date_for_ordering(self) -> DateType | None:
        if self.date is not None:
            return self.date
        if self.timestamp is not None:
            return self.timestamp.date()
        return None


def read_node_time(node: SourceNode) -> NodeTime:
    publication = node.publication
    if publication.precision is PublicationPrecision.timestamp:
        if publication.timestamp is None or publication.timezone_status is not TimezoneStatus.known:
            raise ProjectionError(
                f"node {node.id!r} claims timestamp precision without a normalized timestamp"
            )
        return NodeTime(
            node_id=node.id,
            precision=publication.precision,
            timestamp=publication.timestamp,
            date=None,
            evidence_id=publication.evidence_id,
        )
    if publication.precision is PublicationPrecision.date:
        if publication.date is None:
            raise ProjectionError(f"node {node.id!r} claims date precision without a date")
        return NodeTime(
            node_id=node.id,
            precision=publication.precision,
            timestamp=None,
            date=publication.date,
            evidence_id=publication.evidence_id,
        )
    return NodeTime(
        node_id=node.id,
        precision=PublicationPrecision.unknown,
        timestamp=None,
        date=None,
        evidence_id=publication.evidence_id,
    )


def _instant_sort_key(node_time: NodeTime) -> tuple[datetime, str]:
    assert node_time.timestamp is not None
    return (node_time.timestamp.astimezone(timezone.utc), node_time.node_id)


def _candidate_sort_key(node_time: NodeTime) -> tuple[datetime, str]:
    if node_time.timestamp is not None:
        # Origin anchors must agree with tree placement, which orders by the
        # normalized UTC instant before the stable node id.
        return (node_time.timestamp.astimezone(timezone.utc), node_time.node_id)
    candidate_date = node_time.date_for_ordering
    assert candidate_date is not None
    return (
        datetime.combine(candidate_date, datetime.min.time(), tzinfo=timezone.utc),
        node_time.node_id,
    )


def _date_only_interval_utc(value: DateType) -> tuple[datetime, datetime]:
    """Conservative UTC span for a local date with an unknown timezone.

    A local calendar date can begin as early as the previous UTC day at 10:00
    (UTC+14) and end as late as the next UTC day at 12:00 (UTC-12). The origin
    comparison uses this span so a date-only value is not declared later merely
    because its local date matches the timestamp's local date.
    """
    midnight = datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    return (
        midnight - timedelta(hours=14),
        midnight + timedelta(days=1, hours=12),
    )


def _find_origin(
    *,
    node_times: dict[str, NodeTime],
    eligible_ids: set[str],
    coverage_notes: Sequence[str],
    searched_at: datetime,
) -> tuple[OriginAssessment, str | None]:
    eligible = [node_times[node_id] for node_id in sorted(eligible_ids)]
    instants = sorted((item for item in eligible if item.has_instant), key=_instant_sort_key)
    intervals = [item for item in eligible if item.has_date]

    def assessment(
        status: OriginStatus,
        candidate_ids: list[str],
        rationale: str,
    ) -> OriginAssessment:
        evidence_ids = [
            item.evidence_id
            for item in eligible
            if item.node_id in candidate_ids and item.evidence_id is not None
        ]
        return OriginAssessment(
            status=status,
            earliest_candidate_ids=candidate_ids,
            rationale=rationale,
            searched_at=searched_at,
            coverage_notes=list(coverage_notes),
            timestamp_evidence_ids=list(dict.fromkeys(evidence_ids)),
        )

    if not instants and not intervals:
        return (
            assessment(
                OriginStatus.unresolved,
                [],
                "No adequately dated, relevance-supported candidates were found in this run.",
            ),
            None,
        )

    if not instants:
        earliest_date = min(item.date_for_ordering for item in intervals)  # type: ignore[type-var]
        candidates = sorted(
            (item for item in intervals if item.date_for_ordering == earliest_date),
            key=_candidate_sort_key,
        )
        candidate_ids = [item.node_id for item in candidates]
        return (
            assessment(
                OriginStatus.provisional,
                candidate_ids,
                "Only date-level publication evidence is available; the earliest date "
                "narrows the origin to an interval and cannot establish a precise first source.",
            ),
            candidate_ids[0] if candidate_ids else None,
        )

    earliest_instant = instants[0]
    assert earliest_instant.timestamp is not None
    tied_instants = [
        item
        for item in instants
        if item.timestamp is not None and item.timestamp == earliest_instant.timestamp
    ]

    if intervals:
        earliest_interval_date = min(
            item.date_for_ordering for item in intervals  # type: ignore[type-var]
        )
        interval_candidates = sorted(
            (
                item
                for item in intervals
                if item.date_for_ordering == earliest_interval_date
            ),
            key=_candidate_sort_key,
        )
        interval_start, interval_end = _date_only_interval_utc(earliest_interval_date)

        if interval_end < earliest_instant.timestamp:
            candidate_ids = [item.node_id for item in interval_candidates]
            return (
                assessment(
                    OriginStatus.provisional,
                    candidate_ids,
                    "Date-only evidence is earlier than every exact timestamp in this run; "
                    "the origin is provisional because the date-level source has no precise "
                    "time or timezone.",
                ),
                candidate_ids[0],
            )

        if interval_start <= earliest_instant.timestamp <= interval_end:
            candidates = sorted(
                interval_candidates + tied_instants,
                key=_candidate_sort_key,
            )
            candidate_ids = [item.node_id for item in candidates]
            return (
                assessment(
                    OriginStatus.provisional,
                    candidate_ids,
                    "Date-only or timezone-uncertain evidence can overlap the earliest exact "
                    "timestamp once timezone offsets are considered; the origin is provisional "
                    "and may move earlier when a precise timestamp is found.",
                ),
                candidate_ids[0],
            )

    candidates = sorted(tied_instants, key=_candidate_sort_key)
    candidate_ids = [item.node_id for item in candidates]
    if len(tied_instants) > 1:
        return (
            assessment(
                OriginStatus.provisional,
                candidate_ids,
                "Multiple relevance-supported sources share the earliest publication timestamp; "
                "the displayed root is a stable anchor, not proof of historical priority.",
            ),
            candidate_ids[0],
        )
    return (
        assessment(
            OriginStatus.resolved_within_results,
            candidate_ids,
            "The earliest adequately dated, relevance-supported candidate in this run is "
            f"{earliest_instant.node_id!r}.",
        ),
        candidate_ids[0],
    )


def _trace_parent(
    *,
    node: SourceNode,
    node_time: NodeTime,
    times: dict[str, NodeTime],
    relationships: Sequence[Relationship],
    placed_ids: set[str],
) -> tuple[str, str] | None:
    """Return (parent_id, relationship_id) when a supported earlier parent exists."""
    assert node_time.timestamp is not None
    candidates: list[tuple[datetime, str, str]] = []
    for relationship in relationships:
        if relationship.kind not in TRACE_RELATIONSHIP_KINDS:
            continue
        if relationship.from_node_id == node.id:
            other_id = relationship.to_node_id
        elif relationship.to_node_id == node.id:
            other_id = relationship.from_node_id
        else:
            continue
        if other_id not in placed_ids or other_id not in times:
            continue
        other_time = times[other_id]
        if other_time.timestamp is None:
            continue
        if other_time.timestamp < node_time.timestamp:
            candidates.append((other_time.timestamp, other_id, relationship.id))
    if not candidates:
        return None
    # Closest preceding publication time wins; stable parent/relationship ids break ties.
    latest_timestamp = max(item[0] for item in candidates)
    latest = sorted(
        (item for item in candidates if item[0] == latest_timestamp),
        key=lambda item: (item[1], item[2]),
    )[0]
    return (latest[1], latest[2])


def _chronological_order(nodes: Sequence[SourceNode], node_times: dict[str, NodeTime]) -> list[SourceNode]:
    return sorted(
        nodes,
        key=lambda node: (
            0 if node_times[node.id].has_instant else 1,
            _instant_sort_key(node_times[node.id])
            if node_times[node.id].has_instant
            else (
                node_times[node.id].date_for_ordering or DateType.max,
                node.id,
            ),
        ),
    )


def _truncate(
    *,
    nodes: Sequence[SourceNode],
    required_ids: set[str],
    node_times: dict[str, NodeTime],
    limits: GraphLimits,
) -> tuple[list[SourceNode], bool, int | None]:
    if len(nodes) <= limits.max_nodes:
        return list(nodes), False, None
    if len(required_ids) > limits.max_nodes:
        raise ProjectionError(
            "graph node cap is smaller than the mandatory seed/origin evidence set"
        )

    keep_ids = set(required_ids)
    for node in _chronological_order(nodes, node_times):
        if len(keep_ids) >= limits.max_nodes:
            break
        keep_ids.add(node.id)
    kept = [node for node in nodes if node.id in keep_ids]
    omitted = len(nodes) - len(kept)
    return kept, True, omitted


def project_graph(
    *,
    research_id: str,
    graph_revision: int,
    seed_node_id: str,
    nodes: Sequence[SourceNode],
    relationships: Sequence[Relationship],
    origin_eligible_node_ids: Iterable[str],
    searched_at: datetime,
    coverage_notes: Sequence[str] = (),
    warnings: Sequence[str] = (),
    previous_root_node_id: str | None = None,
    limits: GraphLimits | None = None,
) -> GraphResult:
    """Project source nodes and relationships into a chronological tree.

    ``origin_eligible_node_ids`` is the discovery layer's relevance decision: an
    old generic background page, an inaccessible snippet-only source, or a source
    with no publication date must not silently become the origin.
    """
    graph_limits = limits or GraphLimits()
    node_by_id = {node.id: node for node in nodes}
    if len(node_by_id) != len(nodes):
        raise ProjectionError("node ids must be unique")
    if seed_node_id not in node_by_id:
        raise ProjectionError("seed_node_id must reference a supplied node")
    eligible_ids = set(origin_eligible_node_ids)
    unknown_eligible = eligible_ids - set(node_by_id)
    if unknown_eligible:
        raise ProjectionError(
            f"origin eligibility references unknown nodes: {sorted(unknown_eligible)}"
        )
    if len(relationships) > graph_limits.max_relationships:
        raise ProjectionError(
            "relationship cap exceeded; relationship truncation is not implemented in this milestone"
        )

    node_times = {node.id: read_node_time(node) for node in nodes}
    coverage = tuple(dict.fromkeys((*DEFAULT_COVERAGE_NOTES, *coverage_notes)))
    origin, root_node_id = _find_origin(
        node_times=node_times,
        eligible_ids=eligible_ids,
        coverage_notes=coverage,
        searched_at=searched_at,
    )

    required_ids = {seed_node_id, *origin.earliest_candidate_ids}
    if root_node_id is not None:
        required_ids.add(root_node_id)
    kept_nodes, truncated, omitted_count = _truncate(
        nodes=nodes,
        required_ids=required_ids,
        node_times=node_times,
        limits=graph_limits,
    )
    kept_ids = {node.id for node in kept_nodes}
    kept_relationships = [
        relationship
        for relationship in relationships
        if relationship.from_node_id in kept_ids and relationship.to_node_id in kept_ids
    ]

    all_instant_times = sorted(
        (node_times[node_id] for node_id in kept_ids if node_times[node_id].has_instant),
        key=_instant_sort_key,
    )
    if origin.status is OriginStatus.unresolved:
        # No defensible chronology: return an unplaced collection rather than
        # inventing a display order or origin.
        placed_times: list[NodeTime] = []
    else:
        placed_times = list(all_instant_times)
        root_time = node_times.get(root_node_id) if root_node_id is not None else None
        if root_time is not None and root_time.has_instant:
            assert root_time.timestamp is not None
            # Older, origin-ineligible background/context must not become the
            # visual tree root above the actual origin. A same-instant
            # ineligible context node must not sort ahead of the root either.
            placed_times = [
                item
                for item in placed_times
                if item.timestamp is not None
                and (
                    item.timestamp > root_time.timestamp
                    or (
                        item.timestamp == root_time.timestamp
                        and (item.node_id == root_node_id or item.node_id in eligible_ids)
                    )
                )
            ]
        elif root_time is not None and root_time.has_date:
            assert root_time.date is not None
            interval_start, _ = _date_only_interval_utc(root_time.date)
            placed_times = [
                item
                for item in placed_times
                if item.timestamp is not None and item.timestamp >= interval_start
            ]
    placed_ids = {item.node_id for item in placed_times}

    tree_edges: list[TreeEdge] = []
    used_relationship_ids: set[str] = set()
    depth_by_id: dict[str, int] = {}
    previous_placed_id: str | None = None
    for node_time in placed_times:
        node = node_by_id[node_time.node_id]
        if previous_placed_id is None:
            depth_by_id[node.id] = 0
            previous_placed_id = node.id
            continue

        traced = _trace_parent(
            node=node,
            node_time=node_time,
            times=node_times,
            relationships=kept_relationships,
            placed_ids=placed_ids,
        )
        if traced is not None:
            parent_id, relationship_id = traced
            placement_kind = TreePlacementKind.traced_relationship
            used_relationship_ids.add(relationship_id)
        else:
            parent_id = previous_placed_id
            relationship_id = None
            placement_kind = TreePlacementKind.chronological_only

        depth_by_id[node.id] = depth_by_id.get(parent_id, 0) + 1
        tree_edges.append(
            TreeEdge(
                parent_id=parent_id,
                child_id=node.id,
                relationship_id=relationship_id,
                placement_kind=placement_kind,
                discovery_depth=depth_by_id[node.id],
            )
        )
        previous_placed_id = node.id

    cross_link_ids = [
        relationship.id
        for relationship in kept_relationships
        if relationship.id not in used_relationship_ids
    ]

    undated = sorted(
        (item for item in node_times.values() if item.node_id in kept_ids and item.node_id not in placed_ids),
        key=lambda item: (
            0 if item.has_instant else 1 if item.has_date else 2,
            item.timestamp or (
                datetime.combine(item.date, datetime.min.time(), tzinfo=timezone.utc)
                if item.date is not None
                else datetime.max.replace(tzinfo=timezone.utc)
            ),
            item.node_id,
        ),
    )
    undated_ids = [item.node_id for item in undated]

    kept_warnings = list(dict.fromkeys(warnings))
    if origin.status is OriginStatus.unresolved:
        kept_warnings.append(
            "Origin unresolved: no dated tree was projected. All sources are listed as "
            "unplaced until adequate chronological evidence is available."
        )
    elif root_node_id is not None and root_node_id not in placed_ids:
        kept_warnings.append(
            "The origin candidate is time-uncertain and is not placed on the dated tree; "
            "the first dated node is a display anchor only."
        )
    older_context_ids = sorted(
        item.node_id for item in all_instant_times if item.node_id not in placed_ids
    )
    if origin.status is not OriginStatus.unresolved and older_context_ids:
        kept_warnings.append(
            "Older context sources excluded from the dated tree: "
            f"{', '.join(older_context_ids)}. They remain inspectable but are not claimed "
            "as the origin or as display ancestors."
        )
    if previous_root_node_id is not None and previous_root_node_id != root_node_id:
        kept_warnings.append(
            "Origin changed: earliest evidence is now "
            f"{root_node_id or 'unresolved'} (previous root {previous_root_node_id}). "
            "Node identities are preserved; review this revision before relying on earlier answers."
        )
    if truncated:
        kept_warnings.append(
            f"Graph truncated at {graph_limits.max_nodes} nodes; {omitted_count} omitted."
        )

    return GraphResult(
        research_id=research_id,
        graph_revision=graph_revision,
        seed_node_id=seed_node_id,
        root_node_id=root_node_id,
        origin_assessment=origin,
        nodes=_chronological_order(kept_nodes, node_times),
        relationships=kept_relationships,
        tree_edges=tree_edges,
        cross_link_ids=cross_link_ids,
        undated_node_ids=undated_ids,
        limits=graph_limits,
        truncated=truncated,
        omitted_count=omitted_count,
        warnings=kept_warnings,
    )
