"""Read-only fixture research repository used by the MCP server.

The repository is the only source of graph data in this milestone. It projects
the fixture's initial and expanded stages deterministically and exposes node
details without ever mutating the graph.
"""

from __future__ import annotations

from pathlib import Path

from news_trace.fixtures import FixtureDocument, FixtureStage
from news_trace.models import (
    GraphLimits,
    GraphResult,
    NodeDetails,
    SnapshotInfo,
)
from news_trace.projection import project_graph


class FixtureNotFoundError(LookupError):
    """Raised when a research session or node is absent from the fixture."""


class FixtureRepository:
    def __init__(self, fixture_path: Path) -> None:
        self.fixture_path = Path(fixture_path)
        self.document = FixtureDocument.from_path(self.fixture_path)
        self._nodes = {node.id: node for node in self.document.nodes}
        self._initial_graph = self._project("initial")

    @property
    def research_id(self) -> str:
        return self.document.research_id

    @property
    def label(self) -> str:
        return self.document.label

    @property
    def initial_graph(self) -> GraphResult:
        return self._initial_graph

    def _require_research(self, research_id: str) -> None:
        if research_id != self.document.research_id:
            raise FixtureNotFoundError(f"unknown fixture research {research_id!r}")

    def _stage(self, name: str) -> FixtureStage:
        try:
            return self.document.stages[name]
        except KeyError as exc:
            raise FixtureNotFoundError(f"unknown fixture stage {name!r}") from exc

    def _project(
        self,
        stage_name: str,
        *,
        previous_root_node_id: str | None = None,
        limits: GraphLimits | None = None,
    ) -> GraphResult:
        stage = self._stage(stage_name)
        node_ids = set(stage.node_ids)
        nodes = [node for node in self.document.nodes if node.id in node_ids]
        relationships = [
            relationship
            for relationship in self.document.relationships
            if relationship.from_node_id in node_ids and relationship.to_node_id in node_ids
        ]
        return project_graph(
            research_id=self.document.research_id,
            graph_revision=stage.graph_revision,
            seed_node_id=self.document.seed_node_id,
            nodes=nodes,
            relationships=relationships,
            origin_eligible_node_ids=stage.origin_eligible_node_ids,
            searched_at=self.document.searched_at,
            coverage_notes=self.document.coverage_notes,
            warnings=self.document.warnings,
            previous_root_node_id=previous_root_node_id,
            limits=limits,
        )

    def get_graph(self, research_id: str) -> GraphResult:
        self._require_research(research_id)
        return self._initial_graph

    def project_stage(self, research_id: str, stage_name: str) -> GraphResult:
        """Expose a named fixture stage for projection tests and documentation.

        Only the initial stage is served by MCP in this milestone. The expanded
        stage demonstrates an earlier source arriving later and rerooting without
        changing node identities.
        """
        self._require_research(research_id)
        if stage_name == "initial":
            return self._initial_graph
        previous_root = self._initial_graph.root_node_id
        return self._project(stage_name, previous_root_node_id=previous_root)

    def get_node_details(self, research_id: str, node_id: str) -> NodeDetails:
        self._require_research(research_id)
        initial_node_ids = set(self._stage("initial").node_ids)
        if node_id not in initial_node_ids:
            raise FixtureNotFoundError(f"unknown fixture node {node_id!r}")
        node = self._nodes[node_id]
        evidence = [item for item in self.document.evidence if item.node_id == node_id]
        relationships = [
            relationship
            for relationship in self._initial_graph.relationships
            if node_id in {relationship.from_node_id, relationship.to_node_id}
        ]
        snapshot = None
        if node.snapshot_id is not None:
            if not node.content_hash:
                raise ValueError(
                    f"fixture node {node.id!r} has a snapshot without a content hash"
                )
            snapshot = SnapshotInfo(
                id=node.snapshot_id,
                content_hash=node.content_hash,
                captured_at=node.retrieved_at,
                content_status=node.content_status,
                excerpt=node.excerpt,
            )
        return NodeDetails(
            research_id=self.document.research_id,
            node=node,
            evidence=evidence,
            relationships=relationships,
            snapshot=snapshot,
            coverage_notes=[
                *self.document.coverage_notes,
                "Node details are limited to this synthetic fixture snapshot.",
            ],
            warnings=node.warnings,
        )
